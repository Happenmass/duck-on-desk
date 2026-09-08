export const POLICY_FILES = {
  walk: "BEST_alpha_walking.onnx",
  sitstand: "BEST_alpha_sitstand.onnx",
  stand: "BEST_alpha_stand.onnx",
  groundpick: "alpha_ground_pick.onnx",
};

export const JOINT_NAMES = [
  "left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
  "neck_pitch", "head_pitch", "head_yaw", "head_roll",
  "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle",
];

export const DEFAULT_POSE = new Float32Array([
  0, -0.08726646259971647, -0.457924, -0.004940, 0.452984,
  0.3490658503988659, 0.3490658503988659, 0, 0,
  0, 0.08726646259971647, 0.457924, 0.004940, -0.452984,
]);

export const NUM_JOINTS = 14;
export const OBS_SIZE = 61;
export const CMD_SIZE = 13;
export const TIMESTEP = 0.005;
export const DECIMATION = 4;
export const CTRL_DT = TIMESTEP * DECIMATION;
export const MAX_FORWARD = 0.25;
export const MAX_BACK = -0.2;
export const MAX_TURN = 1.0;

// Desktop-pet frame budget, shared by both robot runtimes. rAF fires at the
// display's refresh rate, which on a ProMotion panel is 120 Hz; a ~360 px pet
// reads the same at 30 and every frame costs a full compositor pass on a
// transparent always-on-top window (measured 2026-09-08: the GPU process alone
// sat at ~25% of a core). The 0.9 slack lets a 60 Hz display land on 33.3 ms
// instead of skipping a beat to 50.
export const FRAME_MS = 1000 / 30;
export const FRAME_SLACK = 0.9;
