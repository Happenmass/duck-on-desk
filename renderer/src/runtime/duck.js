// Standalone JS port of microduck_app's src/duck/kinematics.ts.
// Loads kinematics.json (built from the MJCF by build_kinematics.py) and
// builds an Object3D tree with one Group per body. Joints become per-body
// local rotations driven by setJointAngles / setJoint.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { mergeVertices, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

// Cache-busting version appended to the GLB / kinematics / leftover STL
// fetches. Bump whenever microduck.glb is regenerated.
export const MESH_VERSION = "11";

// Default model directory: the complete mjlab export (converted from
// robot_walk.xml by tools/mjcf_to_kinematics.py). robot/v1.5/ and
// robot/alpha/ stay on disk for reference but the code no longer
// targets them.
export const MODEL_DIR = "./robot/mjlab";

// On a private HF Space, asset requests carry the ?__sign JWT (auth
// cookies may be blocked in the hub iframe). Identity everywhere else.
import { signed } from "./signed.js";

// Meshes fully occluded inside the shells at every demo camera angle,
// verified empirically by per-mesh pixel-diff (front 3/4, back, low
// front close-up): hiding each changes exactly 0 pixels. Skipped at
// load time so their bytes are never fetched. Load everything with
// `?all=1` for debugging.
const HIDDEN_MESHES = new Set([]);

export async function loadKinematics(url) {
  // Same cache-buster as the GLB: force-cache would otherwise keep
  // serving a stale kinematics.json after the mesh list changes.
  const r = await fetch(signed(`${url}?v=${MESH_VERSION}`), { cache: "force-cache" });
  if (!r.ok) throw new Error(`kinematics fetch ${r.status}`);
  const k = await r.json();
  // Full-resolution meshes by default (the reduction will be redone
  // interactively in Blender later). `?lite=1` opts into a decimated
  // meshes-lite/ sibling if present.
  if (new URLSearchParams(location.search).get("lite") === "1") {
    k.mesh_dir = k.mesh_dir.replace(/\/meshes$/, "/meshes-lite");
  }
  return k;
}

// One GLB, named meshes matching kinematics geom.mesh (e.g. "left_shell.stl").
// Positions are already welded (same 1e-4 m hash as mergeVertices). STL
// facet normals are omitted on purpose: creased normals are rebuilt here.
const GLB_URL = `${MODEL_DIR}/microduck.glb`;
const CREASE = Math.PI / 5; // 36 deg
let glbGeomsPromise = null;

export function loadGlbGeometries() {
  if (!glbGeomsPromise) {
    glbGeomsPromise = new GLTFLoader()
      .loadAsync(signed(`${GLB_URL}?v=${MESH_VERSION}`))
      .then((gltf) => {
        const map = new Map();
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const name = o.userData.meshFile || o.name || o.geometry.name;
          if (!name || map.has(name)) return;
          const welded = o.geometry;
          welded.deleteAttribute("normal");
          // toCreasedNormals hashes on a 0.01-unit grid. Meshes are in
          // metres, so scale a clone to mm (10 um grid) then back.
          const scaled = welded.clone();
          scaled.scale(1000, 1000, 1000);
          const display = toCreasedNormals(scaled, CREASE);
          display.scale(1e-3, 1e-3, 1e-3);
          const entry = { display, welded };
          map.set(name, entry);
          if (o.name && o.name !== name) map.set(o.name, entry);
        });
        return map;
      });
  }
  return glbGeomsPromise;
}

// MuJoCo's WASM compiler still wants binary STL in its VFS. Rebuild from
// the already-loaded GLB so the browser never re-downloads the mesh files.
export function geometryToBinaryStl(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const triCount = (idx ? idx.count : pos.count) / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triCount, true);
  let off = 84;
  const vx = (i) => {
    const j = idx ? idx.getX(i) : i;
    return [pos.getX(j), pos.getY(j), pos.getZ(j)];
  };
  for (let t = 0; t < triCount; t++) {
    const a = vx(t * 3);
    const b = vx(t * 3 + 1);
    const c = vx(t * 3 + 2);
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(off, nx / len, true);
    view.setFloat32(off + 4, ny / len, true);
    view.setFloat32(off + 8, nz / len, true);
    view.setFloat32(off + 12, a[0], true);
    view.setFloat32(off + 16, a[1], true);
    view.setFloat32(off + 20, a[2], true);
    view.setFloat32(off + 24, b[0], true);
    view.setFloat32(off + 28, b[1], true);
    view.setFloat32(off + 32, b[2], true);
    view.setFloat32(off + 36, c[0], true);
    view.setFloat32(off + 40, c[1], true);
    view.setFloat32(off + 44, c[2], true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  }
  return buf;
}

