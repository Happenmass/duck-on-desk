"use strict";
// Normalizes a community Microduck policy repository into a market entry.
//
// The format is the de-facto one used across the Hub's `microduck-policy` tag
// (34 repositories surveyed 2026-09-16, all of them carrying a manifest.json).
// `model_api` is its only stable compatibility field: `schema_version` ranges
// from 1 to 5 across authors and tracks each author's own revisions, so it
// carries no cross-repository meaning. A manifest with no `model_api`, or with
// one we do not know (2 already exists in the wild), is not rejected -- it is
// marked unverifiable, which costs the user a local evaluation rather than the
// listing.

const MODEL_API = 1;
const OBS_LEN = 61;
const ACTION_LEN = 14;
const CONTROL_HZ = 50;
const ROBOT_MODEL = "microduck";
const MAX_DURATION_S = 60;

// Tasks whose first three command slots are the velocity triple [vx, vy, wz],
// i.e. the semantics this app's walking command already speaks. Every entry was
// verified by reading that task's own command description at the time it was
// added; nothing here is inferred from the task name, because the name pattern
// does not carry the semantics -- `Mjlab-FlamingoCycleHard-Flat-MicroDuck` and
// `Mjlab-OneLegStandNoBall-Flat-MicroDuck` match the same shape and both use
// slot 0 as a mode flag instead.
const VELOCITY_TASKS = new Set([
  // This app's own walking course (mcp/robot-lab/training/train_mjlab.py).
  "Mjlab-Velocity-Flat-MicroDuck",
  // RemiFabre/microduck-rough-walk-e: "vx: forward velocity command, m/s" /
  // "vy: lateral velocity command" / "wz: yaw rate command".
  "Mjlab-Hostile-FinetuneFeetProgress-MicroDuck",
  // HannesVonEssen/microduck-running: "forward velocity command in m/s"; the
  // lateral and yaw slots are velocities too, trained near zero.
  "Mjlab-Running-Flat-MicroDuck",
]);

// Morphology markers. The market targets the stock 0 cm-leg duck; a stilt or
// roller policy balances a different body and cannot be judged by a stock-body
// evaluation, so it is listed but never offered for one-click use.
const FOREIGN_MORPHOLOGY = /stilt|roller|skate|wheel/i;

const MEDIA_EXTENSIONS = /\.(mp4|webm|gif|png|jpg|jpeg|webp)$/i;

const STATUS = {
  ready: "ready",               // contract verified, command semantics known
  manual: "manual",             // usable contract, command semantics we cannot drive
  unverifiable: "unverifiable", // contract not declared in a form we know
  incompatible: "incompatible", // cannot run against this robot at all
};

// `robot.model` is a descriptive string, not an enum: the surveyed repositories
// use "microduck", "microduck full_shell" and "microduck passive rollers". The
// leading token identifies the robot; anything after it qualifies the body, and
// a qualified body is never offered for one-click use because its collision
// model and mass differ from the stock duck this app simulates.
function bodyOf(model) {
  if (typeof model !== "string") return { robot: null, qualifier: null };
  const parts = model.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return { robot: parts[0] || null, qualifier: parts.slice(1).join(" ") || null };
}

function isZeroIdle(idle) {
  return Array.isArray(idle) && idle.length > 0 && idle.every((value) => value === 0);
}

function taskId(manifest) {
  const training = manifest && typeof manifest.training === "object" ? manifest.training : null;
  if (!training) return null;
  const raw = training.task_id === undefined ? training.task : training.task_id;
  if (typeof raw !== "string") return null;
  // Authors append lineage prose to this field ("X (continuation of Y)"), so
  // compare on the leading identifier only.
  return raw.trim().split(/\s+/)[0] || null;
}

function finiteDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_DURATION_S
    ? value : null;
}

