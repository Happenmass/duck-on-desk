// Stilts: the Microduck on the community "microduck-stilts" cartridges
// (HannesVonEssen on the Hub, trained in Vottivott/microduck-playground). The
// morphology is rebuilt here exactly as the training environment builds it:
// one convex loft per foot, mounted at the foot site, top at z=0 and the tip
// at z=-height, blend 0.5 between the 22x32 mm platform and the 12 mm peg.
export const STILT_HEIGHTS_CM = [10, 15, 20, 25, 50, 100, 140, 200];
export const STILT_BLEND = 0.5;
export const STILT_MAX_TURN = 0.35; // rad/s, the yaw range the stilt policies were trained on
export const STILT_MAX_FORWARD = 0.6; // of MAX_FORWARD: 0.15 m/s, the released policies' evaluation speed
// The stilt policies were trained against BAM's identified XL330 servo model
// (firmware position loop at kp_fw=200, voltage-limited), not the MJCF
// position actuators the official policies use. Doubling the position gain
// and force limit is the closest the plain actuators get: at x1 the duck tips
// over within ~3 s, at x2.5 and above it oscillates and falls at once.
export const STILT_SERVO_GAIN = 2;

export function normalizeStilts(value) {
  const cm = Number(value);
  return STILT_HEIGHTS_CM.includes(cm) ? cm : 0;
}

export function stiltPolicyFile(heightCm) {
  return `stilts/${heightCm}cm/policy.onnx`;
}

// 12 g + 1 g per cm, the simulation mass law of the released policies.
export function stiltMassKg(heightCm) {
  return 0.012 + 0.001 * heightCm;
}

function profile(blend) {
  const lerp = (a, b) => a + blend * (b - a);
  return {
    tipWidth: lerp(22, 12), tipLength: lerp(32, 12), tipRadius: lerp(3.5, 6),
    rootWidth: lerp(23, 22), rootLength: lerp(41, 22), rootRadius: lerp(4.5, 11),
  };
}

// Counter-clockwise rounded-rectangle boundary (metres), 8 samples per corner.
function ring(widthMm, lengthMm, radiusMm, samples = 8) {
  const w = widthMm / 1000, l = lengthMm / 1000;
  const r = Math.min(radiusMm / 1000, w / 2, l / 2);
  const corners = [
    [w / 2 - r, l / 2 - r, 0], [-w / 2 + r, l / 2 - r, Math.PI / 2],
    [-w / 2 + r, -l / 2 + r, Math.PI], [w / 2 - r, -l / 2 + r, 1.5 * Math.PI],
  ];
  const out = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i < samples; i++) {
      const a = start + (Math.PI / 2) * i / samples;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

// Watertight convex loft in the foot-site frame: { vertices: Float32Array (xyz, metres), faces: Uint32Array }.
export function stiltMeshData(heightCm, blend = STILT_BLEND) {
  const p = profile(blend);
  const bottom = ring(p.tipWidth, p.tipLength, p.tipRadius);
  const top = ring(p.rootWidth, p.rootLength, p.rootRadius);
  const n = bottom.length;
  const h = heightCm / 100;
  const verts = [];
  for (const [x, y] of bottom) verts.push(x, y, -h);
  for (const [x, y] of top) verts.push(x, y, 0);
  const bottomCenter = verts.length / 3; verts.push(0, 0, -h);
  const topCenter = verts.length / 3; verts.push(0, 0, 0);
  const faces = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(i, j, n + j, i, n + j, n + i, bottomCenter, j, i, topCenter, n + i, n + j);
  }
  return { vertices: Float32Array.from(verts), faces: Uint32Array.from(faces) };
}

// Camera framing for a duck standing heightCm higher: back the rig off and
// look at the middle of the taller silhouette (rest height + ~half the stilt).
export function stiltFraming(heightCm, restHeight = 0.12) {
  const h = heightCm / 100;
  return { dolly: 1 + 2.4 * h, lookY: restHeight + 0.55 * h };
}
