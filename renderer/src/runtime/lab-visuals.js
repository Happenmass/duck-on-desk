import * as THREE from 'three';

// A lab-only view of the existing rig. Geometry, policy and joint ordering are unchanged.
export function createLabVisuals({rig, scene, camera, orbit}) {
  let selected = null, hologram = true;
  const meshes = [], markers = new Map();
  const cyan = new THREE.Color('#65eadb');
  rig.placer.traverse(mesh => {
    if (!mesh.isMesh) return;
    const original = mesh.material;
    const glass = original.clone();
    glass.color.set('#80bdd0'); glass.emissive.set('#163843');
    glass.metalness = 0.25; glass.roughness = 0.35; glass.opacity = 0.20;
    glass.transparent = true; glass.depthWrite = false;
    const highlight = glass.clone();
    highlight.color.copy(cyan); highlight.emissive.set('#15736a'); highlight.opacity = 0.36;
    const solid = original.clone();
    meshes.push({mesh, original, glass, highlight, solid});
    mesh.material = glass;
  });
  const dotGeometry = new THREE.SphereGeometry(0.0035, 12, 8);
  const ringGeometry = new THREE.TorusGeometry(0.015, 0.0006, 6, 44);
  for (const [name, joint] of rig.joints) {
    const material = new THREE.MeshBasicMaterial({color:cyan, transparent:true, opacity:0.75, depthTest:false});
    const dot = new THREE.Mesh(dotGeometry, material); dot.renderOrder = 5;
    const ring = new THREE.Mesh(ringGeometry, material); ring.visible = false; ring.renderOrder = 5;
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), joint.axis);
    const axis = new THREE.ArrowHelper(joint.axis, new THREE.Vector3(), 0.045, '#65eadb', 0.006, 0.003);
    axis.visible = false; axis.line.material.depthTest = false; axis.cone.material.depthTest = false;
    joint.body.add(dot, ring, axis); markers.set(name, {dot,ring,axis,joint});
  }
  const nodes = [...markers.values()];
  const pairs = nodes.flatMap(node => {
    let parent = node.joint.body.parent;
    while (parent) {
      const match = nodes.find(n => n.joint.body === parent);
      if (match) return [[match,node]];
      parent = parent.parent;
    }
    return [];
  });
  const skeletonGeometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(pairs.length*6);
  skeletonGeometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  const skeleton = new THREE.LineSegments(skeletonGeometry,new THREE.LineBasicMaterial({color:'#56a8c5',transparent:true,opacity:0.45,depthTest:false}));
  skeleton.renderOrder = 4; scene.add(skeleton);
  const stage = new THREE.Group();
  for (const radius of [0.17,0.23]) {
    const points = Array.from({length:97},(_,i)=>new THREE.Vector3(Math.cos(i/96*Math.PI*2)*radius,0.001,Math.sin(i/96*Math.PI*2)*radius));
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#1c5968',transparent:true,opacity:0.8}));
    stage.add(ring);
  }
  scene.add(stage);
  const point = new THREE.Vector3();
  const trunk = rig.bodies.get('trunk_base');
  const followedPosition = trunk.getWorldPosition(new THREE.Vector3());
  const followDelta = new THREE.Vector3();
  function inSelectedBody(mesh) {
    const body = markers.get(selected)?.joint.body;
    for (let obj = mesh; obj; obj = obj.parent) if (obj === body) return true;
    return false;
  }
  function paint() {
    for (const item of meshes) {
      const active = inSelectedBody(item.mesh);
      item.mesh.material = hologram ? (active ? item.highlight : item.glass) : item.solid;
      item.solid.emissive.set(active ? '#164d44' : '#000000');
    }
    for (const [name, {dot,ring,axis}] of markers) {
      const active = name === selected;
      dot.scale.setScalar(active ? 1.7 : 1); dot.material.opacity = active ? 1 : 0.55;
      ring.visible = axis.visible = active;
    }
  }
  function update() {
    rig.placer.updateWorldMatrix(true,true);
    pairs.forEach(([a,b],i)=>{
      a.joint.body.getWorldPosition(point).toArray(vertices,i*6);
      b.joint.body.getWorldPosition(point).toArray(vertices,i*6+3);
    });
    skeletonGeometry.attributes.position.needsUpdate = true;
    skeletonGeometry.computeBoundingSphere();
    trunk.getWorldPosition(point);stage.position.set(point.x,0,point.z);
    // Translate camera and focus together; preserve orbit/zoom/pan and ignore gait bounce.
    followDelta.copy(point).sub(followedPosition);followDelta.y=0;
    camera.position.add(followDelta);orbit.target.add(followDelta);
    followedPosition.copy(point);orbit.update();
  }
  function project() {
    return [...markers].map(([name,marker])=>{
      marker.joint.body.getWorldPosition(point).project(camera);
      return {name,x:(point.x+1)/2,y:(1-point.y)/2,visible:point.z>-1&&point.z<1&&Math.abs(point.x)<1&&Math.abs(point.y)<1};
    });
  }
  function view(direction='home') {
    const target = rig.bodies.get('trunk_base').getWorldPosition(new THREE.Vector3());
    followedPosition.copy(target);
    target.y = Math.max(0.13,target.y);
    const offsets={home:[0.36,0.16,0.5],front:[0,0.10,0.59],side:[0.59,0.10,0],top:[0,0.65,0.001]};
    camera.position.copy(target).add(new THREE.Vector3(...(offsets[direction]||offsets.home)));
    orbit.target.copy(target);orbit.update();
  }
  paint();
  return {
    update,project,view,
    select(name){if(!markers.has(name))throw Error('Unknown joint');selected=name;paint();},
    hologram(value){hologram=Boolean(value);paint();},
    dispose(){
      for(const item of meshes){item.mesh.material=item.original;item.glass.dispose();item.highlight.dispose();item.solid.dispose();}
      for(const {dot,ring,axis} of markers.values()){dot.removeFromParent();ring.removeFromParent();axis.removeFromParent();dot.material.dispose();axis.dispose();}
      dotGeometry.dispose();ringGeometry.dispose();skeleton.removeFromParent();skeletonGeometry.dispose();skeleton.material.dispose();
      stage.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});stage.removeFromParent();
    },
  };
}
