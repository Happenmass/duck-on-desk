// Colour variants of the real Microduck robots (see the reference photo of
// the four printed units). Each variant fills the same semantic slots; the
// mesh-filename -> slot mapping lives in meshMaterialsFor(). All colours are
// linear-space RGB and slightly oversaturated: the renderer tone-maps with
// ACESFilmicToneMapping under warm key/rim lights, which desaturates and
// shifts hues toward gold, so the base colours lean past the target to land
// right on screen.

import * as THREE from "three";

// ── Shared slot specs (identical on all four robots) ───────────────────
// sRGB targets from the reference photo, converted to linear with a
// slight saturation boost (x1.12) so ACES lands on the clean tint.
const AMBER_YELLOW = { color: [1.0, 0.413, 0.007], roughness: 0.4, metalness: 0.0 };   // #ffb52e
const BRIGHT_ORANGE = { color: [1.0, 0.144, 0.008], roughness: 0.45, metalness: 0.0 }; // #ff7a2f
const AMBER = { color: [0.847, 0.339, 0.022], roughness: 0.45, metalness: 0.0 };       // #eda63e
const CLEAN_YELLOW = { color: [1.0, 0.608, 0.021], roughness: 0.4, metalness: 0.0 };   // #ffd23f
const CREAM = { color: [0.888, 0.86, 0.798], roughness: 0.35, metalness: 0.0 };        // #f2efe8
const DARK = { color: [0.012, 0.012, 0.014], roughness: 0.55, metalness: 0.3 };        // #1d1d1f
const GRAY = { color: [0.256, 0.256, 0.279], roughness: 0.5, metalness: 0.35 };        // #8b8b90
// Camera-lens eye: very dark blue-black, glossy like coated glass.
const LENS = { color: [0.01, 0.012, 0.02], roughness: 0.05, metalness: 0.0 };

// Per-variant colours.
const WARM_GRAY = { color: [0.328, 0.312, 0.283], roughness: 0.35, metalness: 0.0 };      // #9b9892
const AMBER_ORANGE = { color: [0.815, 0.321, 0.019], roughness: 0.5, metalness: 0.0 };    // #e9a23b
const CHARCOAL = { color: [0.028, 0.028, 0.033], roughness: 0.5, metalness: 0.0 };        // #2f2f33
const CHARCOAL_FACE = { color: [0.044, 0.044, 0.051], roughness: 0.5, metalness: 0.0 };   // #3c3c40
const CHARCOAL_BODY = { color: [0.017, 0.017, 0.019], roughness: 0.5, metalness: 0.0 };   // #232326
const LIGHT_WARM_GRAY = { color: [0.485, 0.459, 0.416], roughness: 0.35, metalness: 0.0 };// #b9b5ae
const PURPLE_RING = { color: [0.443, 0.308, 0.663], roughness: 0.4, metalness: 0.0 };     // #b098d0
// Sole pads read a notch deeper than the eye ring on the real robots.
const PURPLE_SOLE = { color: [0.221, 0.134, 0.465], roughness: 0.45, metalness: 0.0 };    // #8068b0
// Lavender trunk / leg shells: a notch lighter than the eye ring.
const LAVENDER_SHELL = { color: [0.462, 0.367, 0.688], roughness: 0.35, metalness: 0.0 };  // #b4a4d4
const SOFT_PURPLE = { color: [0.36, 0.23, 0.48], roughness: 0.45, metalness: 0.0 };       // #a489b5
const PURPLE_FEET = { color: [0.164, 0.085, 0.584], roughness: 0.45, metalness: 0.0 };    // #7a5fc9
const PALE_BLUE = { color: [0.441, 0.613, 0.723], roughness: 0.35, metalness: 0.0 };      // #b6cfdd
const MEDIUM_BLUE = { color: [0.13, 0.321, 0.552], roughness: 0.35, metalness: 0.0 };     // #6f9ec4
const BLUE_GRAY = { color: [0.183, 0.379, 0.565], roughness: 0.35, metalness: 0.0 };      // #7fa9c6
const FEET_YELLOW = { color: [0.784, 0.455, 0.023], roughness: 0.5, metalness: 0.0 };     // #e5b93e

