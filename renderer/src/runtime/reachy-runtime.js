import * as THREE from "three";
import { loadReachyRig } from "./reachy-rig.js";
import { neutralPose, createReachyMotion } from "./reachy-motion.js";

export async function createReachyRuntime({ container, api, audio }) {
  const rig = await loadReachyRig();
  const scene = new THREE.Scene(); scene.add(rig.root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaabbd0, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.3, 0.5, 0.8); scene.add(key);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; container.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10);
  camera.position.set(0.18, 0.33, 0.8); camera.lookAt(0, 0.2, 0);
  const resize = () => { const w = container.clientWidth || 240, h = container.clientHeight || 240; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  let current = "duck-idle", pose = neutralPose(), status = { connected: false };
  let glance = {}, glanceUntil = 0, disposed = false, frame, lastTime = performance.now();
  const started = lastTime;
  const motion = createReachyMotion();
  function acceptStatus(next) {
    if (!next || disposed) return;
    if (next.connected && !status.connected && next.pose) pose = next.pose;
    if (!next.connected && status.connected && status.pose) pose = status.pose;
    if (next.connected !== status.connected || (status.waking && !next.waking)) motion.resetPose(next.pose || pose);
    status = next; audio.setRobotConnected(next.connected);
    container.dataset.connection = next.state || "offline";
    container.title = next.connected ? `Reachy Mini · ${next.name} · ${next.state}` : "Reachy Mini · Desktop audio";
  }
  const unsubscribe = api?.onReachyStatus?.(acceptStatus);
  if (api?.getReachyStatus) acceptStatus(await api.getReachyStatus());
  function render(now) {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    if (!status.connected) {
      pose = motion.step(current, (now - started) / 1000, dt, now < glanceUntil ? glance : {});
    }
    rig.setPose(status.connected && status.pose ? status.pose : pose);
    renderer.render(scene, camera); frame = requestAnimationFrame(render);
  }
  frame = requestAnimationFrame(render);
  const runtime = {
    applyVisual(file) {
      current = file;
    },
    eye(dx, dy) {
      if (current !== "duck-idle") return;
      glance = { yaw: THREE.MathUtils.clamp(-dx / 600, -0.2, 0.2), pitch: THREE.MathUtils.clamp(dy / 900, -0.12, 0.12) };
      glanceUntil = performance.now() + 1200;
    },
    command(intent) {
      if (intent.type === "wake") runtime.applyVisual("duck-waking");
      // Dragging moves only the desktop window. Reachy has no mobile base;
      // never translate a screen drag/lift into a physical robot movement.
    },
    snapshot: () => ({ robot: "reachy-mini", mode: "walk", sleeping: status.connected ? status.sleeping === true : current === "duck-sleeping", motionEnabled: status.motionEnabled === true, motionState: status.motionState || null, busy: !!status.motionState, facing: 0, height: 0.12, restHeight: 0.12, appearance: "classic", connection: status.state, pose: status.connected ? status.pose : pose }),
    dispose() { disposed = true; cancelAnimationFrame(frame); unsubscribe?.(); observer.disconnect(); rig.dispose(); renderer.dispose(); container.replaceChildren(); },
  };
  return runtime;
}
