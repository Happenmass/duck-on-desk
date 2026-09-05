import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import mujocoWasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { buildRig, geometryToBinaryStl, loadGlbGeometries, loadKinematics, MODEL_DIR, setJawOpen, setJoint } from "./duck.js";
import { DEFAULT_VARIANT, materialHookFor, VARIANTS, applyVariant } from "./variants.js";
import { MotionLeases } from "./motion-leases.js";
import { normalizeStilts, STILT_BLEND, STILT_MAX_FORWARD, STILT_MAX_TURN, STILT_SERVO_GAIN, stiltFraming, stiltMassKg, stiltMeshData, stiltPolicyFile } from "./stilts.js";
import { normalizeLocomotion, ROLLER_BRAKE, ROLLER_BRAKE_ABOVE, ROLLER_CROUCH, ROLLER_MAX_FORWARD, ROLLER_POLICY_FILES, ROLLER_REST_HEIGHT, ROLLER_WHEEL_JOINTS } from "./rollers.js";
import {
  CMD_SIZE, CTRL_DT, DECIMATION, DEFAULT_POSE, JOINT_NAMES, MAX_BACK, MAX_FORWARD,
  MAX_TURN, NUM_JOINTS, OBS_SIZE, POLICY_FILES, TIMESTEP,
} from "./constants.js";
import {
  FACING_HALF_CONE, footLanding, GROUND_PICK, HEAD_ALPHA, HEAD_KEYS, HEAD_MAX, HEADING_ENGAGE, HEADING_MIN_FORWARD, headingTurn, landingImpact, pickJawOpenness,
  quackJawOpenness, wrapAngle,
} from "./gestures.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Pick-up: while grabbed the trunk is held at #lift.target (base = height at grab time + the requested
// lift, up to LIFT_MAX metres above it) and eased there with LIFT_SMOOTHING per 50 Hz control step.
// The camera rig rises with the trunk (see the render loop) so the window never has to change: a carried
// or falling duck stays framed exactly as on the ground while the ground and its shadow drop out of view.
const LIFT_MAX = 5;
const LIFT_SMOOTHING = 0.3;
const REST_HEIGHT = 0.12; // trunk height when standing; anything above it is "lift"
const STRIDE_M = 0.02; // metres credited to free roam per foot landing (see takeDisplacement)
// The walking policy will not start stepping from standstill below roughly 0.8
// forward, although it sustains a gait already under way down to ~0.45. Any
// move lease therefore gets a GAIT_KICK forward until the feet are stepping
// (a landing within GAIT_STALL_MS), then cruises at the commanded value.
const GAIT_KICK = 0.9;
const GAIT_STALL_MS = 800;
const STRIDE_SPREAD_STEPS = 12; // control steps (240 ms) over which one stride is paid out
const CAMERA_FOLLOW_DEADBAND = 0.02; // ignore the gait's own few-mm bob

export async function createDuckRuntime(options) {
  const runtime = new DuckRuntime(options);
  await runtime.init();
  return runtime;
}

class DuckRuntime {
  #container;
  #policyUrl;
  #onSound;
  #renderer;
  #scene;
  #camera;
  #rig;
  #trunk;
  #mujoco;
  #ort;
  #model;
  #data;
  #sessions = {};
  #qposAdr;
  #dofAdr;
  #gyroAdr;
  #trunkId;
  #standKeyId;
  #ankleIds;
  #cameraBearing = 0;
  #headingEngaged = false;
  #displacement = { x: 0, y: 0 }; // stride credited since takeDisplacement() (rig frame, metres)
  #strideRemaining = 0; // metres of the last foot landing's stride still to be paid out
  #lastLandingAt = 0; // performance.now() of the last foot landing (gait-kick bookkeeping)
  #stepFeet = [{ air: false, prevZ: 0, lastAt: 0 }, { air: false, prevZ: 0, lastAt: 0 }];
  #prevVz = 0;
  #thumpAt = 0;
  #leases = new MotionLeases();
  #obs = new Float32Array(OBS_SIZE);
  #cmd = new Float32Array(CMD_SIZE);
  #lastAction = new Float32Array(NUM_JOINTS);
  #listeners = new Set();
  #timers = new Set();
  #mode = "walk";
  #sitFlag = 0;
  #recovery = null;
  #fallDebounce = 0;
  #headTarget = new Float32Array(4);
  #headSmooth = new Float32Array(4);
  #pick = null;
  #quackAt = -Infinity;
  #grabbed = false;
  #lift = null; // { z, base, target } while picked up
  #cameraLift = 0; // metres the camera rig is raised to keep a lifted/falling trunk centred
  #lookY = REST_HEIGHT; // where the camera rig looks at rest (rises with stilts)
  #stilts = 0; // stilt height in cm (0 = the duck's own feet)
  #locomotion = "legs"; // "legs" | "rollers"
  #wheels = []; // rollers: [{ name, adr }] passive wheel hinges synced to the rig
  #morphTarget = null; // pending { locomotion, stilts } for the next rebuild
  #stiltSites = null; // { left: { pos, quat }, right } from the MJCF foot sites (stilts only)
  #rebuilding = false; // a morphology rebuild is swapping model/rig/policy
  #cameraBase = null; // camera position at rest
  #sleeping = false;
  #suspended = false;
  #disposed = false;
  #ready = false;
  #ctrlHz = 0;
  #fps = 0;
  #renderFrames = 0;
  #renderT0 = performance.now();
  #lastSleepRender = 0;
  #appearance = DEFAULT_VARIANT;
  #resizeObserver;
  #renderFrame;
  #gravityQ = new THREE.Quaternion();
  #gravityV = new THREE.Vector3();