// Slots (validated against the four-robot reference photo): headDome
// (top shell), facePlate (around the eye), trim (band under the shell +
// upper beak base), beakUpper (mouth-roof plate), beakLower (rigid jaw),
// tongue (soft pad inside the beak), eyeRing, lens, bodyShell (trunk
// base), sideShells (left + right trunk shells), legShells (upper-leg
// shells), feet (shoe upper: foot blocks + ankle brackets), soles (shoe
// lower: sole pads), hips (hip covers), mechDark, mechGray.
// The mouth interior (upper gum = beakUpper, tongue) is amber on the
// classic/blue pair and soft purple on the charcoal/purple pair (checked
// against the real robots). Only the rigid jaw (beakLower) carries the
// beak colour. Classic and blue wear orange shoes on clean yellow soles.
export const VARIANTS = {
  // Front-center robot: warm gray head, cream body, amber eye, orange
  // trim and beak, amber mouth interior, orange shoes on yellow soles.
  classic: {
    headDome: CREAM,
    facePlate: WARM_GRAY,
    trim: BRIGHT_ORANGE,
    beakUpper: AMBER_YELLOW,
    beakLower: BRIGHT_ORANGE,
    tongue: AMBER_YELLOW,
    eyeRing: AMBER_YELLOW,
    lens: LENS,
    bodyShell: CREAM,
    sideShells: CREAM,
    legShells: CREAM,
    feet: BRIGHT_ORANGE,
    soles: CLEAN_YELLOW,
    hips: GRAY,
    mechDark: DARK,
    mechGray: GRAY,
  },
  // Front-left robot: shares the purple colourway everywhere except its
  // shells - warm gray face plate, yellow trim / rigid jaw / shoes, soft
  // purple mouth interior, purple eye ring on purple soles. The head dome
  // and the trunk / leg shells stay charcoal, which is what tells this
  // variant apart from purple (and what the picker chip shows).
  charcoal: {
    headDome: CHARCOAL,
    facePlate: WARM_GRAY,
    trim: CLEAN_YELLOW,
    beakUpper: SOFT_PURPLE,
    beakLower: CLEAN_YELLOW,
    tongue: SOFT_PURPLE,
    eyeRing: PURPLE_RING,
    lens: LENS,
    bodyShell: CHARCOAL_BODY,
    sideShells: CHARCOAL_BODY,
    legShells: CHARCOAL_BODY,
    feet: CLEAN_YELLOW,
    soles: PURPLE_SOLE,
    hips: GRAY,
    mechDark: DARK,
    mechGray: GRAY,
  },
  // Back-center robot: lavender head dome over a warm gray face plate,
  // pale blue eye (the same blue the sky variant wears), YELLOW trim and
  // rigid jaw, soft purple mouth interior, lavender trunk / leg shells
  // on purple soles.
  purple: {
    headDome: LAVENDER_SHELL,
    facePlate: WARM_GRAY,
    trim: CLEAN_YELLOW,
    beakUpper: SOFT_PURPLE,
    beakLower: CLEAN_YELLOW,
    tongue: SOFT_PURPLE,
    eyeRing: PALE_BLUE,
    lens: LENS,
    bodyShell: LAVENDER_SHELL,
    sideShells: LAVENDER_SHELL,
    legShells: LAVENDER_SHELL,
    feet: CLEAN_YELLOW,
    soles: PURPLE_SOLE,
    hips: GRAY,
    mechDark: DARK,
    mechGray: GRAY,
    // UI swatch override: kept from when the head and body were gray/cream
    // and only the accents carried the purple identity. The shells are
    // lavender now, so this no longer diverges much - and nothing reads it
    // anyway (the HUD picker uses VARIANT_SWATCH_HEX below).
    swatch: PURPLE_FEET,
  },
  // Right robot: shares the classic colourway everywhere except its
  // shells - warm gray face plate, amber eye, orange beak, amber mouth
  // interior, orange shoes on yellow soles, gray hips. The head dome and
  // the trunk / leg shells stay pale blue, which is what tells this
  // variant apart from classic (and what the picker chip shows).
  blue: {
    headDome: PALE_BLUE,
    facePlate: WARM_GRAY,
    trim: BRIGHT_ORANGE,
    beakUpper: AMBER_YELLOW,
    beakLower: BRIGHT_ORANGE,
    tongue: AMBER_YELLOW,
    eyeRing: AMBER_YELLOW,
    lens: LENS,
    bodyShell: PALE_BLUE,
    sideShells: PALE_BLUE,
    legShells: PALE_BLUE,
    feet: BRIGHT_ORANGE,
    soles: CLEAN_YELLOW,
    hips: GRAY,
    mechDark: DARK,
    mechGray: GRAY,
  },
};

