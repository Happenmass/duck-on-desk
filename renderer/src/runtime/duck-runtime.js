import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import mujocoWasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { buildRig, geometryToBinaryStl, loadGlbGeometries, loadKinematics, MODEL_DIR, setJawOpen, setJoint } from "./duck.js";
import { DEFAULT_VARIANT, materialHookFor, VARIANTS, applyVariant } from "./variants.js";
import { ActionSequence } from "./action-sequence.js";
import holdReference from '../../../mcp/robot-lab/training/headstand-hold.json';
import { MotionLeases } from "./motion-leases.js";
import { normalizeStilts, STILT_BLEND, STILT_MAX_FORWARD, STILT_MAX_TURN, STILT_SERVO_GAIN, stiltFraming, stiltMassKg, stiltMeshData, stiltPolicyFile } from "./stilts.js";
import { normalizeLocomotion, ROLLER_BRAKE, ROLLER_BRAKE_ABOVE, ROLLER_CROUCH, ROLLER_MAX_FORWARD, ROLLER_POLICY_FILES, ROLLER_HALF_CONE, ROLLER_REST_HEIGHT, ROLLER_WHEEL_FRICTIONLOSS, ROLLER_WHEEL_JOINTS, ROLLER_YAW_RATE, yawTrunk } from "./rollers.js";
import {
  CMD_SIZE, CTRL_DT, DECIMATION, DEFAULT_POSE, FRAME_MS, FRAME_SLACK, JOINT_NAMES,
  MAX_BACK, MAX_FORWARD, MAX_TURN, NUM_JOINTS, OBS_SIZE, POLICY_FILES, TIMESTEP,
} from "./constants.js";
import {
  cameraLiftDecay, FACING_HALF_CONE, footLanding, GROUND_PICK, HEAD_ALPHA, HEAD_KEYS, HEAD_MAX, HEADING_ENGAGE, HEADING_MIN_FORWARD, headingTurn, landingImpact, pickJawOpenness,
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
const SLEEP_FRAME_MS = 450; // dozing: just enough to keep the breathing visible

// Radial falloff for the ground blob. CircleGeometry's UVs put the centre at
// (0.5, 0.5) and the rim on the texture edge, so the gradient lines up 1:1.
function blobShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.34)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.18)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export async function createDuckRuntime(options) {
  const runtime = new DuckRuntime(options);
  await runtime.init();
  return runtime;
}

class DuckRuntime {
  #lab = false;
  #labPaused = false;
  #labCommand = new Float32Array(13);
  #labManual = null;
  #labInFlight = null;
  #labVisuals = null;
  #labPolicySample = false;
  #labViewVisible = true;
  #orbit;
  #quality;
  #walkOverrideUrl = null;
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
  #rollerTurn = 0; // rollers: heading turn applied kinematically in #recenter()
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
  #actionSequence = null;
  #actionSession = null;
  #actionCatalog = [];
  #actionGeneration = 0;
  #actionLoading = false;
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
  #lastRenderAt = 0;
  #appearance = DEFAULT_VARIANT;
  #resizeObserver;
  #renderFrame;
  #gravityQ = new THREE.Quaternion();
  #gravityV = new THREE.Vector3();

