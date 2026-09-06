"use strict";

const { EventEmitter } = require("node:events");
const dns = require("node:dns").promises;
const WebSocket = require("ws");

const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;
// Torque-on and the official moves run real hardware; they routinely need
// longer than the 2 s that suits a status read.
const LIFECYCLE_TIMEOUT = 10000;

function daemonUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const u = new URL(value.includes("://") ? value : `http://${value}`);
    if (u.protocol !== "http:" || u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
    if (!u.port) u.port = "8000";
    return u.origin;
  } catch { return null; }
}

function normalizeAntennas(values) {
  // Encoders can wrap the folded left antenna to -pi. Keep each antenna
  // on its resting branch so wake unfolds instead of rotating a full turn.
  return values.map((v, i) => {
    const wrapped = Math.atan2(Math.sin(v), Math.cos(v));
    if (i === 0 && wrapped > Math.PI / 2) return wrapped - 2 * Math.PI;
    if (i === 1 && wrapped < -Math.PI / 2) return wrapped + 2 * Math.PI;
    return wrapped;
  });
}

// The one wake decision, shared by the client guard, the semantic lifecycle and
// the menu. Our own sleep bookkeeping is not enough: an enable that landed while
// the wake never ran leaves the robot torqued at the folded pose (head z ≈ -46
// mm) with `sleptByUs` false, and it must still be woken. The measured pose
// decides that case; the daemon's own wake_up no-ops if it disagrees.
function needsWake(snapshot) {
  if (!snapshot || !snapshot.connected) return false;
  return !snapshot.motionEnabled || snapshot.sleeping === true || !!(snapshot.pose && snapshot.pose.head[11] < -0.03);
}

// The daemon's volume percent lands 1:1 on the "PCM Playback Volume" control of
// the Reachy Mini Audio board, which is dB-linear: 60 steps from -60 dB to 0 dB
// (amixer cget, 2026-09-06). A linear percent is therefore nearly silent below
// ~70 (40 % = -36 dB, the "no sound" of the first live test). Map the app's
// amplitude-style volume (an HTMLAudio gain) onto that scale so the robot is
// about as loud as the desktop would be: 1 -> 100, 0.4 -> 87, 0.1 -> 67, 0 -> 0.
const ROBOT_VOLUME_DB_RANGE = 60; // ponytail: measured on this board; the one knob if the audio hardware changes
function robotVolumePercent(gain) {
  if (!(gain > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 + 20 * Math.log10(Math.min(1, gain)) / ROBOT_VOLUME_DB_RANGE))));
}

// Owns one LAN robot. No cloud account, microphone, camera, or Python process.
class ReachyMiniClient extends EventEmitter {
  constructor({ fetchImpl = fetch, WebSocketImpl = WebSocket, discover, now = Date.now } = {}) {
    super();
    this.fetch = fetchImpl;
    this.WS = WebSocketImpl;
    this.discover = discover || ((found) => {
      const { Bonjour } = require("bonjour-service");
      const bonjour = new Bonjour({}, () => {});
      const browser = bonjour.find({ type: "reachy-mini" }, service => { void found(service); });
      return () => { browser.stop(); bonjour.destroy(); };
    });
    this.now = now;
    this.status = { connected: false, state: "offline", name: null, url: null, motionEnabled: false };
    this.pose = null;
    this.generation = 0;
    this.candidates = new Set();
    this.uploaded = new Set();
    // The robot's own volume, read once per start() and restored by stop().
    this.originalVolume = null;
    this.audioGeneration = 0;
    this.playingId = 0;
  }
  snapshot() {
    return {
      ...this.status,
      sleeping: this.sleptByUs === true && this.status.motionEnabled === false,
      motionState: this.motionAction || null,
      waking: this.motionAction === "wake_up",
      pose: this.pose,
    };
  }
  publish(patch) { Object.assign(this.status, patch); this.emit("status", this.snapshot()); }