// Materials are PBR (MeshStandardMaterial), same family as the Reachy
// mobile app's glb viewer. Optional silhouette outlines via three's
// OutlineEffect - see main.js.

export async function buildRig(k, opts = {}) {
  // placer holds world-space position + yaw (no axis-conversion).
  const placer = new THREE.Group();
  placer.name = "duck_placer";
  // root applies the MJCF +Z up -> three.js +Y up convention fix.
  const root = new THREE.Group();
  root.name = "duck_root";
  root.rotation.x = -Math.PI / 2;
  placer.add(root);

  const bodies = new Map();
  const joints = new Map();
  const geomByName = await loadGlbGeometries();
  // Roller-only meshes (tire, rim, ...) are not in the shared landing GLB.
  const extraStlCache = new Map();
  const loadMesh = (name) => {
    const entry = geomByName.get(name);
    if (entry) return Promise.resolve(entry);
    if (!extraStlCache.has(name)) {
      extraStlCache.set(
        name,
        new STLLoader().loadAsync(signed(`${k.mesh_dir}/${name}?v=${MESH_VERSION}`)).then((raw) => {
          raw.deleteAttribute("normal");
          const welded = mergeVertices(raw, 1e-4);
          welded.scale(1000, 1000, 1000);
          const display = toCreasedNormals(welded, CREASE);
          display.scale(1e-3, 1e-3, 1e-3);
          welded.scale(1e-3, 1e-3, 1e-3);
          return { display, welded };
        }),
      );
    }
    return extraStlCache.get(name);
  };

  for (const b of k.bodies) {
    const g = new THREE.Group();
    g.name = b.name;
    g.position.set(b.pos[0], b.pos[1], b.pos[2]);
    g.quaternion.set(b.quat[1], b.quat[2], b.quat[3], b.quat[0]);
    bodies.set(b.name, g);
  }
  for (const b of k.bodies) {
    const g = bodies.get(b.name);
    if (b.parent && bodies.has(b.parent)) bodies.get(b.parent).add(g);
    else root.add(g);
  }
  for (const b of k.bodies) {
    if (!b.joint || (b.joint.type && b.joint.type !== "hinge")) continue;
    const g = bodies.get(b.name);
    joints.set(b.joint.name, {
      body: g,
      axis: new THREE.Vector3(...b.joint.axis).normalize(),
      baseQuat: g.quaternion.clone(),
      range: b.joint.range ?? null,
    });
  }

  // Cache materials by their resolved PBR props so identical parts share
  // one GPU material instance.
  const matCache = new Map();
  // Optional (meshName, bodyName, rgba) -> material spec hook. A spec is
  // { color: [r,g,b], roughness, metalness, opacity? }; plain rgba arrays
  // are also accepted for backwards compat.
  const materialForMesh = opts.materialForMesh ?? null;
  const matFor = (spec) => {
    const color = spec.color;
    const roughness = spec.roughness ?? 0.5;
    const metalness = spec.metalness ?? 0.0;
    const opacity = spec.opacity ?? 1;
    const key = `${color.join(",")}|${roughness}|${metalness}|${opacity}`;
    const cached = matCache.get(key);
    if (cached) return cached;
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...color),
      roughness,
      metalness,
      transparent: opacity < 1,
      opacity,
    });
    matCache.set(key, m);
    return m;
  };
  const toSpec = (v, fallbackRgba) => {
    if (!v) return { color: fallbackRgba.slice(0, 3), opacity: fallbackRgba[3] ?? 1 };
    if (Array.isArray(v)) return { color: v.slice(0, 3), opacity: v[3] ?? 1 };
    return v;
  };

  // Optional interior ink lines: hard edges above the threshold angle
  // drawn as line segments, comic style. Cached per mesh file.
  const inkOpts = opts.inkEdges ?? null;
  const inkMat = inkOpts
    ? new THREE.LineBasicMaterial({
        color: inkOpts.color ?? 0x0a0a0e,
        transparent: true,
        opacity: inkOpts.opacity ?? 0.55,
      })
    : null;
  const edgeCache = new Map();
  const edgesFor = (name, welded) => {
    if (!edgeCache.has(name)) {
      edgeCache.set(name, new THREE.EdgesGeometry(welded, inkOpts.threshold ?? 40));
    }
    return edgeCache.get(name);
  };

  const pending = [];
  const loadAll = new URLSearchParams(location.search).get("all") === "1";
  // The MJCF lists a few geoms twice with identical transforms (visual +
  // collision copies of power_support, soles, legs); drawing both would
  // only z-fight, so exact duplicates are skipped.
  const seenGeoms = new Set();
  for (const b of k.bodies) {
    const g = bodies.get(b.name);
    if (!g) continue;
    for (const geom of b.geoms) {
      if (geom.type && geom.type !== "mesh") continue;
      if (!geom.mesh) continue;
      if (!loadAll && HIDDEN_MESHES.has(geom.mesh)) continue;
      const dupKey = `${b.name}|${geom.mesh}|${geom.pos}|${geom.quat}`;
      if (seenGeoms.has(dupKey)) continue;
      seenGeoms.add(dupKey);
      pending.push(
        loadMesh(geom.mesh).then(({ display, welded }) => {
          const rgba = geom.color
            ? [geom.color[0], geom.color[1], geom.color[2], geom.color[3] ?? 1]
            : [0.85, 0.85, 0.85, 1];
          const spec = toSpec(materialForMesh?.(geom.mesh, b.name, rgba), rgba);
          const m = new THREE.Mesh(display, matFor(spec));
          // Mesh filename tag so callers can re-skin materials in place
          // (survives cloneRig: Object3D.copy deep-copies userData).
          m.userData.meshName = geom.mesh;
          if (geom.pos) m.position.set(...geom.pos);
          if (geom.quat) m.quaternion.set(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0]);
          g.add(m);
          if (inkMat) {
            const lines = new THREE.LineSegments(edgesFor(geom.mesh, welded), inkMat);
            lines.position.copy(m.position);
            lines.quaternion.copy(m.quaternion);
            g.add(lines);
          }
        }),
      );
    }
  }
  await Promise.all(pending);

  const rig = { placer, root, bodies, joints };
  setupJawPivot(rig);
  return rig;
}

