// Fake Reachy Mini daemon (SDK 1.10.0 surface used by duck-on-desk). Starts AWAKE
// (motors enabled, idle pose) as if the official app woke it. Logs every call.
const http = require("node:http"); const fs = require("node:fs");
const { WebSocketServer } = require(process.env.DUCK_DIR ? process.env.DUCK_DIR + "/node_modules/ws" : "ws");
const PORT = Number(process.env.FAKE_PORT || 8765), LOG = process.env.FAKE_LOG || "fake-daemon.log";
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(" ")}`; console.log(line); fs.appendFileSync(LOG, line + "\n"); };
const IDLE = { z: 0, antennas: [-0.1745, 0.1745] }, SLEEP = { z: -0.046, antennas: [-3.0, 3.0] };
let motors = "enabled", pose = { ...IDLE }, volume = 100, moves = [], seq = 0;
const EMOTIONS = ["wake-mini-up","curious1","attentive2","inquiring3","impatient1","surprised1","enthusiastic1","oops2","frustrated1","sad1","mini-deep-sleep","understanding2"];
const DANCES = ["side_glance_flick","simple_nod","uh_huh_tilt","yeah_nod","head_tilt_roll"];
function startMove(name, ms, done) { const uuid = `mv-${++seq}-${name}`; moves.push({ uuid, name }); setTimeout(() => { moves = moves.filter(m => m.uuid !== uuid); done && done(); log("move-done", name); }, ms); return uuid; }
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
  const u = req.url, m = req.method; res.setHeader("Content-Type", "application/json");
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  if (u === "/api/daemon/status") return send(200, { state: "running", robot_name: "reachy_mini", wireless_version: true, simulation_enabled: false, mockup_sim_enabled: false, version: "1.10.0", backend_status: { motor_control_mode: motors } });
  log(m, u, body.length ? `(${body.length} B${u.includes("play_sound") ? " " + body.toString() : ""})` : "");
  if (u === "/api/motors/status") return send(200, { mode: motors });
  if (m === "POST" && u.startsWith("/api/motors/set_mode/")) { motors = u.split("/").pop(); return send(200, { status: "ok" }); }
  if (u === "/api/move/running") return send(200, moves.map(x => ({ uuid: x.uuid })));
  if (m === "POST" && u === "/api/move/play/wake_up") { if (motors !== "enabled") return send(400, { detail: "motors disabled" }); log("SOUND(daemon) wake_up.wav"); return send(200, { uuid: startMove("wake_up", 1500, () => { pose = { ...IDLE }; }) }); }
  if (m === "POST" && u === "/api/move/play/goto_sleep") { log("SOUND(daemon) go_sleep.wav"); return send(200, { uuid: startMove("goto_sleep", 1500, () => { pose = { ...SLEEP }; motors = "disabled"; }) }); }
  if (m === "POST" && u.startsWith("/api/move/play/recorded-move-dataset/")) { const name = decodeURIComponent(u.split("/").pop()); log("SOUND(daemon) " + name + ".wav (recorded move)"); return send(200, { uuid: startMove(name, 1200) }); }
  if (u.startsWith("/api/move/recorded-move-datasets/list/")) return send(200, u.includes("emotions") ? EMOTIONS : DANCES);
  if (u === "/api/volume/current") return send(200, { volume, platform: "linux", device: "Reachy Mini Audio" });
  if (m === "POST" && u === "/api/media/sounds/upload") return send(200, { status: "ok" });
  if (m === "POST" && u === "/api/media/play_sound") return send(200, { status: "ok" });
  if (m === "POST" && u === "/api/media/stop_sound") return send(200, { status: "ok" });
  send(404, { detail: "not found " + u });
});
const wss = new WebSocketServer({ server, path: "/ws/sdk" });
wss.on("connection", socket => {
  log("WS connected");
  socket.on("message", bytes => { const msg = JSON.parse(String(bytes)); if (msg.type === "set_volume") { volume = msg.volume; log("WS set_volume", volume); } else log("WS msg", msg.type); });
  socket.on("close", () => log("WS closed"));
  let n = 0;
  const t = setInterval(() => { if (socket.readyState !== 1) return clearInterval(t);
    // The real daemon pushes its status alongside the feedback (about 1 Hz here).
    if (++n % 25 === 0) socket.send(JSON.stringify({ type: "daemon_status", state: "running", backend_status: { motor_control_mode: motors } }));
    const z = pose.z, id = [[1,0,0,0],[0,1,0,0],[0,0,1,z],[0,0,0,1]];
    socket.send(JSON.stringify({ type: "head_pose", head_pose: id }));
    socket.send(JSON.stringify({ type: "joint_positions", head_joint_positions: [0,0,0,0,0,0,0], antennas_joint_positions: pose.antennas }));
  }, 40);
});
server.listen(PORT, "127.0.0.1", () => log(`fake daemon listening on 127.0.0.1:${PORT} motors=${motors}`));
