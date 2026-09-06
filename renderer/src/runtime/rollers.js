// Rollers: the official roller-skate variant (robot_allcollisions_rollers.xml,
// four passive wheels under the blades) driven by the shipped BEST_roller
// policy — cmd_x means 0 = coast, > 0 = push, < 0 = brake, trained for
// -0.5..0.6 m/s with no turning demand — plus BEST_roller_crouch, the
// one-shot crouch-glide that reuses the ground-pick phase encoding.
export const LOCOMOTIONS = ["legs", "rollers"];
export function normalizeLocomotion(value) {
  return LOCOMOTIONS.includes(value) ? value : "legs";
}
export const ROLLER_POLICY_FILES = { walk: "BEST_roller.onnx", crouch: "BEST_roller_crouch.onnx" };
export const ROLLER_WHEEL_JOINTS = ["passive_LF_wheel", "passive_LR_wheel", "passive_RF_wheel", "passive_RR_wheel"];
export const ROLLER_CROUCH = { periodS: 5.0, endPhase: 0.7 }; // 3.5 s crouch over a 5 s phase period
export const ROLLER_REST_HEIGHT = 0.12; // trunk height standing on the wheels (measured; see tests/notes)
// cmd_x scale on rollers: BEST_roller was trained for -0.5..0.6 m/s and barely
// pushes below ~0.3 m/s (measured: 25 px in 5 s at 0.15 m/s, ~170 px at 0.36),
// so a full "forward" maps to 0.33 m/s instead of the walker's 0.25; the env
// notes the policy only reaches ~0.33 m/s at full push, and harder pushes
// only topple it.
export const ROLLER_MAX_FORWARD = 0.33;
export const ROLLER_BRAKE = -0.3; // cmd_x applied while nothing drives and the duck is still rolling
export const ROLLER_BRAKE_ABOVE = 0.03; // m/s

// BEST_roller never saw a turn command (cmd[2] was always 0 in training; a
// heading_hold reward kept the yaw where it spawned), so the facing cone and
// the roam heading are kept by yawing the trunk kinematically, this fast.
export const ROLLER_YAW_RATE = 0.8; // rad/s (≈0.7 effective while rolling; 1.2 made the duck stumble)
// On skates the duck may show more of its side than on foot (user-set).
export const ROLLER_HALF_CONE = Math.PI * 4 / 9; // 160° cone facing the camera

// Rotate a MuJoCo free-joint quaternion [w x y z] at qpos[3..6] about world Z.
export function yawTrunk(qpos, delta) {
  const c = Math.cos(delta / 2);
  const s = Math.sin(delta / 2);
  const [w, x, y, z] = [qpos[3], qpos[4], qpos[5], qpos[6]];
  qpos[3] = c * w - s * z;
  qpos[4] = c * x - s * y;
  qpos[5] = c * y + s * x;
  qpos[6] = c * z + s * w;
}

// Bearing drag on the passive wheels. The model ships with frictionloss 0 and
// the training curriculum ramps it to this value; without it the duck coasts
// at the full push speed for good (≈360 px/s on screen), far too fast for a
// desktop stroll.
export const ROLLER_WHEEL_FRICTIONLOSS = 0.003; // N·m — higher = slower glide but more of the policy's stumbles