  start(host = "") {
    this.stop();
    this.enabled = true;
    const explicit = daemonUrl(host);
    this.candidates = new Set(explicit ? [explicit] : ["http://reachy-mini.local:8000", "http://localhost:8000"]);
    if (!explicit) {
      try { this.stopDiscovery = this.discover(service => this.addCandidates(service)); }
      catch { /* DNS discovery unavailable: named host probes still work. */ }
    }
    this.timer = setInterval(() => {
      if (this.socket && this.now() - this.lastMessage > 3000) this.disconnect("offline");
      void this.probe();
    }, 2000);
    this.timer.unref?.();
    void this.probe();
  }
  // mDNS here answers with an empty `addresses` list, and the `.local` name
  // resolves IPv6-first, so probing the name alone can miss a reachable robot.
  // The multicast sender (`referer`) is the robot itself; an A-record lookup is
  // the second route. The name stays as a fallback candidate either way.
  async addCandidates(service) {
    if (!service || !this.enabled) return;
    const hosts = (service.addresses || []).filter(a => IPV4.test(a));
    if (!hosts.length && IPV4.test(service.referer?.address || "")) hosts.push(service.referer.address);
    if (!hosts.length && service.host) {
      try { hosts.push((await dns.lookup(service.host, { family: 4 })).address); } catch { /* name may be IPv6-only */ }
    }
    if (service.host) hosts.push(service.host);
    const urls = hosts.map(host => daemonUrl(`${host}:${service.port}`)).filter(url => url && !this.candidates.has(url));
    if (!urls.length) return;
    // Probe the resolved IPv4 ahead of every older candidate: the `.local` name
    // is tried first otherwise, and each name probe can stall for the full
    // timeout in front of a robot that is reachable by address.
    this.candidates = new Set([...urls, ...this.candidates]);
    if (this.enabled) await this.probe();
  }
  stop() {
    void this.stopSound();
    // Volume is a device-global robot setting other apps inherit. Hand back what
    // we found; there is no verification window left, so let the socket close
    // gracefully instead of terminating the restore mid-flush.
    const socket = this.socket;
    if (Number.isFinite(this.originalVolume) && this.sendVolume(this.originalVolume)) {
      this.socket = null;
      try { socket.close(); } catch { socket.terminate(); }
    }
    this.originalVolume = null;
    this.enabled = false;
    this.generation++;
    clearInterval(this.timer);
    this.stopDiscovery?.(); this.stopDiscovery = null;
    this.disconnect("offline");
  }
  disconnect(state) {
    // Every physical connection lifetime is a distinct generation, even when
    // mDNS reconnects to the same URL. In-flight commands from the old socket
    // must never become valid again on the replacement robot connection.
    this.generation++;
    this.audioGeneration++;
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
    this.pose = null;
    this.sleptByUs = false;
    this.motionAction = null;
    this.playingAudio = false;
    this.uploaded.clear();
    // Errors describe the connection that just ended; they must not follow the
    // next robot into every later snapshot.
    this.publish({ connected: false, state, motionEnabled: false, url: null, motionError: null, audioError: null });
  }
  // 2 s suits the small reads; a sound upload is megabytes over Wi-Fi and
  // enabling torque runs the daemon's own homing. Failures name the request:
  // the dialog is the only place a user sees which call gave up.
  async request(url, path, options = {}, timeout = 2000) {
    const label = `${options.method || "GET"} ${path}`;
    let res;
    try {
      res = await this.fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(timeout), redirect: "error" });
    } catch (error) {
      throw new Error(error?.name === "TimeoutError" ? `${label} timed out after ${timeout / 1000} s` : `${label} failed: ${error?.message || error}`);
    }
    if (!res.ok) throw new Error(`${label} failed: HTTP ${res.status}`);
    return res.json();
  }
  async probe() {
    if (!this.enabled || this.socket || this.probing) return;
    this.probing = true;
    const generation = this.generation;
    try {
      for (const url of this.candidates) {
        if (!this.enabled || generation !== this.generation) break;
        try {
          const status = await this.request(url, "/api/daemon/status");
          if (!this.enabled || generation !== this.generation) break;
          if (status.state !== "running" || typeof status.robot_name !== "string" || status.simulation_enabled || status.mockup_sim_enabled) continue;
          // Read the robot's own volume before the socket exists, i.e. before
          // any set_volume of ours can overwrite what stop() has to give back.
          if (!Number.isFinite(this.originalVolume)) {
            try {
              const current = await this.request(url, "/api/volume/current");
              if (Number.isFinite(current.volume)) this.originalVolume = current.volume;
            } catch { /* Volume is optional; never block the connection. */ }
            if (!this.enabled || generation !== this.generation) break;
          }
          this.open(url, status);
          break;
        } catch { /* A missing robot never prevents the desktop pet loading. */ }
      }
    } finally { this.probing = false; }
  }
  open(url, status) {
    const socket = new this.WS(`${url.replace(/^http:/, "ws:")}/ws/sdk`, { handshakeTimeout: 2000, maxPayload: 1024 * 1024 });
    this.socket = socket;
    this.lastMessage = this.now();
    this.publish({ state: "connecting", name: status.robot_name, url });
    socket.on("error", () => { if (this.socket === socket) this.disconnect("offline"); });
    socket.on("close", () => { if (this.socket === socket) this.disconnect("offline"); });
    let head = null, antennas = null, body = 0;
    let motorEnabled = status.backend_status?.motor_control_mode === "enabled", motorsReported = false;
    socket.on("message", data => {
      if (this.socket !== socket) return;
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === "head_pose" && Array.isArray(m.head_pose)) {
        const flat = m.head_pose.flat();
        if (flat.length === 16 && flat.every(Number.isFinite)) head = flat;
      } else if (m.type === "joint_positions") {
        if (Array.isArray(m.antennas_joint_positions) && m.antennas_joint_positions.length === 2 && m.antennas_joint_positions.every(Number.isFinite)) antennas = normalizeAntennas(m.antennas_joint_positions);
        if (Number.isFinite(m.head_joint_positions?.[0])) body = m.head_joint_positions[0];
      } else if (m.type === "daemon_status") {
        if (m.state !== "running") { this.disconnect("offline"); return; }
        motorEnabled = m.backend_status?.motor_control_mode === "enabled";
        motorsReported = true;
      } else return;
      this.lastMessage = this.now();
      if (head && antennas) {
        this.pose = { head: [...head], antennas: [...antennas], body_yaw: body };
        // Motor mode comes from the daemon's own status messages and from the
        // REST checks after our lifecycle moves. A pose frame carries none, so it
        // must not resurrect the connect-time value over a verified one (that
        // made a robot we had just put to sleep look awake until the next
        // daemon_status, and the menu wake then skipped torque-on).
        if (!this.status.connected || motorsReported) {
          this.status.motionEnabled = motorEnabled;
          this.status.state = motorEnabled ? "connected" : "motors-disabled";
          motorsReported = false;
        }
        this.status.connected = true;
        // Feedback drives the avatar, not a second independently timed motion.
        this.emit("status", this.snapshot());
      }
    });
  }

  // Streamed liveliness target (row-major 4x4 head matrix, antenna radians).
  // The daemon ignores it while one of its own moves is running.
  sendTarget(head, antennas, bodyYaw = null) {
    if (!this.socket || this.socket.readyState !== 1 || !this.status.connected) return false;
    const msg = { type: "set_full_target" };
    if (head) msg.head = head;
    if (antennas) msg.antennas = antennas;
    if (Number.isFinite(bodyYaw)) msg.body_yaw = bodyYaw;
    this.socket.send(JSON.stringify(msg));
    return true;
  }
  // The one physical write shared by the app volume and the restore on stop().
  sendVolume(volume) {
    if (!this.status.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: "set_volume", volume }));
    return true;
  }
  async setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    const apply = async () => {
      const volume = robotVolumePercent(this.volume), url = this.status.url;
      if (!this.sendVolume(volume)) return;
      // SDK socket commands are fire-and-forget in 1.9.0. Verify via REST;
      // REST /volume/set would play an unwanted test sound.
      for (let i = 0; i < 10; i++) {
        if (!this.status.connected || this.status.url !== url) throw new Error("Robot disconnected during volume change");
        const actual = await this.request(url, "/api/volume/current");
        if (actual.volume === volume) { if (this.status.audioError) this.publish({ audioError: null }); return; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("Robot volume could not be verified");
    };
    this.volumePending = (this.volumePending || Promise.resolve()).catch(() => {}).then(apply);
    return this.volumePending;
  }

  wakeUp() { return this.runNativeMove("wake_up"); }
  goToSleep() { return this.runNativeMove("goto_sleep"); }
  // Decorative moves the daemon owns end to end, sound included. They share the
  // lifecycle queue, so an expression can never overlap a wake or a sleep.
  playRecordedMove(dataset, name) {
    return this.runNativeMove(`recorded-move-dataset/${encodeURIComponent(dataset)}/${encodeURIComponent(name)}`, `expression:${name}`);
  }
  async listRecordedMoves(dataset) {
    const list = await this.request(this.status.url, `/api/move/recorded-move-datasets/list/${encodeURIComponent(dataset)}`, {}, LIFECYCLE_TIMEOUT);
    return (Array.isArray(list) ? list : []).map(move => typeof move === "string" ? move : move?.name).filter(name => typeof name === "string");
  }
  // `label` is what the UI sees; `action` is the daemon path.
  runNativeMove(action, label = action) {
    // Serialize transitions; never retry a physical action after an uncertain ACK.
    const requestedGeneration = this.generation;
    const run = async () => {
      if (requestedGeneration !== this.generation) throw new Error("Robot connection changed before movement");
      if (!this.status.connected) throw new Error("Reachy Mini is disconnected");
      if (action === "goto_sleep" && !this.status.motionEnabled) return;
      // An already-awake robot standing at its idle pose needs no wake movement.
      if (action === "wake_up" && !needsWake(this.snapshot())) return;
      // Volume sync is best-effort: a robot that answers the wrong volume, or
      // answers slowly, must never cancel the physical lifecycle move.
      const volumeSynced = this.setVolume(this.volume ?? 1).catch(error => { if (this.status.connected) this.publish({ audioError: error.message }); });
      // The daemon plays wake_up.wav itself, right after torque-on, so the wake
      // alone waits — bounded — for our volume to land first. Sleep and
      // expressions stay unblocked.
      if (action === "wake_up") await Promise.race([volumeSynced, new Promise(resolve => { const t = setTimeout(resolve, 1500); t.unref?.(); })]);
      if (requestedGeneration !== this.generation) throw new Error("Robot connection changed before movement");
      if (action === "wake_up") {
        // A folded head under a daemon that still says "enabled" means torque
        // was lost without the daemon noticing (servo reboot or a power dip:
        // 2026-09-06, all motors limp mid-session, no hardware error flagged).
        // Re-arm torque first; enable_motors pins targets to the present pose,
        // so nothing jumps, and the official wake then raises the head.
        if (this.status.motionEnabled && needsWake(this.snapshot())) await this.disableMotion();
        await this.enableMotion();
      }
      if (!this.status.connected) throw new Error("Reachy Mini is disconnected");
      const url = this.status.url, generation = this.generation;
      this.motionAction = label; this.playingAudio = true; this.publish({});
      try {
        let uuid = null;
        try {
          const move = await this.request(url, `/api/move/play/${action}`, { method: "POST" }, LIFECYCLE_TIMEOUT);
          if (typeof move.uuid !== "string") throw new Error("Robot did not accept movement");
          uuid = move.uuid;
        } catch (error) {
          // The move may have started before the answer was lost. Replaying it
          // would run the physical action twice, so the daemon's own running
          // list decides; an idle daemon means it never started.
          const running = await this.request(url, "/api/move/running").catch(() => []);
          if (!Array.isArray(running) || !running.length) throw error;
        }
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          if (!this.status.connected || this.status.url !== url || generation !== this.generation) throw new Error("Robot disconnected during movement");
          const running = await this.request(url, "/api/move/running");
          if (Array.isArray(running) && (uuid ? !running.some(m => m.uuid === uuid) : !running.length)) {
            // An expression changes neither torque nor the rest pose: the
            // daemon reporting it finished is the whole result.
            if (action !== "wake_up" && action !== "goto_sleep") return;
            const motors = await this.request(url, "/api/motors/status");
            if (action === "goto_sleep") {
              if (motors.mode !== "disabled") throw new Error("Sleep ended without disabling motors");
              this.sleptByUs = true;
              this.publish({ motionEnabled: false, state: "motors-disabled" });
            } else {
              const p = this.pose;
              if (motors.mode !== "enabled" || !p || Math.abs(p.head[11]) >= 0.015 || p.antennas.some((a, i) => Math.abs(a - [-0.1745, 0.1745][i]) >= 0.35)) throw new Error("Wake ended without reaching idle");
              this.sleptByUs = false;
            }
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error("Robot movement timed out");
      } finally { this.motionAction = null; this.playingAudio = false; this.publish({}); }
    };
    this.movePending = (this.movePending || Promise.resolve()).catch(() => {}).then(run);
    return this.movePending;
  }
  async disableMotion() {
    if (!this.status.connected) throw new Error("Reachy Mini is disconnected");
    const url = this.status.url;
    const failure = await this.request(url, "/api/motors/set_mode/disabled", { method: "POST" }, LIFECYCLE_TIMEOUT).then(() => null, error => error);
    const motors = await this.request(url, "/api/motors/status", {}, LIFECYCLE_TIMEOUT);
    if (motors.mode !== "disabled") throw new Error(failure ? `${failure.message}; motors still enabled` : "Reachy Mini motors did not disable");
    if (this.status.connected && this.status.url === url) this.publish({ motionEnabled: false, state: "motors-disabled" });
  }
  async enableMotion() {
    if (!this.status.connected) throw new Error("Reachy Mini is disconnected");
    if (this.status.motionEnabled) return;
    const url = this.status.url;
    // Explicit user wake only. The daemon pins targets to the measured pose
    // before enabling torque; its official wake movement raises the head.
    // Torque-on can outlast the request and drop the socket while it succeeds,
    // so a timeout is not a failure and never a reason to send it twice: the
    // robot's own mode decides, and only the read is repeated.
    const failure = await this.request(url, "/api/motors/set_mode/enabled", { method: "POST" }, LIFECYCLE_TIMEOUT).then(() => null, error => error);
    const motors = await this.request(url, "/api/motors/status", {}, LIFECYCLE_TIMEOUT);
    if (motors.mode !== "enabled") throw new Error(failure ? `${failure.message}; motors still disabled` : "Reachy Mini motors did not enable");
    // A drop during torque-on leaves the wake to the reconnect, not to a resend.
    if (this.status.connected && this.status.url === url) this.publish({ motionEnabled: true, state: "connected" });
  }
  async stopSound() {
    this.audioGeneration++;
    this.playingId++;
    if (!this.status.connected || !this.playingAudio) return;
    this.playingAudio = false;
    try { await this.request(this.status.url, "/api/media/stop_sound", { method: "POST" }); } catch {}
  }
  async playSound(bytes, key) {
    // Pick the sink once. Never replay locally after an ambiguous remote ACK.
    if (!this.status.connected) return { sink: "desktop" };
    const url = this.status.url;
    const generation = this.audioGeneration;
    const current = () => this.status.connected && this.status.url === url && this.audioGeneration === generation;
    try {
      if (!this.uploaded.has(key)) {
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: "audio/wav" }), `${key}.wav`);
        await this.request(url, "/api/media/sounds/upload", { method: "POST", body: form }, 15000);
        if (!current()) return { sink: "robot", cancelled: true };
        this.uploaded.add(key);
      }
      if (!current()) return { sink: "robot", cancelled: true };
      this.playingAudio = true;
      const playingId = ++this.playingId;
      await this.request(url, "/api/media/play_sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: `${key}.wav` }) });
      if (!current()) {
        // A mute/switch may race the remote play request; stop again after
        // its acknowledgement so a late-starting clip cannot escape the mute.
        try { await this.request(url, "/api/media/stop_sound", { method: "POST" }); } catch {}
        return { sink: "robot", cancelled: true };
      }
      const timer = setTimeout(() => { if (current() && playingId === this.playingId) this.playingAudio = false; }, Math.ceil(bytes.length > 44 && bytes.readUInt32LE(28) > 0 ? (bytes.length - 44) / bytes.readUInt32LE(28) * 1000 + 250 : 1000));
      timer.unref?.();
      if (this.status.audioError) this.publish({ audioError: null });
      return { sink: "robot" };
    } catch {
      this.publish({ audioError: "Robot audio unavailable" });
      return { sink: "robot", error: true };
    }
  }
}

module.exports = { ReachyMiniClient, daemonUrl, normalizeAntennas, needsWake, robotVolumePercent };