// ── Jaw hinge ───────────────────────────────────────────────────────────
// The mjlab model has no passive jaw joints: jaw.stl / jaw_soft.stl are
// rigid geoms of the head body (named "jaw_soft" in the MJCF, it carries
// the head_roll joint). The quack re-creates the hinge in JS: both jaw
// meshes are reparented into a "jaw_pivot" group whose origin sits on the
// physical hinge, and setJawOpen rotates that pivot about the robot's
// left-right axis so the beak tip swings down.
const JAW_MESH_NAMES = new Set(["jaw.stl", "jaw_soft.stl"]);
export const JAW_MAX_OPEN = 0.32; // rad at openness 1

// The physical hinge: jaw.stl ends in a circular boss (8 mm ring with the
// axle hole at its center) on each side, hole axis along mesh-local X (the
// robot's left-right). Circle fitted offline on the STL's hole-wall
// vertices (RANSAC, 68 inliers, < 0.15 mm spread); x = 0 sits mid-way
// between the two bosses, on the hinge line.
const JAW_HINGE_LOCAL = new THREE.Vector3(0, 0.00004, 0.0075);

function setupJawPivot(rig) {
  const meshes = [];
  rig.root.traverse((o) => {
    if (o.isMesh && JAW_MESH_NAMES.has(o.userData.meshName)) meshes.push(o);
  });
  if (!meshes.length) return;
  const body = meshes[0].parent;
  // The placer is still untransformed right after buildRig, so world
  // coords == placer coords here: robot forward is +X, up is +Y.
  rig.placer.updateWorldMatrix(true, true);
  const jawMesh = meshes.find((m) => m.userData.meshName === "jaw.stl") ?? meshes[0];
  const hingeW = jawMesh.localToWorld(JAW_HINGE_LOCAL.clone());
  // +angle about -Z rotates the +X beak tip toward -Y (down).
  const axisW = new THREE.Vector3(0, 0, -1);
  const bodyQuatInv = body.getWorldQuaternion(new THREE.Quaternion()).invert();
  const hingeL = body.worldToLocal(hingeW.clone());
  const axisL = axisW.applyQuaternion(bodyQuatInv).normalize();
  const pivot = new THREE.Group();
  pivot.name = "jaw_pivot";
  pivot.position.copy(hingeL);
  // Plain array so Object3D.copy's JSON userData clone preserves it.
  pivot.userData.jawAxis = axisL.toArray();
  body.add(pivot);
  for (const m of meshes) {
    m.position.sub(hingeL);
    pivot.add(m);
  }
}

