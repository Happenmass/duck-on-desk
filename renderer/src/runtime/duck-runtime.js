import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import mujocoWasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { buildRig, geometryToBinaryStl, loadGlbGeometries, loadKinematics, MODEL_DIR, setJawOpen, setJoint } from "./duck.js";
import { DEFAULT_VARIANT, materialHookFor, VARIANTS, applyVariant } from "./variants.js";
import { MotionLeases } from "./motion-leases.js";
import {
  CMD_SIZE, CTRL_DT, DECIMATION, DEFAULT_POSE, JOINT_NAMES, MAX_BACK, MAX_FORWARD,
  MAX_TURN, NUM_JOINTS, OBS_SIZE, POLICY_FILES, TIMESTEP,
} from "./constants.js";
import {
  footLanding, GROUND_PICK, HEAD_ALPHA, HEAD_KEYS, HEAD_MAX, HEADING_MIN_FORWARD, headingTurn, landingImpact, pickJawOpenness,
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
  #displacement = { x: 0, y: 0 }; // trunk x/y travelled since takeDisplacement() (rig frame, metres)
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

  constructor({ container, policyUrl, onSound = () => {}, appearance = DEFAULT_VARIANT }) {
    if (!container) throw new Error("DuckRuntime requires a container");
    if (!VARIANTS[appearance]) throw new Error(`unknown appearance: ${appearance}`);
    this.#container = container;
    this.#policyUrl = policyUrl;
    this.#onSound = onSound;
    this.#appearance = appearance;
  }

  async init() {
    this.#setupRenderer();
    const [{ default: loadMujocoFactory }, ort, k, physics] = await Promise.all([
      import("@mujoco/mujoco"),
      import("onnxruntime-web/wasm"),
      loadKinematics(`${MODEL_DIR}/kinematics.json`),
      this.#buildPhysicsXml(),
    ]);
    this.#ort = ort;
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
    ort.env.wasm.numThreads = 1;

    this.#mujoco = await loadMujocoFactory({ locateFile: (name) => name.endsWith(".wasm") ? mujocoWasmUrl : name });
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
    const sessionEntries = Object.entries(POLICY_FILES);
    await Promise.all(sessionEntries.map(async ([name, file]) => {
      this.#sessions[name] = await ort.InferenceSession.create(this.#policyUrl(file), sessionOptions);
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

    this.#rig = await buildRig(k, { materialForMesh: materialHookFor(VARIANTS[this.#appearance]) });
    this.#rig.placer.rotation.y = -Math.PI / 2;
    this.#rig.root.traverse((object) => {
      if (object.isMesh) object.castShadow = true;
    });
    this.#scene.add(this.#rig.placer);
    this.#trunk = this.#rig.bodies.get("trunk_base");
    // Camera bearing in the MJCF world frame (the trunk's parent frame): the
    // trunk is pinned at the origin, so this is constant.
    this.#scene.updateMatrixWorld(true);
    const cameraLocal = this.#trunk.parent.worldToLocal(this.#camera.position.clone());
    this.#cameraBearing = Math.atan2(cameraLocal.y, cameraLocal.x);
    this.#resetPhysics();
    this.#ready = true;
    this.#emit();
    this.#controlLoop();
    this.#renderLoop();
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
      case "perform":
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
    });
  }

  // Screen-space distance (px, +x right, +y down) the trunk actually walked
  // since the last call, projected through the live camera. Free roam moves
  // the window by exactly this so the window follows the duck's own gait.
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
    const source = await (await fetch(`${MODEL_DIR}/robot_allcollisions.xml`)).text();
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
    doc.documentElement.appendChild(element("option", { timestep: String(TIMESTEP) }));
    doc.querySelector("worldbody").appendChild(element("geom", {
      name: "desktop_floor", type: "plane", size: "0 0 0.05", pos: "0 0 0",
    }));
    const byName = new Map(JOINT_NAMES.map((name, index) => [name, DEFAULT_POSE[index]]));
    const joints = [...doc.querySelectorAll("body > joint")]
      .map((joint) => byName.get(joint.getAttribute("name")) ?? 0).join(" ");
    const keyframe = doc.createElement("keyframe");
    keyframe.appendChild(element("key", {
      name: "STAND",
      qpos: `0 0 0.12 1 0 0 0 ${joints}`,
      ctrl: Array.from(DEFAULT_POSE).join(" "),
    }));
    doc.documentElement.appendChild(keyframe);
    return {
      xml: new XMLSerializer().serializeToString(doc),
      meshFiles: [...doc.querySelectorAll("asset > mesh")].map((mesh) => mesh.getAttribute("file")),
    };
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
    if (!this.#ready || this.#mode === "sit" || this.#pick) return;
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
      this.#mode = "sit";
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
        const control = headingTurn(this.#facing(), motion.heading, this.#headingEngaged);
        this.#headingEngaged = control.engaged;
        turn = control.turn;
        if (turn) forward = Math.max(forward, HEADING_MIN_FORWARD);
      }
      this.#cmd[0] = forward >= 0 ? forward * MAX_FORWARD : -forward * MAX_BACK;
      this.#cmd[2] = turn * MAX_TURN;
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
      : this.#pick ? this.#sessions.groundpick
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
      if (gain !== null) this.#onSound({ name: "step", gain, rate: 0.9 + Math.random() * 0.25 });
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
    this.#pick.phase += CTRL_DT / GROUND_PICK.periodS;
    if (this.#pick.phase >= GROUND_PICK.endPhase) this.#cancelPeck();
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
    this.#displacement.x += qpos[0];
    this.#displacement.y += qpos[1];
    qpos[0] = 0;
    qpos[1] = 0;
    this.#mujoco.mj_forward(this.#model, this.#data);
  }

  #updateRecovery() {
    if (this.#mode !== "walk" || this.#grabbed) return;
    const fallen = this.#projectedGravityZ() > -0.5 || this.#data.qpos[2] < 0.02;
    if (this.#recovery) {
      this.#recovery.steps++;
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
      if (this.#suspended) {
        await delay(200);
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
        const height = Math.max(0, qpos[2] - REST_HEIGHT);
        this.#cameraLift = height > CAMERA_FOLLOW_DEADBAND ? height : this.#cameraLift * 0.75;
        this.#camera.position.copy(this.#cameraBase);
        this.#camera.position.y += this.#cameraLift;
        this.#camera.lookAt(0, REST_HEIGHT + this.#cameraLift, 0);
        this.#trunk.position.set(qpos[0], qpos[1], qpos[2]);
        this.#trunk.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
        for (let joint = 0; joint < NUM_JOINTS; joint++) {
          setJoint(this.#rig, JOINT_NAMES[joint], qpos[this.#qposAdr[joint]]);
        }
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