// Decides what the app may do with a policy. Order matters: hard incompatibility
// first, then the unverifiable contract, then the command semantics.
function classify(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { status: STATUS.unverifiable, reason: "no-manifest", kind: null, commandMode: null, duration: null };
  }
  const robot = manifest.robot && typeof manifest.robot === "object" ? manifest.robot : {};
  const body = bodyOf(robot.model);
  if (body.robot && body.robot !== ROBOT_MODEL) {
    return { status: STATUS.incompatible, reason: "other-robot", kind: null, commandMode: null, duration: null };
  }
  if (typeof robot.control_hz === "number" && robot.control_hz !== CONTROL_HZ) {
    return { status: STATUS.incompatible, reason: "control-rate", kind: null, commandMode: null, duration: null };
  }
  // A declared tensor shape that disagrees is a hard stop; an absent one is not,
  // because it only means this author's schema does not record it.
  if (typeof manifest.obs_len === "number" && manifest.obs_len !== OBS_LEN) {
    return { status: STATUS.incompatible, reason: "observation-size", kind: null, commandMode: null, duration: null };
  }
  if (typeof manifest.action_len === "number" && manifest.action_len !== ACTION_LEN) {
    return { status: STATUS.incompatible, reason: "action-size", kind: null, commandMode: null, duration: null };
  }

  const kind = manifest.kind === "episodic" || manifest.kind === "perpetual" ? manifest.kind : null;
  const duration = finiteDuration(manifest.duration_s);
  if (manifest.model_api !== MODEL_API) {
    return {
      status: STATUS.unverifiable,
      reason: manifest.model_api === undefined ? "model-api-missing" : "model-api-unsupported",
      kind, commandMode: null, duration,
    };
  }

  const task = taskId(manifest);
  const foreignBody = body.qualifier && FOREIGN_MORPHOLOGY.test(body.qualifier);
  if (foreignBody || (task && FOREIGN_MORPHOLOGY.test(task)) || FOREIGN_MORPHOLOGY.test(String(manifest.name || ""))) {
    return { status: STATUS.manual, reason: "foreign-morphology", kind, commandMode: null, duration };
  }
  if (body.qualifier) {
    return { status: STATUS.manual, reason: "body-variant", kind, commandMode: null, duration };
  }

  const idle = manifest.command && typeof manifest.command === "object" ? manifest.command.idle : undefined;
  // An episodic policy is triggered by switching to it, not through the command
  // block (happy-hop states this outright: "the trigger is not encoded in the
  // observation"), so a declared all-zero idle means zeros are correct for the
  // whole clip -- the path this app already runs for its own action policies.
  if (kind === "episodic" && duration && isZeroIdle(idle)) {
    return { status: STATUS.ready, reason: null, kind, commandMode: "zero-commands", duration };
  }
  if (kind === "perpetual" && task && VELOCITY_TASKS.has(task)) {
    return { status: STATUS.ready, reason: null, kind, commandMode: "velocity", duration: null };
  }
  return {
    status: STATUS.manual,
    reason: kind === "episodic" ? "episodic-command-unknown" : "command-semantics-unknown",
    kind, commandMode: null, duration,
  };
}

function licenseFrom(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const tag = list.find((value) => typeof value === "string" && value.startsWith("license:"));
  return tag ? tag.slice("license:".length) : null;
}

function pickMedia(files, manifest) {
  const declared = [manifest && manifest.video, manifest && manifest.media]
    .filter((value) => typeof value === "string");
  for (const candidate of declared) if (files.includes(candidate)) return candidate;
  return files.find((file) => file.startsWith("media/") && MEDIA_EXTENSIONS.test(file))
    || files.find((file) => MEDIA_EXTENSIONS.test(file) && /preview|demo|video/i.test(file))
    || null;
}

function pickPoster(files, manifest) {
  const declared = manifest && manifest.poster;
  if (typeof declared === "string" && files.includes(declared)) return declared;
  return files.find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file) && /poster|thumb/i.test(file)) || null;
}

// `model` is one Hub listing entry (from ?full=true, which carries `sha` and
// `siblings`); `manifest` is that repository's manifest.json at that sha, or
// null when it has none or it could not be read.
function normalizeEntry(model, manifest) {
  const repo = model && typeof model.id === "string" ? model.id : null;
  if (!repo || !repo.includes("/")) return null;
  const owner = repo.slice(0, repo.indexOf("/"));
  const slug = repo.slice(repo.indexOf("/") + 1);
  const sha = typeof model.sha === "string" && /^[a-f0-9]{40}$/.test(model.sha) ? model.sha : null;
  const files = (Array.isArray(model.siblings) ? model.siblings : [])
    .map((sibling) => sibling && sibling.rfilename)
    .filter((name) => typeof name === "string");

  const verdict = files.includes("policy.onnx") && sha
    ? classify(manifest)
    : {
        status: STATUS.incompatible,
        reason: sha ? "no-policy-file" : "no-revision",
        kind: null, commandMode: null, duration: null,
      };

  const name = manifest && typeof manifest.name === "string" ? manifest.name.trim() : "";
  return {
    repo, owner, slug, sha,
    title: name || slug,
    description: manifest && typeof manifest.description === "string" ? manifest.description : null,
    status: verdict.status,
    reason: verdict.reason,
    kind: verdict.kind,
    commandMode: verdict.commandMode,
    duration: verdict.duration,
    entryPose: manifest && typeof manifest.entry_pose === "string" ? manifest.entry_pose : null,
    actionScale: manifest && typeof manifest.action_scale === "number" ? manifest.action_scale : null,
    task: taskId(manifest),
    trainingRepo: manifest && manifest.training && typeof manifest.training.repo === "string"
      ? manifest.training.repo : null,
    knownLimits: manifest && manifest.eval && typeof manifest.eval.known_limits === "string"
      ? manifest.eval.known_limits : null,
    hasManifest: Boolean(manifest),
    policyPath: files.includes("policy.onnx") ? "policy.onnx" : null,
    mediaPath: pickMedia(files, manifest),
    posterPath: pickPoster(files, manifest),
    license: licenseFrom(model.tags),
    likes: Number.isFinite(model.likes) ? model.likes : 0,
    downloads: Number.isFinite(model.downloads) ? model.downloads : 0,
    updatedAt: typeof model.lastModified === "string" ? model.lastModified : null,
  };
}

module.exports = {
  MODEL_API, OBS_LEN, ACTION_LEN, CONTROL_HZ, ROBOT_MODEL, MAX_DURATION_S,
  VELOCITY_TASKS, STATUS, isZeroIdle, taskId, classify, normalizeEntry,
};