  constructor({ container, policyUrl, onSound = () => {}, appearance = DEFAULT_VARIANT, stilts = 0, locomotion = "legs" }) {
    if (!container) throw new Error("DuckRuntime requires a container");
    if (!VARIANTS[appearance]) throw new Error(`unknown appearance: ${appearance}`);
    this.#container = container;
    this.#policyUrl = policyUrl;
    this.#onSound = onSound;
    this.#appearance = appearance;
    this.#locomotion = normalizeLocomotion(locomotion);
    this.#stilts = this.#locomotion === "rollers" ? 0 : normalizeStilts(stilts);
  }

  #rollers() {
    return this.#locomotion === "rollers";
  }

  // Trunk height when standing on the current feet.
  #restHeight() {
    return (this.#rollers() ? ROLLER_REST_HEIGHT : REST_HEIGHT) + this.#stilts / 100;
  }

  async init() {
    this.#setupRenderer();
    const [{ default: loadMujocoFactory }, ort] = await Promise.all([
      import("@mujoco/mujoco"),
      import("onnxruntime-web/wasm"),
    ]);
    this.#ort = ort;
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
    ort.env.wasm.numThreads = 1;
    this.#mujoco = await loadMujocoFactory({ locateFile: (name) => name.endsWith(".wasm") ? mujocoWasmUrl : name });
    await this.#loadModel();
    this.#ready = true;
    this.#emit();
    this.#controlLoop();
    this.#renderLoop();
  }

  // Everything that depends on the morphology (stilts or not): physics model,
  // policies, rig and camera framing. Runs at init and again on a rebuild.
  async #loadModel() {
    // Policies live in the user's Hugging Face cache (never bundled); without
    // the ones a morphology needs, fall back to the duck's own feet.
    const have = (file) => fetch(this.#policyUrl(file)).then((r) => r.ok).catch(() => false);
    if (this.#stilts > 0 && !(await have(stiltPolicyFile(this.#stilts)))) {
      console.warn(`stilt policy ${this.#stilts} cm missing from the Hugging Face cache; using the duck's own feet`);
      this.#stilts = 0;
    }
    if (this.#rollers() && !(await have(ROLLER_POLICY_FILES.walk) && await have(ROLLER_POLICY_FILES.crouch))) {
      console.warn("roller policies missing from the Hugging Face cache; using the duck's own feet");
      this.#locomotion = "legs";
    }
    const [k, physics] = await Promise.all([
      loadKinematics(`${MODEL_DIR}/${this.#rollers() ? "kinematics_rollers.json" : "kinematics.json"}`),
      this.#buildPhysicsXml(),
    ]);
    const vfs = new this.#mujoco.MjVFS();
    const glb = await loadGlbGeometries();
    await Promise.all(physics.meshFiles.map(async (name) => {
      const mesh = glb.get(name);
      const bytes = mesh
        ? geometryToBinaryStl(mesh.welded)
        : await (await fetch(`${MODEL_DIR}/meshes/${name}`)).arrayBuffer();
      vfs.addBuffer(`assets/${name}`, new Uint8Array(bytes));
    }));

    const sessionOptions = { executionProviders: ["wasm"] };
    // On stilts the walking policy is the matching stilt policy from the Hub;
    // the other policies stay loaded but sit/peck are refused while on stilts.
    const files = {
      ...POLICY_FILES,
      ...(this.#stilts > 0 ? { walk: stiltPolicyFile(this.#stilts) } : {}),
      ...(this.#rollers() ? ROLLER_POLICY_FILES : {}),
    };
    await Promise.all(Object.entries(files).map(async ([name, file]) => {
      this.#sessions[name] = await this.#ort.InferenceSession.create(this.#policyUrl(file), sessionOptions);
    }));

    this.#model = this.#mujoco.MjModel.from_xml_string(physics.xml, vfs);
    this.#data = new this.#mujoco.MjData(this.#model);
    this.#qposAdr = JOINT_NAMES.map((name) => this.#model.jnt(name).qposadr);
    this.#dofAdr = JOINT_NAMES.map((name) => this.#model.jnt(name).dofadr);
    this.#gyroAdr = this.#model.sensor("imu_ang_vel").adr;
    this.#trunkId = this.#mujoco.mj_name2id(this.#model, this.#mujoco.mjtObj.mjOBJ_BODY.value, "trunk_base");
    this.#standKeyId = this.#mujoco.mj_name2id(this.#model, this.#mujoco.mjtObj.mjOBJ_KEY.value, "STAND");
    this.#ankleIds = ["ankle_left", "ankle_right"]
      .map((name) => this.#mujoco.mj_name2id(this.#model, this.#mujoco.mjtObj.mjOBJ_BODY.value, name));
    // Passive wheel hinges: in qpos (zeroed in the keyframe) but not in the
    // observation; resolved by name and only mirrored onto the rig.
    this.#wheels = this.#rollers()
      ? ROLLER_WHEEL_JOINTS.map((name) => ({ name, adr: this.#model.jnt(name).qposadr }))
      : [];

    this.#rig = await buildRig(k, { materialForMesh: materialHookFor(VARIANTS[this.#appearance]) });
    this.#rig.placer.rotation.y = -Math.PI / 2;
    this.#rig.root.traverse((object) => {
      if (object.isMesh) object.castShadow = true;
    });
    if (this.#stilts > 0) this.#attachStiltVisuals();
    this.#scene.add(this.#rig.placer);
    this.#trunk = this.#rig.bodies.get("trunk_base");
    this.#frameCamera();
    // Camera bearing in the MJCF world frame (the trunk's parent frame): the
    // trunk is pinned at the origin, so this is constant.
    this.#scene.updateMatrixWorld(true);
    const cameraLocal = this.#trunk.parent.worldToLocal(this.#camera.position.clone());
    this.#cameraBearing = Math.atan2(cameraLocal.y, cameraLocal.x);
    this.#resetPhysics();
  }

  // Morphology requests (stilts height, legs/rollers) are merged into one
  // pending target; rollers and stilts are exclusive, the later request wins.
  #requestMorphology(patch) {
    const next = { locomotion: this.#locomotion, stilts: this.#stilts, ...(this.#morphTarget || {}), ...patch };
    if ("stilts" in patch && next.stilts > 0) next.locomotion = "legs";
    if (next.locomotion === "rollers") next.stilts = 0;
    this.#morphTarget = next;
    if (!this.#rebuilding) this.#rebuild();
  }

  // Swap the morphology in place without disturbing the callers holding this
  // runtime: pause the control loop, drop the old model and rig, load the new
  // ones, resume — and repeat if another request arrived meanwhile.
  async #rebuild() {
    if (this.#rebuilding || !this.#mujoco) return;
    this.#rebuilding = true;
    try {
      while (this.#morphTarget) {
        const target = this.#morphTarget;
        this.#morphTarget = null;
        if (target.locomotion === this.#locomotion && target.stilts === this.#stilts) continue;
        this.#ready = false;
        this.#emit();
        await delay(80); // let an in-flight control step finish
        this.#clearTimers();
        this.#leases.clearAll();
        this.#grabbed = false;
        this.#lift = null;
        this.#pick = null;
        this.#recovery = null;
        if (this.#rig) this.#scene.remove(this.#rig.placer);
        this.#trunk = null;
        this.#rig = null;
        // Null the handles before freeing the WASM objects: snapshot() and the
        // loops guard on them, and a freed embind object throws on any access.
        const oldData = this.#data;
        const oldModel = this.#model;
        this.#data = null;
        this.#model = null;
        oldData?.delete?.();
        oldModel?.delete?.();
        this.#locomotion = target.locomotion;
        this.#stilts = target.stilts;
        await this.#loadModel();
      }
    } finally {
      this.#rebuilding = false;
      this.#ready = !!this.#data;
      this.#emit();
    }
  }

  // Stilt visuals: the same loft the physics uses, hung from each ankle at the
  // foot site so it follows the leg exactly.
  #attachStiltVisuals() {
    const { vertices, faces } = stiltMeshData(this.#stilts, STILT_BLEND);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(Array.from(faces));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.45, 0.34, 0.85), roughness: 0.45, side: THREE.DoubleSide });
    for (const side of ["left", "right"]) {
      const ankle = this.#rig.bodies.get(`ankle_${side}`);
      const site = this.#stiltSites?.[side];
      if (!ankle || !site) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.position.set(site.pos[0], site.pos[1], site.pos[2]);
      mesh.quaternion.set(site.quat[1], site.quat[2], site.quat[3], site.quat[0]);
      ankle.add(mesh);
    }
  }

  // Rest framing: the stock camera for the bare duck, backed off and aimed
  // higher on stilts so the whole silhouette stays in the window.
  #frameCamera() {
    const framing = stiltFraming(this.#stilts, REST_HEIGHT);
    this.#lookY = framing.lookY;
    this.#camera.position.set(0.36, 0.23, 0.54).multiplyScalar(framing.dolly);
    this.#camera.lookAt(0, this.#lookY, 0);
    this.#cameraBase = this.#camera.position.clone();
    this.#cameraLift = 0;
  }

  command(intent) {
    if (!intent || typeof intent.type !== "string") throw new Error("intent.type is required");
    const source = intent.source ?? "local";
    switch (intent.type) {
      case "move":
        this.#wakeIfNeeded();
        this.#leases.set(source, { forward: intent.forward, turn: intent.turn, heading: intent.heading }, { ttlMs: intent.ttlMs });
        if (this.#mode === "sit") this.#stand();
        break;
      case "stop":
        if (intent.source) this.#leases.clear(source);
        else this.#leases.clearAll();
        break;
      case "stilts":
        this.#requestMorphology({ stilts: normalizeStilts(intent.heightCm) });
        break;
      case "locomotion":
        this.#requestMorphology({ locomotion: normalizeLocomotion(intent.mode) });
        break;
      case "perform":
        // Sitting and pecking have no stilt policies; ignore them on stilts.
        // Rollers have no sit either, but "peck" becomes the crouch-glide.
        if (this.#stilts > 0 && (intent.action === "sit" || intent.action === "peck")) break;
        if (this.#rollers() && intent.action === "sit") break;
        if (intent.action === "sit") this.#sit();
        else if (intent.action === "stand") this.#stand();
        else if (intent.action === "peck") this.#peck();
        else if (intent.action === "quack") this.#quack();
        else throw new Error(`unsupported P0 action: ${intent.action}`);
        break;
      case "look":
        for (let h = 0; h < 4; h++) {
          this.#headTarget[h] = clamp(Number(intent[HEAD_KEYS[h]]) || 0, -HEAD_MAX, HEAD_MAX);
        }
        break;
      case "grab-start":
        // Picked up: no policy runs while held; whatever it was doing is over.
        this.#wakeIfNeeded(false);
        this.#leases.clearAll();
        this.#cancelPeck();
        this.#clearTimers();
        this.#mode = "walk";
        this.#sitFlag = 0;
        this.#recovery = null;
        this.#fallDebounce = 0;
        this.#lastAction.fill(0);
        {
          const z = this.#data ? this.#data.qpos[2] : 0.12;
          this.#lift = { z, base: z, target: z };
        }
        this.#grabbed = true;
        this.#emit();
        break;
      case "grab-lift":
        // Pointer-driven lift height (m above the height at grab time).
        if (this.#grabbed && this.#lift) {
          this.#lift.target = this.#lift.base + clamp(Number(intent.height) || 0, 0, LIFT_MAX);
        }
        break;
      case "grab-end":
        // Let go: gravity takes over from wherever it hangs; the walker (or the
        // get-up policy after a tumble) handles the landing.
        this.#grabbed = false;
        this.#lift = null;
        this.#leases.clearAll();
        this.#emit();
        break;
      case "sleep":
        this.#sleep();
        break;
      case "wake":
        this.#wakeIfNeeded();
        break;
      case "appearance":
        if (!VARIANTS[intent.name]) throw new Error(`unknown appearance: ${intent.name}`);
        this.#appearance = intent.name;
        if (this.#rig) applyVariant(this.#rig, intent.name);
        this.#emit();
        break;
      case "reset":
        this.#wakeIfNeeded();
        this.#resetPhysics();
        break;
      default:
        throw new Error(`unsupported intent: ${intent.type}`);
    }
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      ready: this.#ready,
      mode: this.#recovery ? "recovery" : this.#mode,
      sleeping: this.#sleeping,
      grabbed: this.#grabbed,
      busy: this.#grabbed || this.#sleeping || !!this.#recovery || this.#mode !== "walk",
      ctrlHz: Math.round(this.#ctrlHz),
      fps: Math.round(this.#fps),
      appearance: this.#appearance,
      motionSource: this.#leases.current().source,
      facing: this.#data ? this.#facing() : 0,
      height: this.#data ? this.#data.qpos[2] : 0,
      restHeight: this.#restHeight(),
      stilts: this.#stilts,
      locomotion: this.#locomotion,
    });
  }

  // Screen-space distance (px, +x right, +y down) the duck's steps have
  // covered since the last call, projected through the live camera. Free roam
  // moves the window by exactly this so the window follows the duck's own
  // gait. The stride is credited per foot landing (STRIDE_M along the trunk's
  // heading, paid out over the next STRIDE_SPREAD_STEPS control steps) rather
  // than read from the physics: the walking policy's real translation is tiny
  // and erratic (a few px/s, mostly yaw drift), while its cadence is steady.
  takeDisplacement() {
    const { x, y } = this.#displacement;
    this.#displacement.x = 0;
    this.#displacement.y = 0;
    if ((x === 0 && y === 0) || !this.#trunk || !this.#trunk.parent || !this.#renderer) return { dx: 0, dy: 0 };
    const parent = this.#trunk.parent;
    const a = parent.localToWorld(new THREE.Vector3(0, 0, 0)).project(this.#camera);
    const b = parent.localToWorld(new THREE.Vector3(x, y, 0)).project(this.#camera);
    const el = this.#renderer.domElement;
    return { dx: (b.x - a.x) * el.clientWidth / 2, dy: -(b.y - a.y) * el.clientHeight / 2 };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#leases.clearAll();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#resizeObserver?.disconnect();
    cancelAnimationFrame(this.#renderFrame);
    this.#renderer?.dispose();
    this.#container.replaceChildren();
    this.#listeners.clear();
  }

  #setupRenderer() {
    this.#scene = new THREE.Scene();
    this.#camera = new THREE.PerspectiveCamera(32, 1, 0.02, 20);
    this.#camera.position.set(0.36, 0.23, 0.54);
    this.#camera.lookAt(0, 0.12, 0);
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
    this.#renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.shadowMap.enabled = true;
    this.#container.appendChild(this.#renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.#renderer);
    this.#scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    this.#scene.environmentIntensity = 0.32;
    pmrem.dispose();
    this.#scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2, 4, 2);
    key.castShadow = true;
    this.#scene.add(key);
    const rim = new THREE.DirectionalLight(0xffa45b, 0.75);
    rim.position.set(-2, 2, -2);
    this.#scene.add(rim);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.4, 0.55, 1);
    shadow.receiveShadow = true;
    this.#scene.add(shadow);

    const resize = () => {
      const width = Math.max(1, this.#container.clientWidth);
      const height = Math.max(1, this.#container.clientHeight);
      this.#renderer.setSize(width, height, false);
      this.#camera.aspect = width / height;
      this.#camera.updateProjectionMatrix();
    };
    resize();
    this.#resizeObserver = new ResizeObserver(resize);
    this.#resizeObserver.observe(this.#container);
  }

  async #buildPhysicsXml() {
    const source = await (await fetch(`${MODEL_DIR}/${this.#rollers() ? "robot_allcollisions_rollers.xml" : "robot_allcollisions.xml"}`)).text();
    const doc = new DOMParser().parseFromString(source, "text/xml");
    for (const geom of [...doc.querySelectorAll('geom[class="visual"]')]) geom.remove();
    const usedMeshes = new Set([...doc.querySelectorAll("geom[mesh]")].map((geom) => geom.getAttribute("mesh")));
    for (const mesh of [...doc.querySelectorAll("asset > mesh")]) {
      const name = mesh.getAttribute("name") ?? mesh.getAttribute("file").replace(/\.stl$/i, "");
      if (!usedMeshes.has(name)) mesh.remove();
    }
    const element = (tag, attrs) => {
      const node = doc.createElement(tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
      return node;
    };
    // Same solver setup the policies were trained with (mjlab: implicitfast
    // integrator, Newton solver at 10/20 iterations); MuJoCo's Euler default
    // treats the joint damping/armature explicitly and is noticeably stiffer.
    doc.documentElement.appendChild(element("option", {
      timestep: String(TIMESTEP), integrator: "implicitfast", iterations: "10", ls_iterations: "20",
    }));
    doc.querySelector("worldbody").appendChild(element("geom", {
      name: "desktop_floor", type: "plane", size: "0 0 0.05", pos: "0 0 0",
    }));
    const byName = new Map(JOINT_NAMES.map((name, index) => [name, DEFAULT_POSE[index]]));
    const joints = [...doc.querySelectorAll("body > joint")]
      .map((joint) => byName.get(joint.getAttribute("name")) ?? 0).join(" ");
    const keyframe = doc.createElement("keyframe");
    keyframe.appendChild(element("key", {
      name: "STAND",
      qpos: `0 0 ${this.#restHeight().toFixed(4)} 1 0 0 0 ${joints}`,
      ctrl: Array.from(DEFAULT_POSE).join(" "),
    }));
    doc.documentElement.appendChild(keyframe);
    const meshFiles = [...doc.querySelectorAll("asset > mesh")].map((mesh) => mesh.getAttribute("file")).filter(Boolean);
    this.#stiltSites = null;
    if (this.#stilts > 0) {
      // The stilt policies were trained on the walk model, whose only
      // collision geoms are the feet: drop the leg/trunk collision geoms so a
      // swinging stilt cannot catch on a knee the policy never learned about.
      for (const geom of [...doc.querySelectorAll('geom[class="collision"]')]) {
        if (!/_foot_collision$/.test(geom.getAttribute("name") || "")) geom.remove();
      }
      // Approximate the BAM servo model the stilt policies were trained with
      // (see STILT_SERVO_GAIN): stiffer, stronger position actuators.
      for (const pos of [...doc.querySelectorAll("default > position")]) {
        if (pos.hasAttribute("kp")) pos.setAttribute("kp", String(Number(pos.getAttribute("kp")) * STILT_SERVO_GAIN));
        if (pos.hasAttribute("forcerange")) {
          pos.setAttribute("forcerange", pos.getAttribute("forcerange").split(/\s+/).filter(Boolean).map((v) => String(Number(v) * STILT_SERVO_GAIN)).join(" "));
        }
      }
      // Same construction as the training environment: one convex loft per
      // side in a body at the foot site under the ankle, with the stage mass.
      const { vertices, faces } = stiltMeshData(this.#stilts, STILT_BLEND);
      doc.querySelector("asset").appendChild(element("mesh", {
        name: "stilt_cartridge_mesh",
        vertex: Array.from(vertices, (v) => v.toFixed(6)).join(" "),
        face: Array.from(faces).join(" "),
      }));
      this.#stiltSites = {};
      for (const side of ["left", "right"]) {
        const site = doc.querySelector(`site[name="${side}_foot"]`);
        const pos = site.getAttribute("pos");
        const quat = site.getAttribute("quat") ?? "1 0 0 0";
        this.#stiltSites[side] = { pos: pos.split(/\s+/).filter(Boolean).map(Number), quat: quat.split(/\s+/).filter(Boolean).map(Number) };
        const body = element("body", { name: `stilt_${side}`, pos, quat });
        body.appendChild(element("geom", {
          name: `${side}_stilt_collision`, type: "mesh", mesh: "stilt_cartridge_mesh", class: "collision",
          mass: stiltMassKg(this.#stilts).toFixed(4),
        }));
        site.parentNode.appendChild(body);
      }
    }
    return { xml: new XMLSerializer().serializeToString(doc), meshFiles };
  }

  #resetPhysics() {
    if (!this.#model) return;
    this.#clearTimers();
    this.#leases.clearAll();
    this.#mode = "walk";
    this.#sitFlag = 0;
    this.#recovery = null;
    this.#fallDebounce = 0;
    this.#pick = null;
    this.#headTarget.fill(0);
    this.#headSmooth.fill(0);
    this.#quackAt = -Infinity;
    this.#prevVz = 0;
    this.#headingEngaged = false;
    this.#sleeping = false;
    this.#suspended = false;
    this.#mujoco.mj_resetDataKeyframe(this.#model, this.#data, this.#standKeyId);
    this.#mujoco.mj_forward(this.#model, this.#data);
    this.#lastAction.fill(0);
    this.#emit();
  }

  #sit() {
    if (!this.#ready || this.#mode === "sit" || this.#pick || this.#stilts > 0 || this.#rollers()) return;
    this.#leases.clearAll();
    this.#clearTimers();
    this.#mode = "sitting";
    this.#sitFlag = 0;
    this.#emit();
    this.#later(800, () => {
      this.#sitFlag = 1;
      this.#mode = "sit";
      this.#emit();
    });
  }

  #stand() {
    this.#wakeIfNeeded(false);
    if (!this.#ready || this.#mode === "walk" || this.#mode === "standing" || this.#pick) return;
    this.#clearTimers();
    this.#sitFlag = 0;
    this.#mode = "standing";
    this.#emit();
    this.#later(1_900, () => {
      this.#mode = "walk";
      this.#lastAction.fill(0);
      this.#emit();
    });
  }

  #sleep() {
    if (this.#sleeping || this.#pick) return;
    this.#sit();
    this.#later(2_600, () => {
      this.#sleeping = true;
      this.#suspended = true;
      this.#mode = this.#stilts > 0 || this.#rollers() ? "walk" : "sit"; // stilts/rollers: doze standing
      this.#emit();
    });
  }

  #wakeIfNeeded(stand = true) {
    if (!this.#sleeping && !this.#suspended) return;
    this.#sleeping = false;
    this.#suspended = false;
    this.#mujoco?.mj_forward(this.#model, this.#data);
    this.#emit();
    if (stand) this.#stand();
  }

  #later(ms, fn) {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (!this.#disposed) fn();
    }, ms);
    this.#timers.add(timer);
    return timer;
  }

  #clearTimers() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #buildObs() {
    const qpos = this.#data.qpos;
    const qvel = this.#data.qvel;
    const sensors = this.#data.sensordata;
    let index = 0;
    for (let axis = 0; axis < 3; axis++) this.#obs[index++] = sensors[this.#gyroAdr + axis];
    const rotation = this.#data.body(this.#trunkId).xquat;
    this.#gravityQ.set(rotation[1], rotation[2], rotation[3], rotation[0]).conjugate();
    this.#gravityV.set(0, 0, -1).applyQuaternion(this.#gravityQ);
    this.#obs[index++] = this.#gravityV.x;
    this.#obs[index++] = this.#gravityV.y;
    this.#obs[index++] = this.#gravityV.z;
    for (let joint = 0; joint < NUM_JOINTS; joint++) this.#obs[index++] = qpos[this.#qposAdr[joint]] - DEFAULT_POSE[joint];
    for (let joint = 0; joint < NUM_JOINTS; joint++) this.#obs[index++] = qvel[this.#dofAdr[joint]];
    for (let joint = 0; joint < NUM_JOINTS; joint++) this.#obs[index++] = this.#lastAction[joint];
    this.#cmd.fill(0);
    if (this.#mode === "sit" || this.#mode === "sitting" || this.#mode === "standing") {
      this.#cmd[0] = this.#sitFlag;
    } else if (this.#pick) {
      // Ground pick is phase-driven: [cos, sin, 0] in the velocity slots.
      const angle = 2 * Math.PI * this.#pick.phase;
      this.#cmd[0] = Math.cos(angle);
      this.#cmd[1] = Math.sin(angle);
    } else if (!this.#grabbed && !this.#recovery) {
      const motion = this.#leases.current();
      let { forward, turn } = motion;
      if (typeof motion.heading === "number") {
        // The duck never turns its back on the viewer: whatever a caller asks
        // for, the target facing stays inside the ±FACING_HALF_CONE cone. The
        // bang-bang controller lets the facing wander HEADING_ENGAGE past its
        // target before it re-engages, so the target is inset by that much.
        const limit = FACING_HALF_CONE - HEADING_ENGAGE;
        const target = clamp(motion.heading, -limit, limit);
        const control = headingTurn(this.#facing(), target, this.#headingEngaged);
        this.#headingEngaged = control.engaged;
        turn = control.turn;
        if (turn) forward = Math.max(forward, HEADING_MIN_FORWARD);
      }
      if (this.#rollers()) {
        // BEST_roller was trained with no turning demand (cmd[2] always 0);
        // cmd_x: 0 = coast, > 0 = push, < 0 = brake — brake instead of
        // coasting away whenever nothing is driving.
        turn = 0;
        const speed = Math.hypot(this.#data.qvel[0], this.#data.qvel[1]);
        if (forward === 0 && speed > ROLLER_BRAKE_ABOVE) forward = ROLLER_BRAKE / ROLLER_MAX_FORWARD;
      } else if (forward > 0.2 && performance.now() - this.#lastLandingAt > GAIT_STALL_MS) {
        forward = Math.max(forward, this.#stilts > 0 ? STILT_MAX_FORWARD : GAIT_KICK);
      }
      // The stilt policies were trained up to 0.25 m/s but evaluated at 0.15;
      // keep the desktop duck on stilts at that gentler pace.
      if (this.#stilts > 0) forward = Math.min(forward, STILT_MAX_FORWARD);
      this.#cmd[0] = this.#rollers() ? forward * ROLLER_MAX_FORWARD
        : forward >= 0 ? forward * MAX_FORWARD : -forward * MAX_BACK;
      this.#cmd[2] = turn * MAX_TURN;
      if (this.#stilts > 0) this.#cmd[2] = clamp(this.#cmd[2], -STILT_MAX_TURN, STILT_MAX_TURN);
    }
    // Head slots cmd[3..6], EMA-smoothed like the robot runtime. The pick and
    // get-up policies were trained against zero-padded head commands.
    const zeroHead = this.#pick || this.#recovery;
    for (let h = 0; h < 4; h++) {
      this.#headSmooth[h] += HEAD_ALPHA * (this.#headTarget[h] - this.#headSmooth[h]);
      this.#cmd[3 + h] = zeroHead ? 0 : this.#headSmooth[h];
    }
    for (let command = 0; command < CMD_SIZE; command++) this.#obs[index++] = this.#cmd[command];
    return this.#obs;
  }

  // Camera bearing relative to the trunk's forward (+X) axis, from the MJCF
  // trunk quaternion's yaw. Positive MJCF yaw rate decreases it.
  #facing() {
    const q = this.#data.qpos; // [x y z qw qx qy qz ...]
    const yaw = Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
    return wrapAngle(this.#cameraBearing - yaw);
  }

  #projectedGravityZ() {
    const rotation = this.#data.body(this.#trunkId).xquat;
    this.#gravityQ.set(rotation[1], rotation[2], rotation[3], rotation[0]).conjugate();
    return this.#gravityV.set(0, 0, -1).applyQuaternion(this.#gravityQ).z;
  }

  async #controlStep() {
    if (this.#grabbed && this.#lift) {
      this.#holdLifted();
      this.#recenter();
      this.#soundStep();
      return;
    }
    const session = this.#recovery?.state === "recovering" ? this.#sessions.stand
      : this.#pick ? (this.#rollers() ? this.#sessions.crouch : this.#sessions.groundpick)
      : this.#mode === "walk" ? this.#sessions.walk
      : this.#sessions.sitstand;
    if (this.#recovery?.state !== "fallen") {
      const output = await session.run({ obs: new this.#ort.Tensor("float32", this.#buildObs(), [1, OBS_SIZE]) });
      const action = output.actions.data;
      this.#lastAction.set(action);
      for (let joint = 0; joint < NUM_JOINTS; joint++) {
        this.#data.ctrl[joint] = DEFAULT_POSE[joint] + action[joint];
      }
    }
    for (let step = 0; step < DECIMATION; step++) this.#mujoco.mj_step(this.#model, this.#data);
    this.#recenter();
    this.#soundStep();
    this.#advancePick();
    this.#updateRecovery();
  }

  // Held in the air: ease the trunk up to LIFT_HEIGHT and pin it there each
  // physics substep (level, current yaw, no velocity) while the legs relax to
  // the default pose. Gravity resumes the moment grab-end clears #lift.
  #holdLifted() {
    const q = this.#data.qpos;
    const v = this.#data.qvel;
    this.#lift.z += (this.#lift.target - this.#lift.z) * LIFT_SMOOTHING;
    const yaw = Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
    for (let joint = 0; joint < NUM_JOINTS; joint++) this.#data.ctrl[joint] = DEFAULT_POSE[joint];
    for (let step = 0; step < DECIMATION; step++) {
      q[0] = 0;
      q[1] = 0;
      q[2] = this.#lift.z;
      q[3] = Math.cos(yaw / 2);
      q[4] = 0;
      q[5] = 0;
      q[6] = Math.sin(yaw / 2);
      for (let i = 0; i < 6; i++) v[i] = 0;
      this.#mujoco.mj_step(this.#model, this.#data);
    }
  }

  // One-shot ground pick: peck the ground and stand back up (~2.8 s).
  #peck() {
    if (!this.#ready || this.#mode !== "walk" || this.#grabbed || this.#recovery || this.#suspended) return;
    this.#leases.clearAll();
    this.#mode = "peck";
    this.#pick = { phase: 0 };
    this.#emit();
  }

  #quack() {
    this.#quackAt = performance.now();
    this.#onSound({ name: "chirp" });
  }

  // Footsteps off ankle heights, landing thump off the trunk's vertical stop.
  #soundStep() {
    const now = performance.now();
    const xpos = this.#data.xpos;
    const z = this.#ankleIds.map((id) => xpos[id * 3 + 2]);
    const ground = Math.min(z[0], z[1]);
    for (let i = 0; i < 2; i++) {
      const gain = footLanding(this.#stepFeet[i], z[i], ground, CTRL_DT, now);
      if (gain !== null) {
        this.#lastLandingAt = now;
        this.#onSound({ name: "step", gain, rate: 0.9 + Math.random() * 0.25 });
        if (!this.#grabbed && !this.#recovery && !this.#pick && !this.#rollers()) this.#strideRemaining += STRIDE_M;
      }
    }
    if (this.#strideRemaining > 0) {
      const d = Math.min(this.#strideRemaining, STRIDE_M / STRIDE_SPREAD_STEPS);
      this.#strideRemaining -= d;
      const q = this.#data.qpos;
      const yaw = Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
      this.#displacement.x += d * Math.cos(yaw);
      this.#displacement.y += d * Math.sin(yaw);
    }
    const vz = this.#data.qvel[2];
    const impact = landingImpact(this.#prevVz, vz);
    this.#prevVz = vz;
    if (impact !== null && now - this.#thumpAt > 300) {
      this.#thumpAt = now;
      this.#onSound({ name: "thump", gain: 0.12 + 0.3 * impact, rate: 0.55 + 0.15 * impact + Math.random() * 0.06 });
    }
  }

  #advancePick() {
    if (!this.#pick) return;
    const oneShot = this.#rollers() ? ROLLER_CROUCH : GROUND_PICK;
    this.#pick.phase += CTRL_DT / oneShot.periodS;
    if (this.#pick.phase >= oneShot.endPhase) this.#cancelPeck();
  }

  #cancelPeck() {
    if (!this.#pick) return;
    this.#pick = null;
    this.#mode = "walk";
    this.#emit();
  }

  // Walk in place: pin the trunk to the window origin every control step so the
  // duck never leaves the fixed window. Yaw, height and velocities are untouched.
  #recenter() {
    const qpos = this.#data.qpos;
    // On wheels the trunk's translation is the real rolling distance (unlike
    // the walking policy's), so it is what free roam should follow.
    if (this.#rollers() && !this.#grabbed && !this.#recovery) {
      this.#displacement.x += qpos[0];
      this.#displacement.y += qpos[1];
    }
    qpos[0] = 0;
    qpos[1] = 0;
    this.#mujoco.mj_forward(this.#model, this.#data);
  }

  #updateRecovery() {
    if (this.#mode !== "walk" || this.#grabbed) return;
    const fallen = this.#projectedGravityZ() > -0.5 || this.#data.qpos[2] < 0.02 + 0.5 * (this.#stilts / 100);
    if (this.#recovery) {
      this.#recovery.steps++;
      if (this.#stilts > 0 || this.#rollers()) {
        // No get-up policy for stilts or rollers: after a moment on the ground
        // the duck is simply stood back up.
        if (this.#recovery.steps >= 50) this.#resetPhysics();
        return;
      }
      if (this.#recovery.state === "fallen" && this.#recovery.steps >= 15) {
        this.#recovery = { state: "recovering", steps: 0, upright: 0 };
        this.#lastAction.fill(0);
        this.#emit();
      } else if (this.#recovery.state === "recovering") {
        this.#recovery.upright = this.#projectedGravityZ() < -0.85 ? this.#recovery.upright + 1 : 0;
        if (this.#recovery.upright >= 50) {
          this.#recovery = null;
          this.#lastAction.fill(0);
          this.#emit();
        } else if (this.#recovery.steps >= 300) {
          this.#resetPhysics();
        }
      }
      return;
    }
    this.#fallDebounce = fallen ? this.#fallDebounce + 1 : 0;
    if (this.#fallDebounce >= 10) {
      this.#fallDebounce = 0;
      this.#leases.clearAll();
      this.#recovery = { state: "fallen", steps: 0, upright: 0 };
      this.#emit();
    }
  }

  async #controlLoop() {
    let next = performance.now();
    let steps = 0;
    let measuredAt = next;
    while (!this.#disposed) {
      if (this.#suspended || this.#rebuilding || !this.#data) {
        await delay(this.#rebuilding ? 50 : 200);
        next = performance.now();
        continue;
      }
      await this.#controlStep();
      steps++;
      const now = performance.now();
      if (now - measuredAt >= 750) {
        this.#ctrlHz = steps * 1000 / (now - measuredAt);
        steps = 0;
        measuredAt = now;
        this.#emit();
      }
      next += CTRL_DT * 1000;
      const wait = next - performance.now();
      if (wait > 0) await delay(wait);
      else next = performance.now();
    }
  }

  #renderLoop() {
    const render = (now) => {
      if (this.#disposed) return;
      this.#renderFrame = requestAnimationFrame(render);
      if (this.#sleeping && now - this.#lastSleepRender < 450) return;
      this.#lastSleepRender = now;
      if (this.#data && this.#trunk) {
        const qpos = this.#data.qpos;
        // Camera rig follows the trunk height exactly while the duck is carried
        // or airborne (a smoothed follow would lose a fast fall), and eases the
        // last centimetres back down after the landing instead of snapping.
        if (!this.#cameraBase) this.#cameraBase = this.#camera.position.clone();
        const height = Math.max(0, qpos[2] - this.#restHeight());
        this.#cameraLift = height > CAMERA_FOLLOW_DEADBAND ? height : this.#cameraLift * 0.75;
        this.#camera.position.copy(this.#cameraBase);
        this.#camera.position.y += this.#cameraLift;
        this.#camera.lookAt(0, this.#lookY + this.#cameraLift, 0);
        this.#trunk.position.set(qpos[0], qpos[1], qpos[2]);
        this.#trunk.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
        for (let joint = 0; joint < NUM_JOINTS; joint++) {
          setJoint(this.#rig, JOINT_NAMES[joint], qpos[this.#qposAdr[joint]]);
        }
        for (const wheel of this.#wheels) setJoint(this.#rig, wheel.name, qpos[wheel.adr]);
        setJawOpen(this.#rig, Math.min(1, pickJawOpenness(this.#pick?.phase) + quackJawOpenness(now - this.#quackAt)));
      }
      this.#renderer.render(this.#scene, this.#camera);
      this.#renderFrames++;
      if (now - this.#renderT0 >= 1_000) {
        this.#fps = this.#renderFrames * 1000 / (now - this.#renderT0);
        this.#renderFrames = 0;
        this.#renderT0 = now;
      }
    };
    this.#renderFrame = requestAnimationFrame(render);
  }

  #emit() {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