export const VARIANT_NAMES = Object.keys(VARIANTS);
export const DEFAULT_VARIANT = "classic";

// Official colourway display names, for tooltips/labels only - the
// internal variant keys above stay unchanged.
export const VARIANT_LABELS = {
  classic: "Cream",
  charcoal: "Graphite",
  purple: "Lavender",
  blue: "Sky",
};

// UI swatch hexes for the HUD colour picker: the press-kit sRGB shell
// targets, pinned as literals. The sim's material specs above predate the
// press-kit recalibration, so the picker does NOT derive from them - this
// table is shared verbatim with the pollen-website landing picker so both
// show byte-identical chips.
export const VARIANT_SWATCH_HEX = {
  classic: "#f7e6cb",
  charcoal: "#6c6a68",
  purple: "#bfa9cf",
  blue: "#a9dbe8",
};

export const randomVariantName = () =>
  VARIANT_NAMES[Math.floor(Math.random() * VARIANT_NAMES.length)];

// Mesh filename -> material spec for one variant (mjlab model meshes).
// Anything not listed is small mechanical hardware and falls back to
// mechGray. Verified visually against the four-robot reference photo.
export function meshMaterialsFor(v) {
  return {
    // Head: dome, band under it, face plate around the eye.
    "top_head_shell.stl": v.headDome,
    "bottom_head_shell.stl": v.trim,
    "face_part.stl": v.facePlate,
    // The eye: printed ring + camera lens behind it.
    "noenoeil.stl": v.eyeRing,
    "lens.stl": v.lens,
    "m12_lens_holder.stl": v.mechDark,
    // Beak: mouth-roof plate on top, rigid jaw below, soft pad (the
    // tongue) riding on the jaw.
    "soft_mouth_top.stl": v.beakUpper,
    "jaw.stl": v.beakLower,
    "jaw_soft.stl": v.tongue,
    // Body: trunk base + the two side shells (shared slot).
    "trunk_base.stl": v.bodyShell,
    "left_shell.stl": v.sideShells,
    "right_shell.stl": v.sideShells,
    "upper_leg_left.stl": v.legShells,
    "upper_leg_right.stl": v.legShells,
    "hip_l.stl": v.hips,
    // Feet: foot block + ankle bracket, soft sole pad below.
    "foot_left.stl": v.feet,
    "foot_right.stl": v.feet,
    "ankle_left.stl": v.feet,
    "ankle_right.stl": v.feet,
    "sole_left.stl": v.soles,
    "sole_right.stl": v.soles,
    // Roller variant: the blade + ankle bracket take the shoe-upper slot,
    // the rims take the sole accent, the tires are rubber-dark.
    "ankle_l_v1.stl": v.feet,
    "ankle_r_v1.stl": v.feet,
    "roller_blade.stl": v.feet,
    "rim.stl": v.soles,
    "tire.stl": v.mechDark,
    // Dark mechanics. leg.stl is the printed shin that wraps the ankle
    // motor and its bearing ring: gray on the real robots, standing
    // apart from the black motor it holds.
    "xl330.stl": v.mechDark,
    "leg.stl": v.mechGray,
    "seeed_bearing__configuration_default.stl": v.mechDark,
    // Hip yaw mechanism (ribbed ring + 4-screw plate): reads as the hip
    // motor, so it goes dark too. The printed hip cover (hip_l.stl)
    // keeps the dedicated `hips` slot. The neck bracket is gray on the
    // real robots, standing apart from the motors it carries.
    "yaw2roll.stl": v.mechDark,
    "bearing_roll.stl": v.mechDark,
    "neck.stl": v.mechGray,
    "np_f970.stl": v.mechDark,
    "pcb__raspberry_pi_zero_2_w.stl": v.mechDark,
    "elec_rpi_robot_hat_pcb.stl": v.mechDark,
    "banana_pcb_locker.stl": v.mechDark,
    "speaker.stl": v.mechDark,
    // Gray mechanics
    "upper_leg_rigidity_plate.stl": v.mechGray,
    "yaw_roll_motion.stl": v.mechGray,
    "neck_pitch.stl": v.mechGray,
    "motor_support.stl": v.mechGray,
    "power_support.stl": v.mechGray,
    "seeed_bearing__configuration__22x16x4.stl": v.mechGray,
  };
}