// Open the beak: 0 = closed, 1 = fully open (JAW_MAX_OPEN rad). The pivot
// is resolved lazily by name so clones from cloneRig work transparently.
const _jawAxis = new THREE.Vector3();
export function setJawOpen(rig, open) {
  if (rig._jawPivot === undefined) {
    rig._jawPivot = rig.placer.getObjectByName("jaw_pivot") ?? null;
  }
  const pivot = rig._jawPivot;
  if (!pivot) return;
  _jawAxis.fromArray(pivot.userData.jawAxis);
  pivot.quaternion.setFromAxisAngle(_jawAxis, JAW_MAX_OPEN * open);
}

// Set one named joint, clamped to its MJCF range when known.
export function setJoint(rig, name, angle) {
  const j = rig.joints.get(name);
  if (!j) return;
  let a = angle;
  if (j.range) a = Math.min(j.range[1], Math.max(j.range[0], a));
  const rot = _q.setFromAxisAngle(j.axis, a);
  j.body.quaternion.copy(j.baseQuat).multiply(rot);
}
const _q = new THREE.Quaternion();

export function applyPose(rig, pose) {
  for (const [name, ang] of Object.entries(pose)) setJoint(rig, name, ang);
}

// Deep-clone a built rig without re-parsing the GLB: Object3D.clone
// shares geometry and materials, so N clones cost almost nothing on top of
// the first buildRig. The bodies/joints maps are rebuilt by looking up the
// cloned nodes by name (body names are unique in the MJCF).
export function cloneRig(rig) {
  const placer = rig.placer.clone(true);
  const root = placer.getObjectByName("duck_root");
  const bodies = new Map();
  for (const name of rig.bodies.keys()) {
    bodies.set(name, placer.getObjectByName(name));
  }
  const joints = new Map();
  for (const [name, j] of rig.joints) {
    joints.set(name, {
      body: placer.getObjectByName(j.body.name),
      axis: j.axis, // read-only, safe to share
      baseQuat: j.baseQuat.clone(),
      range: j.range,
    });
  }
  return { placer, root, bodies, joints };
}

// Ground using the whole rig's bounding box (sitting pose folds the legs
// under the trunk, so the feet are not the lowest point).
const _box = new THREE.Box3();
export function groundFullBody(rig, floorY = 0) {
  rig.placer.updateWorldMatrix(true, true);
  _box.setFromObject(rig.placer);
  if (!Number.isFinite(_box.min.y)) return 0;
  rig.placer.position.y += floorY - _box.min.y;
  return floorY - _box.min.y;
}

// "SIT" keyframe. The mjlab model shares alpha's conventions (same
// onshape-to-robot pipeline): neck_pitch range max is 1.0472, so
// neck_pitch sits just under it (headroom for the breathing oscillation,
// +-0.025) and head_pitch compensates to keep the head level-ish with a
// slight upward tilt toward the camera. NOTE: head_pitch sign is
// inverted vs v1.5 (positive = head down), so the compensation is
// positive here (verified visually).
export const SITTING_POSE = {
  left_hip_yaw: 0.0,
  left_hip_roll: 0.0,
  left_hip_pitch: -0.5236,
  left_knee: 1.0472,
  left_ankle: 0.0,
  neck_pitch: 1.02,
  head_pitch: 0.9,
  head_yaw: 0.0,
  head_roll: 0.0,
  right_hip_yaw: 0.0,
  right_hip_roll: 0.0,
  right_hip_pitch: 0.5236,
  right_knee: -1.0472,
  right_ankle: 0.0,
};