  constructor({ container, policyUrl, onSound = () => {}, appearance = DEFAULT_VARIANT, stilts = 0, locomotion = "legs", mode = "pet", quality = {} }) {
    if (!container) throw new Error("DuckRuntime requires a container");
    if (!VARIANTS[appearance]) throw new Error(`unknown appearance: ${appearance}`);
    this.#lab = mode === "lab";
    this.#labPaused = this.#lab;
    this.#quality = { fps: this.#lab ? 60 : 30, pixelRatio: 2, shadows: this.#lab, ...quality };
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
      const url = name === "walk" && this.#locomotion === "legs" && this.#stilts === 0 && this.#walkOverrideUrl
        ? this.#walkOverrideUrl : this.#policyUrl(file);
      this.#sessions[name] = await this.#ort.InferenceSession.create(url, sessionOptions);
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
    if (this.#stilts > 0) this.#attachStiltVisuals();
    this.#scene.add(this.#rig.placer);
    if (this.#lab) this.#rig.placer.traverse(o => { if (o.isMesh) { o.castShadow = this.#quality.shadows; o.receiveShadow = true; } });
    this.#trunk = this.#rig.bodies.get("trunk_base");
    if (this.#lab) {
      const { createLabVisuals } = await import('./lab-visuals.js');
      this.#labVisuals = createLabVisuals({rig:this.#rig,scene:this.#scene,camera:this.#camera,orbit:this.#orbit});
    }
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
        await this.#labInFlight;
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
        for (const session of Object.values(this.#sessions)) await session.release?.();
        this.#sessions = {};
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
      mesh.position.set(site.pos[0], site.pos[1], site.pos[2]);
      mesh.quaternion.set(site.quat[1], site.quat[2], site.quat[3], site.quat[0]);
      ankle.add(mesh);
    }
  }

  // Rest framing: the stock camera for the bare duck, backed off and aimed
  // higher on stilts so the whole silhouette stays in the window.
  #frameCamera() {
    if (this.#lab) { this.#camera.position.set(0.36, 0.29, 0.5); this.#orbit.target.set(0, 0.13, 0); this.#orbit.update(); return; }
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
      case "cancel-action":
        this.#cancelAction();
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
        this.#cancelAction();
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
      action: this.#actionSequence ? { id: this.#actionSequence.action.id, phase: this.#actionSequence.phase } : null,
      forward: this.#leases.current().forward,
      busy: this.#actionLoading || !!this.#actionSequence || this.#grabbed || this.#sleeping || !!this.#recovery || this.#mode !== "walk",
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

  labSnapshot() {
    if (!this.#lab || !this.#data) return null;
    const velocity = this.#data.sensordata[this.#model.sensor("imu_lin_vel").adr];
    return { time: this.#data.time, paused: this.#labPaused, position: Array.from(this.#data.qpos.slice(0,3)),
      controlMode: this.#labManual ? 'manual' : 'policy',
      action: this.snapshot().action,
      observationSize: OBS_SIZE, outputSize: NUM_JOINTS, controlHz: 1 / CTRL_DT,
      policySample: this.#labPolicySample && !this.#labManual,
      velocity, upright: -this.#projectedGravityZ(),
      joints: JOINT_NAMES.map((name, i) => ({ name, outputIndex: i, position: this.#data.qpos[this.#qposAdr[i]],
        target: this.#labManual?.[i] ?? this.#data.ctrl[i], defaultPosition: DEFAULT_POSE[i],
        policyOutput: this.#labPolicySample && !this.#labManual ? this.#lastAction[i] : null,
        range: Array.from(this.#model.jnt(name).range) })) };
  }

  labView(action, value) {
    if (action === 'visible') { this.#labViewVisible = Boolean(value); return; }
    if (!this.#labVisuals) return [];
    if (action === 'project') return this.#labVisuals.project();
    if (action === 'select') this.#labVisuals.select(value);
    if (action === 'hologram') this.#labVisuals.hologram(value);
    if (action === 'camera') this.#labVisuals.view(value);
  }

  async labControl(action, value) {
    if (!this.#lab) throw new Error("Laboratory controls require a lab runtime");
    if (action === "play") { this.#labPaused = false; return; }
    this.#labPaused = true;
    await this.#labInFlight;
    if (action === "reset") { this.#resetPhysics(); this.#labManual = null; this.#labPolicySample = false; }
    else if (action === "step") await this.#controlStep();
    else if (action === "velocity") {
      const forward=Number(value.forward), turn=Number(value.turn);
      if (!Number.isFinite(forward)||!Number.isFinite(turn)) throw new Error("Invalid velocity command");
      this.#labCommand[0] = forward; this.#labCommand[2] = turn;
    }
    else if (action === "joint") {
      this.#cancelAction();
      const index = JOINT_NAMES.indexOf(value.name); if (index < 0 || !Number.isFinite(value.position)) throw new Error("Invalid joint target");
      this.#labManual ||= JOINT_NAMES.map((_,i) => this.#data.qpos[this.#qposAdr[i]]);
      const range = this.#model.jnt(value.name).range;
      this.#labManual[index] = clamp(value.position, range[0], range[1]);
      // Paused pose editing is immediate kinematics. Physics resumes only on Play/Step.
      // This prevents a saved target from looking like a broken slider while paused.
      for (let i = 0; i < NUM_JOINTS; i++) this.#data.qpos[this.#qposAdr[i]] = this.#labManual[i];
      this.#data.qvel.fill(0);
      this.#data.ctrl.set(this.#labManual);
      this.#lastAction.set(this.#labManual.map((v,i) => v - DEFAULT_POSE[i]));
      this.#mujoco.mj_forward(this.#model, this.#data);
    } else if (action === "policy") { this.#cancelAction(); this.#labManual = null; this.#labPolicySample = false; }
    return this.labSnapshot();
  }

  actions() { return [{ id: 'peck', name: '啄地', duration: 2.8 }, ...this.#actionCatalog]; }

  setActions(actions) {
    this.#actionCatalog = (Array.isArray(actions) ? actions : []).filter(a => a && /^run_[a-f0-9-]{36}$/.test(a.id) && a.contract === 'duck-lab-action-v1' && a.duration === 8 && typeof a.url === 'string').map(a=>({...a,officialObservations:a.policy_observations==='official-zero-commands-v1'}));
  }

  async playAction(id) {
    if (id === 'peck') { this.#peck(); return this.snapshot(); }
    const action = this.#actionCatalog.find(a => a.id === id);
    if (!action) throw new Error('动作不在已验证的动作库中');
    if (!this.#canAct()) return this.snapshot();
    const generation = ++this.#actionGeneration; this.#actionLoading = true; this.#emit();
    let session;
    try {
      session = await this.#ort.InferenceSession.create(action.url, { executionProviders: ['wasm'] });
      const result = await session.run({ obs: new this.#ort.Tensor('float32', new Float32Array(61), [1,61]) });
      if (result.actions?.data.length !== 14 || !Array.from(result.actions.data).every(Number.isFinite)) throw new Error('Invalid action policy output');
      if (this.#disposed || generation !== this.#actionGeneration) { await session.release(); return this.snapshot(); }
      this.#actionLoading = false;
      if (!this.#canAct()) { await session.release(); return this.snapshot(); }
      this.#actionSession = session; this.#beginAction(action); return this.snapshot();
    } catch (error) { await session?.release(); throw error; }
    finally { if (generation === this.#actionGeneration) { this.#actionLoading = false; this.#emit(); } }
  }

  #canAct() { return this.#ready && !this.#disposed && !this.#rebuilding && !this.#actionLoading && !this.#actionSequence && this.#mode === 'walk' && !this.#grabbed && !this.#recovery && !this.#suspended && this.#stilts === 0 && !this.#rollers(); }

  #beginAction(action) {
    this.#actionSequence = new ActionSequence(action);
    this.#strideRemaining = 0; this.#displacement.x = this.#displacement.y = 0;
    this.#headTarget.fill(0); this.#headSmooth.fill(0); this.#lastAction.fill(0); this.#emit();
  }

  #cancelAction() {
    ++this.#actionGeneration; this.#actionLoading = false;
    if (!this.#actionSequence) return;
    this.#actionSequence = null; this.#pick = null; this.#mode = 'walk';
    const session = this.#actionSession; this.#actionSession = null;
    // A user event can arrive while ONNX is in flight.
    if (session) void Promise.resolve(this.#labInFlight).finally(() => session.release());
    this.#emit();
  }

  #advanceAction() {
    const sequence = this.#actionSequence; if (!sequence) return;
    const previous = sequence.phase;
    const standing = -this.#projectedGravityZ() > 0.85 && this.#data.qpos[2] > 0.085 && Math.hypot(this.#data.qvel[0], this.#data.qvel[1]) < 0.08;
    const phase = sequence.advance(CTRL_DT, standing);
    if (phase === 'playing' && sequence.action.id === 'peck') this.#pick = { phase: sequence.elapsed / GROUND_PICK.periodS };
    else this.#pick = null;
    if (this.#lab && sequence.action.practice && previous==='playing' && phase==='returning') {
      this.#cancelAction(); this.#labPaused=true; return;
    }
    if (previous !== phase) { this.#lastAction.fill(0); this.#emit(); }
    if (phase === 'done' || phase === 'failed') {
      this.#cancelAction();
      if (this.#lab) this.#labPaused = true;
      if (phase === 'failed') this.#leases.clearAll();
    }
  }

  async loadWalkPolicy(url) {
    const next = await this.#ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
    try {
      const result = await next.run({ obs: new this.#ort.Tensor("float32", new Float32Array(61), [1,61]) });
      if (result.actions?.data.length !== 14 || !Array.from(result.actions.data).every(Number.isFinite)) throw new Error("Invalid policy output");
    } catch (error) { await next.release(); throw error; }
    await this.#labInFlight;
    const old = this.#sessions.walk; this.#sessions.walk = next; await old?.release();
  }

  async setLabPolicy(url) {
    this.#walkOverrideUrl = url || null;
    while (this.#rebuilding && !this.#disposed) await delay(20);
    if (this.#disposed || this.#locomotion !== "legs" || this.#stilts !== 0) return;
    await this.loadWalkPolicy(url || this.#policyUrl(POLICY_FILES.walk));
  }

  #initializeHeadstandHold() {
    this.#data.qpos.set(holdReference.root_position, 0);
    this.#data.qpos.set(holdReference.root_quaternion, 3);
    this.#data.qvel.fill(0);
    // A small reproducible initial disturbance; no forces or pose pinning later.
    this.#data.qvel.set([0.02, -0.02, 0.01], 3);
    for (let i=0;i<NUM_JOINTS;i++) {
      this.#data.qpos[this.#qposAdr[i]]=holdReference.joint_positions[i];
      this.#data.ctrl[i]=holdReference.joint_targets[i];
      this.#lastAction[i]=holdReference.joint_targets[i]-DEFAULT_POSE[i];
    }
    this.#mujoco.mj_forward(this.#model,this.#data);
  }

  async previewActionPolicy(url, id, {practice=false,nearStart=false,officialObservations=false} = {}) {
    if (!this.#lab) throw new Error('Candidate actions can only be previewed in the laboratory');
    await this.labControl('pause'); await this.labControl('reset'); this.#labCommand.fill(0);
    if (id !== 'peck') this.setActions([{id,url,name:'候选动作',contract:'duck-lab-action-v1',duration:8}]);
    await this.playAction(id); if(!this.#actionSequence)throw new Error('当前状态无法开始动作试播');
    this.#actionSequence.action.practice=practice;
    this.#actionSequence.action.officialObservations=officialObservations;
    if(nearStart){this.#initializeHeadstandHold();this.#actionSequence.phase='playing';this.#actionSequence.elapsed=0;}
    this.#labPaused = false;
  }

  async evaluateActionPolicy(url, {goal='dance',officialObservations=false} = {}) {
    if (!['dance','headstand','headstand-hold'].includes(goal)) throw new Error('Unknown action goal');
    const nearStart=goal==='headstand-hold',headstand=goal!=='dance';
    if (!this.#lab) throw new Error('Action evaluation requires the laboratory');
    await this.labControl('pause'); this.#resetPhysics(); this.#labManual = null; this.#labCommand.fill(0);
    if(nearStart)this.#initializeHeadstandHold();
    const session = await this.#ort.InferenceSession.create(url, {executionProviders:['wasm']});
    const sequence = new ActionSequence({id:'candidate',duration:8,officialObservations}); sequence.phase = 'playing';
    this.#actionSequence = sequence; this.#actionSession = session;
    let inverted = 0, hops = 0, air = 0, stable = 0, holding=0, longest=0, completed = 0, nonFinite = false;
    const floor = this.#model.geom('desktop_floor').id;
    const head=headstand?this.#model.body('jaw_soft').id:null;
    const feet=headstand?['left_foot_collision','right_foot_collision'].map(n=>this.#model.geom(n).id):[];
    try {
      for (let i=0;i<400;i++) {
        await this.#controlStep(); completed++;
        const state = this.labSnapshot();
        if (!state.position.every(Number.isFinite) || !Number.isFinite(state.upright)) { nonFinite = true; break; }
        const upside = state.upright < -0.7;
        if (upside) inverted += CTRL_DT;
        let contact = false;
        for (let c=0;c<this.#data.ncon;c++) { const point=this.#data.contact.get(c); if (point.geom1===floor||point.geom2===floor) contact=true; }
        if (upside && !contact) air++;
        else { if (upside && contact && air>=2) hops++; air=0; }
        if (headstand) {
          let headContact=false,feetContact=false,bodyContact=false,headX=0,headY=0,headPoints=0;
          for(let c=0;c<this.#data.ncon;c++) {
            const point=this.#data.contact.get(c); if(point.dist>0.001)continue;
            const g=point.geom1===floor?point.geom2:point.geom2===floor?point.geom1:-1;
            if(g<0)continue;
            if(this.#model.geom_bodyid[g]===head){headContact=true;headX+=point.pos[0];headY+=point.pos[1];headPoints++;}
            else if(feet.includes(g))feetContact=true;
            else bodyContact=true;
          }
          const feetHeight=Math.min(...feet.map(g=>this.#data.geom_xpos[g*3+2]));
          const gyro=this.#data.sensordata.slice(this.#gyroAdr,this.#gyroAdr+3);
          const com=this.#data.subtree_com;
          const offset=headPoints?Math.hypot(com[this.#trunkId*3]-headX/headPoints,com[this.#trunkId*3+1]-headY/headPoints):Infinity;
          const jointSpeed=Math.sqrt(this.#dofAdr.reduce((sum,adr)=>sum+this.#data.qvel[adr]**2,0)/NUM_JOINTS);
          const margin=Math.min(...JOINT_NAMES.map((name,i)=>{
            const limits=this.#model.jnt(name).range,position=this.#data.qpos[this.#qposAdr[i]];
            return Math.min(position-limits[0],limits[1]-position)/(limits[1]-limits[0]);
          }));
          const supported=state.upright<-.8&&headContact&&!feetContact&&!bodyContact&&feetHeight>.08
            &&feetHeight-state.position[2]>.04&&offset<.04&&margin>=-.02&&jointSpeed<2
            &&Math.hypot(...gyro)<1&&Math.hypot(this.#data.qvel[0],this.#data.qvel[1])<.1;
          holding=supported?holding+1:0;longest=Math.max(longest,holding);
        }
        stable = state.upright>0.85 && state.position[2]>0.085 && Math.hypot(this.#data.qvel[0],this.#data.qvel[1])<0.08 ? stable+1 : 0;
        if (i%25===0) await delay(0);
      }
      return {goal,evaluation_version:nearStart?holdReference.version:headstand?'headstand-posture-v2':'dance-v1',initialization:nearStart?'near-headstand':'standing',hold_seconds:holding*CTRL_DT,longest_hold_seconds:longest*CTRL_DT,steps:completed,inverted_seconds:inverted,inverted_hops:hops,standing:stable>=20,nonFinite,
        success:completed===400&&!nonFinite&&(headstand?holding>=100:inverted>=0.4&&hops>=1&&stable>=20)};
    } finally {
      this.#actionSession = null; this.#actionSequence = null; await session.release(); this.#resetPhysics();
    }
  }

  async evaluateWalkPolicy(url, targetSpeed = 0.15, steps = 250) {
    if (!this.#lab) throw new Error("Evaluation requires a world-coordinate lab runtime");
    await this.labControl("pause");
    const original = this.#sessions.walk;
    const baseline = await this.#ort.InferenceSession.create(this.#policyUrl(POLICY_FILES.walk), { executionProviders: ["wasm"] });
    let candidate;
    const measure = async (session) => {
      this.#sessions.walk = session; this.#labManual = null;
      let error = 0, falls = 0, nonFinite = false, completed = 0;
      this.#resetPhysics(); this.#labCommand.fill(0); this.#labCommand[0] = targetSpeed;
      let fallenBefore = false;
      for (let i = 0; i < steps; i++) {
        await this.#controlStep();
        const state = this.labSnapshot();
        if (!Number.isFinite(state.velocity) || !Number.isFinite(state.upright) || !state.position.every(Number.isFinite)) { nonFinite = true; break; }
        completed++;
        error += Math.abs(state.velocity-targetSpeed);
        const fallen = state.position[2] < 0.06 || state.upright < 0.4;
        if (fallen && !fallenBefore) falls++;
        fallenBefore ||= fallen;
        if (i % 25 === 0) await delay(0);
      }
      return { steps:completed, velocity_mae: completed ? error/completed : null, fall_rate: Math.min(1, falls), nonFinite };
    };
    try {
      const reference = await measure(baseline);
      candidate = await this.#ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
      return { ...await measure(candidate), baseline:reference };
    } finally { this.#sessions.walk = original; await baseline.release(); await candidate?.release(); this.#resetPhysics(); }
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#cancelAction();
    this.#disposed = true;
    this.#leases.clearAll();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#resizeObserver?.disconnect();
    cancelAnimationFrame(this.#renderFrame);
    this.#orbit?.dispose();
    this.#labVisuals?.dispose();
    const release = async () => {
      try { await this.#labInFlight; } catch {}
      for (const session of Object.values(this.#sessions)) await session.release?.();
      this.#sessions = {};
      this.#data?.delete?.(); this.#model?.delete?.();
      this.#scene?.environment?.dispose?.();
      this.#scene?.traverse(o => { if (o.material) for (const m of [o.material].flat()) { m.map?.dispose?.(); m.dispose?.(); } });
    };
    void release();
    this.#renderer?.dispose();
    this.#container.replaceChildren();
    this.#listeners.clear();
  }

  #setupRenderer() {
    this.#scene = new THREE.Scene();
    this.#camera = new THREE.PerspectiveCamera(32, 1, 0.02, 20);
    this.#camera.position.set(0.36, 0.23, 0.54);
    this.#camera.lookAt(0, 0.12, 0);
    // low-power keeps a dual-GPU Mac on the integrated chip (no-op on Apple silicon).
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !this.#lab, premultipliedAlpha: false, powerPreference: "low-power" });
    this.#renderer.setPixelRatio(Math.min(this.#quality.pixelRatio, window.devicePixelRatio || 1));
    this.#renderer.setClearColor(this.#lab ? 0x080f18 : 0x000000, this.#lab ? 1 : 0);
    this.#renderer.shadowMap.enabled = this.#quality.shadows;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#container.appendChild(this.#renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.#renderer);
    this.#scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    this.#scene.environmentIntensity = 0.32;
    pmrem.dispose();
    this.#scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2, 4, 2);
    key.castShadow = this.#quality.shadows;
    this.#scene.add(key);
    const rim = new THREE.DirectionalLight(this.#lab ? 0x75d6e4 : 0xffa45b, 0.75);
    rim.position.set(-2, 2, -2);
    this.#scene.add(rim);
    // A painted blob instead of a shadow map: the real shadow cost a second
    // pass over all 70 rig meshes every frame, and at pet size the two read the
    // same. Kept at the same footprint the ShadowMaterial circle had.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 40),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.4, 0.55, 1);
    if (!this.#lab) this.#scene.add(shadow);
    else {
      shadow.geometry.dispose(); shadow.material.map.dispose(); shadow.material.dispose();
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x080f18, toneMapped: false }));
      floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; this.#scene.add(floor);
      this.#scene.fog = new THREE.FogExp2(0x080f18, 0.7);
      const grid = new THREE.GridHelper(10, 100, 0x244b60, 0x172f40); grid.position.y = 0.0005; this.#scene.add(grid);
      this.#orbit = new OrbitControls(this.#camera, this.#renderer.domElement);
      this.#orbit.target.set(0, 0.12, 0); this.#orbit.maxDistance = 8; this.#orbit.minDistance = 0.2;
    }

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
    if (this.#rollers()) {
      for (const joint of doc.querySelectorAll('default[class="passive_joint"] > joint, default[class="passive_wheel"] > joint')) {
        joint.setAttribute("frictionloss", String(ROLLER_WHEEL_FRICTIONLOSS));
      }
    }
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
    this.#cancelAction();
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
    this.#rollerTurn = 0;
    this.#sleeping = false;
    this.#suspended = false;
    this.#mujoco.mj_resetDataKeyframe(this.#model, this.#data, this.#standKeyId);
    this.#mujoco.mj_forward(this.#model, this.#data);
    this.#lastAction.fill(0);
    this.#labPolicySample = false;
    this.#emit();
  }

  #sit() {
    this.#cancelAction();
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
    this.#cancelAction();
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
    if (this.#lab && !this.#actionSequence) {
      for (let command = 0; command < CMD_SIZE; command++) this.#obs[index++] = this.#labCommand[command];
      return this.#obs;
    }
    this.#cmd.fill(0);
    this.#rollerTurn = 0;
    if (this.#actionSequence) {
      const seq = this.#actionSequence;
      if (seq.phase === 'playing' && !seq.action.officialObservations) {
        const phase = seq.action.id === 'peck' ? seq.elapsed / GROUND_PICK.periodS : seq.elapsed / seq.action.duration;
        this.#cmd[0] = Math.cos(2 * Math.PI * phase); this.#cmd[1] = Math.sin(2 * Math.PI * phase);
        if (seq.action.id !== 'peck') this.#cmd[2] = phase;
      }
    } else if (this.#mode === "sit" || this.#mode === "sitting" || this.#mode === "standing") {
      this.#cmd[0] = this.#sitFlag;
    } else if (this.#pick) {
      // Ground pick is phase-driven: [cos, sin, 0] in the velocity slots.
      const angle = 2 * Math.PI * this.#pick.phase;
      this.#cmd[0] = Math.cos(angle);
      this.#cmd[1] = Math.sin(angle);
    } else if (!this.#grabbed && !this.#recovery) {
      const motion = this.#leases.current();
      let { forward, turn } = motion;
      // On wheels nothing holds the heading between leases (pushes drift the
      // yaw), so with no heading asked for the cone edge itself is the target.
      const heading = typeof motion.heading === "number" ? motion.heading
        : this.#rollers() ? this.#facing() : null;
      if (heading !== null) {
        // The duck never turns its back on the viewer: whatever a caller asks
        // for, the target facing stays inside the camera-facing cone. The
        // bang-bang controller lets the facing wander HEADING_ENGAGE past its
        // target before it re-engages, so the target is inset by that much.
        const limit = (this.#rollers() ? ROLLER_HALF_CONE : FACING_HALF_CONE) - HEADING_ENGAGE;
        const target = clamp(heading, -limit, limit);
        const control = headingTurn(this.#facing(), target, this.#headingEngaged);
        this.#headingEngaged = control.engaged;
        turn = control.turn;
        if (turn && !this.#rollers()) forward = Math.max(forward, HEADING_MIN_FORWARD);
      }
      if (this.#rollers()) {
        // BEST_roller was trained with no turning demand (cmd[2] always 0), so
        // the turn is applied kinematically in #recenter() instead;
        // cmd_x: 0 = coast, > 0 = push, < 0 = brake — brake instead of
        // coasting away whenever nothing is driving.
        // (The yaw only takes while rolling: a stationary four-wheel duck cannot
        // pivot against wheel friction, so a push is kept up through the turn.)
        this.#rollerTurn = turn;
        turn = 0;
        // The policy has one usable push: at smaller commands (0.6 → 0.2 m/s)
        // it creeps backwards for seconds, so any push becomes the full one.
        if (forward > 0) forward = 1;
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
    // Head slots cmd[3..6], EMA-smoothed like the robot runtime. The pick,
    // get-up and roller policies were trained against zero-padded head
    // commands (the roller env pads head and body commands with zeros), so
    // they must never see a head target.
    const zeroHead = this.#actionSequence || this.#pick || this.#recovery || this.#rollers();
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
    const pending = this.#doControlStep(); this.#labInFlight = pending;
    try { await pending; } finally { if (this.#labInFlight === pending) this.#labInFlight = null; }
  }

  async #doControlStep() {
    if (this.#grabbed && this.#lift) {
      this.#holdLifted();
      this.#recenter();
      this.#soundStep();
      return;
    }
    const actionPlaying = this.#actionSequence?.phase === 'playing';
    const session = actionPlaying ? (this.#actionSession || this.#sessions.groundpick)
      : this.#recovery?.state === "recovering" ? this.#sessions.stand
      : this.#pick ? (this.#rollers() ? this.#sessions.crouch : this.#sessions.groundpick)
      : this.#mode === "walk" ? this.#sessions.walk
      : this.#sessions.sitstand;
    if (this.#labManual) {
      this.#lastAction.set(this.#labManual.map((v,i) => v - DEFAULT_POSE[i]));
      this.#data.ctrl.set(this.#labManual);
    } else if (this.#recovery?.state !== "fallen") {
      const output = await session.run({ obs: new this.#ort.Tensor("float32", this.#buildObs(), [1, OBS_SIZE]) });
      const action = output.actions.data;
      if (action.length !== NUM_JOINTS || !Array.from(action).every(Number.isFinite)) { this.#cancelAction(); throw new Error('Non-finite policy output'); }
      this.#lastAction.set(action);
      if (this.#lab) this.#labPolicySample = true;
      for (let joint = 0; joint < NUM_JOINTS; joint++) {
        this.#data.ctrl[joint] = DEFAULT_POSE[joint] + action[joint];
      }
    }
    for (let step = 0; step < DECIMATION; step++) this.#mujoco.mj_step(this.#model, this.#data);
    this.#recenter();
    if (this.#actionSequence) this.#advanceAction();
    if (!this.#lab) { this.#soundStep(); if (!this.#actionSequence) { this.#advancePick(); this.#updateRecovery(); } }
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
    if (!this.#rollers()) {
      if (this.#canAct()) this.#beginAction({ id: 'peck', name: '啄地', duration: GROUND_PICK.periodS * GROUND_PICK.endPhase });
      return;
    }
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
        if (!this.#grabbed && !this.#recovery && !this.#pick && !this.#actionSequence && !this.#rollers()) this.#strideRemaining += STRIDE_M;
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
    if (this.#lab) { this.#mujoco.mj_forward(this.#model, this.#data); return; }
    const qpos = this.#data.qpos;
    // On wheels the trunk's translation is the real rolling distance (unlike
    // the walking policy's), so it is what free roam should follow.
    if (this.#rollers() && !this.#grabbed && !this.#recovery) {
      this.#displacement.x += qpos[0];
      this.#displacement.y += qpos[1];
      if (this.#rollerTurn) yawTrunk(qpos, this.#rollerTurn * ROLLER_YAW_RATE * CTRL_DT);
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
      if (this.#suspended || this.#rebuilding || !this.#data || (this.#lab && this.#labPaused)) {
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
      if (this.#lab && !this.#labViewVisible) return;
      // The slack only has to absorb half a display tick, so it applies to the
      // 30 fps budget; the dozing budget is a plain 450 ms as it always was.
      const budget = this.#sleeping ? SLEEP_FRAME_MS : (this.#lab ? 1000 / this.#quality.fps : FRAME_MS) * FRAME_SLACK;
      if (now - this.#lastRenderAt < budget) return;
      const sinceLastRender = now - this.#lastRenderAt;
      this.#lastRenderAt = now;
      if (this.#data && this.#trunk) {
        const qpos = this.#data.qpos;
        // Camera rig follows the trunk height exactly while the duck is carried
        // or airborne (a smoothed follow would lose a fast fall), and eases the
        // last centimetres back down after the landing instead of snapping.
        if (!this.#lab) {
        if (!this.#cameraBase) this.#cameraBase = this.#camera.position.clone();
        const height = Math.max(0, qpos[2] - this.#restHeight());
        this.#cameraLift = height > CAMERA_FOLLOW_DEADBAND
          ? height
          : cameraLiftDecay(this.#cameraLift, sinceLastRender);
        this.#camera.position.copy(this.#cameraBase);
        this.#camera.position.y += this.#cameraLift;
        this.#camera.lookAt(0, this.#lookY + this.#cameraLift, 0);
        }
        this.#trunk.position.set(qpos[0], qpos[1], qpos[2]);
        this.#trunk.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
        for (let joint = 0; joint < NUM_JOINTS; joint++) {
          setJoint(this.#rig, JOINT_NAMES[joint], qpos[this.#qposAdr[joint]]);
        }
        for (const wheel of this.#wheels) setJoint(this.#rig, wheel.name, qpos[wheel.adr]);
        setJawOpen(this.#rig, Math.min(1, pickJawOpenness(this.#pick?.phase) + quackJawOpenness(now - this.#quackAt)));
        this.#labVisuals?.update();
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