// buildRig materialForMesh hook for one variant.
export const materialHookFor = (v) => {
  const map = meshMaterialsFor(v);
  return (mesh) => map[mesh] ?? v.mechGray;
};

// ── Live re-skin ────────────────────────────────────────────────────────
// Swap materials on an already-built rig without reloading any STL.
// Meshes are identified via userData.meshName (set by duck.js buildRig and
// preserved by cloneRig). Materials are cached per resolved spec so clones
// and repeated switches share GPU material instances.
const matCache = new Map();
function matFor(spec) {
  const key = `${spec.color.join(",")}|${spec.roughness ?? 0.5}|${spec.metalness ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...spec.color),
      roughness: spec.roughness ?? 0.5,
      metalness: spec.metalness ?? 0.0,
    });
    matCache.set(key, m);
  }
  return m;
}

// ── Smooth colourway fades ──────────────────────────────────────────────
// applyVariant on a rig that is live in a scene tweens every mesh's
// colour/roughness/metalness toward the new spec (same feel as the
// showcase site: ~0.35 s, ease in-out) instead of snapping. Off-scene
// rigs (first paint, the locomotion rig swap before scene.add, freshly
// cloned ghosts) keep the instant path, so hidden repaints stay exact.
//
// Each fading mesh gets a transient material (clone of the target cache
// entry, rewound to the current look) so the shared matCache instances
// are never mutated. The per-frame driver writes to that transient
// material AND to whatever the mesh currently carries: systems that swap
// materials mid-fade (ghostify's transparent clones, the wireframe FX's
// clip clones) keep receiving colour updates and still land on the exact
// target values. When nothing intervened, the mesh settles back on the
// shared cache material, so the at-rest state is byte-identical to a
// snap (the wireframe FX caches clip clones per material uuid, which
// must stay stable across colour changes). Driven by a self-contained
// rAF ticker that only runs while fades are active - no render-loop hook
// needed, and rapid re-clicks simply retarget from the current colours.
const FADE_S = 0.35;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fades = new Map(); // mesh -> fade record
let fadeRaf = 0;

function driveFades() {
  const t = performance.now() / 1000;
  for (const [mesh, f] of fades) {
    const x = Math.min(1, (t - f.start) / FADE_S);
    const e = easeInOut(x);
    f.mat.color.lerpColors(f.fromColor, f.toColor, e);
    f.mat.roughness = f.fromRough + (f.toRough - f.fromRough) * e;
    f.mat.metalness = f.fromMetal + (f.toMetal - f.fromMetal) * e;
    const cur = mesh.material;
    if (cur !== f.mat && cur?.color) {
      cur.color.copy(f.mat.color);
      cur.roughness = f.mat.roughness;
      cur.metalness = f.mat.metalness;
    }
    if (x >= 1) {
      fades.delete(mesh);
      if (cur === f.mat) {
        mesh.material = matFor(f.spec);
        f.mat.dispose();
      }
    }
  }
  fadeRaf = fades.size ? requestAnimationFrame(driveFades) : 0;
}

export function applyVariant(rig, variant) {
  const v = typeof variant === "string" ? VARIANTS[variant] : variant;
  const map = meshMaterialsFor(v);
  const fade = !!rig.placer?.parent;
  rig.root.traverse((o) => {
    if (!o.isMesh || !o.userData.meshName) return;
    const spec = map[o.userData.meshName] ?? v.mechGray;
    const target = matFor(spec);
    if (!fade) {
      fades.delete(o);
      o.material = target;
      return;
    }
    // Already resting on the target material and not mid-fade: no-op.
    if (o.material === target && !fades.has(o)) return;
    const from = o.material;
    const m = target.clone();
    m.color.copy(from.color);
    m.roughness = from.roughness;
    m.metalness = from.metalness;
    fades.set(o, {
      mat: m,
      spec,
      fromColor: from.color.clone(),
      toColor: target.color.clone(),
      fromRough: from.roughness,
      toRough: target.roughness,
      fromMetal: from.metalness,
      toMetal: target.metalness,
      start: performance.now() / 1000,
    });
    o.material = m;
  });
  if (fades.size && !fadeRaf) fadeRaf = requestAnimationFrame(driveFades);
}

// Linear-space spec colour -> sRGB CSS hex, for swatch UI elements.
export function specToHex(spec) {
  return `#${new THREE.Color(...spec.color).getHexString()}`;
}
