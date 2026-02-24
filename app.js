// ================================================================
//  Cubagem & Picking WebXR — v8
// ================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TX = 0.012;
const TY = 0.004;
const CMAP = { red: 0xe53935, green: 0x43a047, blue: 0x1e88e5 };
const TRUCK = { w: 1.2, h: 0.8, d: 2.4 };

let mode = 'cubagem', isSim = false, boxes = [], next = genBox();
let reticleOk = false, xrSession = null, htSource = null, truckPlaced = false;
let arRefSpace = null, lastHitMatrix = null;

const $ = id => document.getElementById(id);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 120);
camera.position.set(0, 4, 8);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);
let controls = null;

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dl = new THREE.DirectionalLight(0xffffff, 1.6);
dl.position.set(4, 8, 4); scene.add(dl);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.12, 32).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({ color: 0xff69b4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
reticle.visible = false; reticle.matrixAutoUpdate = false; scene.add(reticle);

let preview = mkBox(next, true); preview.visible = false; scene.add(preview);

const truckGrp = new THREE.Group(); truckGrp.visible = false; scene.add(truckGrp);
buildTruck();

let simFloor = null;

function genBox() {
  const w = +(Math.random()*0.4+0.08).toFixed(2);
  const h = +(Math.random()*0.3+0.05).toFixed(2);
  const d = +(Math.random()*0.4+0.08).toFixed(2);
  const v = w*h*d;
  let color;
  if (v > TX) color = 'red';
  else if (v > TY) color = 'green';
  else color = 'blue';
  return { w, h, d, v, color };
}

function mkBox(b, ghost=false) {
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mat = new THREE.MeshStandardMaterial({
    color: CMAP[b.color], transparent: true,
    opacity: ghost ? 0.35 : 0.92, roughness: 0.35, metalness: 0.08,
  });
  const m = new THREE.Mesh(geo, mat);
  m.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: ghost ? 0xff69b4 : 0x220011 })
  ));
  return m;
}

function canStack(top, bot) {
  if (top === bot) return true;
  if (top === 'blue' && (bot === 'green' || bot === 'red')) return true;
  if (top === 'green' && bot === 'red') return true;
  return false;
}

function findTop(x, z, list) {
  let best = null, by = 0;
  for (const b of list) {
    const p = b.mesh.position;
    if (Math.abs(p.x-x) < 0.2 && Math.abs(p.z-z) < 0.2) {
      const t = p.y + b.h/2;
      if (t > by) { by = t; best = b; }
    }
  }
  return best;
}

function buildTruck() {
  const { w: tw, h: th, d: td } = TRUCK;
  const wt = 0.03;
  const wallMat = () => new THREE.MeshStandardMaterial({
    color: 0xff69b4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, roughness: 0.85, depthWrite: false
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(tw, wt, td),
    new THREE.MeshStandardMaterial({ color: 0xff2d87, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  truckGrp.add(floor);
  const wl = new THREE.Mesh(new THREE.BoxGeometry(wt, th, td), wallMat());
  wl.position.set(-tw/2, th/2, 0); truckGrp.add(wl);
  const wr = new THREE.Mesh(new THREE.BoxGeometry(wt, th, td), wallMat());
  wr.position.set(tw/2, th/2, 0); truckGrp.add(wr);
  const wb = new THREE.Mesh(new THREE.BoxGeometry(tw, th, wt), wallMat());
  wb.position.set(0, th/2, -td/2); truckGrp.add(wb);
  const wf = new THREE.Mesh(new THREE.BoxGeometry(tw, th, wt), wallMat());
  wf.material.opacity = 0.05;
  wf.position.set(0, th/2, td/2); truckGrp.add(wf);
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td));
  const el = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff2d87 }));
  el.position.set(0, th/2, 0); truckGrp.add(el);
  const g = new THREE.GridHelper(Math.max(tw, td), 10, 0xff69b4, 0x4a1042);
  g.position.y = 0.02; g.material.transparent = true; g.material.opacity = 0.3;
  truckGrp.add(g);
  const cg = new THREE.SphereGeometry(0.03, 8, 8);
  const cm = new THREE.MeshBasicMaterial({ color: 0xff2d87 });
  [[-tw/2,0,-td/2],[tw/2,0,-td/2],[-tw/2,0,td/2],[tw/2,0,td/2],
   [-tw/2,th,-td/2],[tw/2,th,-td/2],[-tw/2,th,td/2],[tw/2,th,td/2]].forEach(c => {
    const s = new THREE.Mesh(cg, cm); s.position.set(c[0],c[1],c[2]); truckGrp.add(s);
  });
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const cx = cv.getContext('2d');
  cx.clearRect(0,0,512,128);
  cx.font = 'bold 50px Poppins, sans-serif';
  cx.fillStyle = '#ff2d87'; cx.textAlign = 'center';
  cx.fillText('CAÇAMBA', 256, 80);
  const tex = new THREE.CanvasTexture(cv);
  const lm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.3),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  lm.position.set(0, th+0.25, 0); lm.rotation.x = -Math.PI*0.15;
  truckGrp.add(lm);
}

function insideTruck(p, b) {
  const hw = TRUCK.w/2, hd = TRUCK.d/2;
  return !(p.x-b.w/2 < -hw || p.x+b.w/2 > hw || p.z-b.d/2 < -hd || p.z+b.d/2 > hd || p.y+b.h/2 > TRUCK.h);
}

let tt;
function toast(msg, ms=2500, ok=false) {
  $('toast').textContent = msg;
  $('toast').className = 'show ' + (ok ? 'success' : 'error');
  clearTimeout(tt); tt = setTimeout(() => $('toast').className = '', ms);
}

function updHUD() {
  const mn = mode==='cubagem' ? 'Cubagem' : 'Picking';
  $('hud-mode').innerHTML = 'Modo: <b>'+mn+'</b>';
  $('hud-count').innerHTML = 'Caixas: <b>'+boxes.length+'</b>';
  const cn = { red:'🔴 Vermelha', green:'🟢 Verde', blue:'🔵 Azul' };
  $('hud-next').innerHTML = 'Próxima: <b>'+cn[next.color]+'</b>';
  $('hud-vol').innerHTML = 'Vol: <b>'+(next.v*1e6).toFixed(0)+'cm³</b> ('+next.w.toFixed(2)+'×'+next.h.toFixed(2)+'×'+next.d.toFixed(2)+'m)';
  $('mode-toggle').textContent = '🔄 '+mn;
}

function refreshPreview() {
  scene.remove(preview); preview.geometry.dispose();
  preview = mkBox(next, true); preview.visible = false; scene.add(preview);
}

function getARPlacePos() {
  if (lastHitMatrix) {
    const p = new THREE.Vector3();
    p.setFromMatrixPosition(new THREE.Matrix4().fromArray(lastHitMatrix));
    return p;
  }
  const cam = renderer.xr.getCamera();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const p = cam.position.clone().add(dir.multiplyScalar(1.5));
  p.y = 0;
  return p;
}

function placeBox() {
  const pos = new THREE.Vector3();
  if (isSim) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0,0), camera);
    if (mode === 'picking') {
      const h = rc.intersectObjects(truckGrp.children, true);
      if (h.length) pos.copy(truckGrp.worldToLocal(h[0].point.clone()));
      else pos.set((Math.random()-.5)*TRUCK.w*0.5, 0, (Math.random()-.5)*TRUCK.d*0.5);
    } else {
      const h = rc.intersectObject(simFloor);
      if (h.length) pos.copy(h[0].point);
      else pos.set((Math.random()-.5)*3, 0, (Math.random()-.5)*3);
    }
  } else {
    pos.copy(getARPlacePos());
  }
  if (mode === 'picking') {
    if (!truckPlaced) {
      truckGrp.position.copy(pos);
      truckGrp.visible = true;
      truckPlaced = true;
      toast('🚛 Caçamba posicionada!', 2500, true);
      updHUD(); return;
    }
    const lp = isSim ? pos.clone() : truckGrp.worldToLocal(pos.clone());
    const st = findTop(lp.x, lp.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('❌ '+next.color.toUpperCase()+' não empilha sobre '+st.color.toUpperCase()+'!');
        return;
      }
      lp.y = st.mesh.position.y + st.h/2 + next.h/2;
      lp.x = st.mesh.position.x; lp.z = st.mesh.position.z;
    } else { lp.y = next.h/2; }
    if (!insideTruck(lp, next)) { toast('❌ Caixa fora da caçamba!'); return; }
    const m = mkBox(next); m.position.copy(lp); truckGrp.add(m);
    boxes.push({ mesh:m, color:next.color, v:next.v, w:next.w, h:next.h, d:next.d });
    toast('✅ Caixa na caçamba!', 1500, true);
  } else {
    const st = findTop(pos.x, pos.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('❌ '+next.color.toUpperCase()+' não empilha sobre '+st.color.toUpperCase()+'!');
        return;
      }
      pos.y = st.mesh.position.y + st.h/2 + next.h/2;
      pos.x = st.mesh.position.x; pos.z = st.mesh.position.z;
    } else { pos.y += next.h/2; }
    const m = mkBox(next); m.position.copy(pos); scene.add(m);
    boxes.push({ mesh:m, color:next.color, v:next.v, w:next.w, h:next.h, d:next.d });
    toast('✅ Caixa posicionada!', 1500, true);
  }
  next = genBox(); refreshPreview(); updHUD();
}

function undoBox() {
  if (!boxes.length) return;
  const l = boxes.pop();
  l.mesh.parent?.remove(l.mesh); l.mesh.geometry.dispose();
  toast('↩ Removida!', 1200, true); updHUD();
}

function resetAll() {
  boxes.forEach(b => { b.mesh.parent?.remove(b.mesh); b.mesh.geometry.dispose(); });
  boxes = [];
  truckPlaced = false; truckGrp.visible = false;
  if (mode === 'picking' && isSim) {
    truckGrp.position.set(0,0,-2); truckGrp.visible = true; truckPlaced = true;
  }
  next = genBox(); refreshPreview(); updHUD();
  toast('✨ Resetado!', 1200, true);
}

function toggleMode() {
  mode = mode==='cubagem' ? 'picking' : 'cubagem';
  if (mode === 'picking') {
    if (isSim) {
      truckGrp.visible = true;
      if (!truckPlaced) { truckGrp.position.set(0,0,-2); truckPlaced = true; }
      toast('🚛 Picking — coloque caixas na caçamba!', 2500, true);
    } else {
      if (!truckPlaced) toast('🚛 Toque COLOCAR para posicionar a caçamba!', 3000, true);
      else { truckGrp.visible = true; toast('🚛 Picking ativo!', 2000, true); }
    }
  } else { truckGrp.visible = false; toast('📐 Cubagem — empilhe livremente!', 1500, true); }
  updHUD();
}

$('btn-place').onclick = placeBox;
$('btn-undo').onclick = undoBox;
$('btn-reset').onclick = resetAll;
$('mode-toggle').onclick = toggleMode;

function enterHUD(sim) {
  $('overlay').classList.add('hidden');
  $('hud').classList.add('active');
  $('crosshair').classList.toggle('active', !sim);
  $('legend').classList.add('active');
  $('sim-badge').classList.toggle('active', sim);
  updHUD();
}

async function initAR() {
  if (!navigator.xr) { $('ar-status').textContent = '⚠️ WebXR indisponível.'; return; }
  const cfgs = [
    { req: ['hit-test'], opt: ['local-floor','dom-overlay'], ov: true },
    { req: ['hit-test'], opt: ['local-floor'], ov: false },
    { req: ['hit-test'], opt: [], ov: false },
    { req: [], opt: ['hit-test','local-floor'], ov: false },
    { req: [], opt: ['local-floor'], ov: false },
    { req: [], opt: [], ov: false },
  ];
  let session = null;
  for (const c of cfgs) {
    try {
      const opts = { requiredFeatures: c.req, optionalFeatures: c.opt };
      if (c.ov) opts.domOverlay = { root: document.body };
      session = await navigator.xr.requestSession('immersive-ar', opts);
      break;
    } catch(e) { console.warn('AR cfg fail:', e.message); }
  }
  if (!session) { $('ar-status').textContent = '❌ AR não suportado.'; return; }
  xrSession = session;
  session.addEventListener('end', () => {
    xrSession = null; htSource = null; arRefSpace = null; lastHitMatrix = null;
    $('overlay').classList.remove('hidden');
    $('hud').classList.remove('active');
    $('crosshair').classList.remove('active');
    $('legend').classList.remove('active');
    $('sim-badge').classList.remove('active');
  });
  try { arRefSpace = await session.requestReferenceSpace('local-floor'); }
  catch {
    try { arRefSpace = await session.requestReferenceSpace('local'); }
    catch { arRefSpace = await session.requestReferenceSpace('viewer'); }
  }
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  try {
    const vs = await session.requestReferenceSpace('viewer');
    htSource = await session.requestHitTestSource({ space: vs });
  } catch(e) { htSource = null; }
  enterHUD(false);
  if (!htSource) toast('ℹ️ Sem hit-test. Caixas vão 1.5m à frente.', 4000, true);
  renderer.setAnimationLoop((t, f) => renderAR(t, f));
}

function initSim() {
  isSim = true; enterHUD(true);
  simFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(30,30),
    new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: 0.95 })
  );
  simFloor.rotation.x = -Math.PI/2; scene.add(simFloor);
  const grid = new THREE.GridHelper(30, 50, 0xff2d87, 0x3a0f28);
  grid.position.y = 0.005; grid.material.transparent = true; grid.material.opacity = 0.3;
  scene.add(grid);
  truckGrp.position.set(0, 0, -2);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI/2.05;
  controls.minDistance = 1; controls.maxDistance = 25;
  controls.update();
  scene.background = new THREE.Color(0x1a0a12);
  scene.fog = new THREE.Fog(0x1a0a12, 12, 32);
  renderer.setAnimationLoop(renderSim);
}

function renderAR(time, frame) {
  if (!frame) return;
  if (htSource && arRefSpace) {
    const results = frame.getHitTestResults(htSource);
    if (results.length > 0) {
      const pose = results[0].getPose(arRefSpace);
      if (pose) {
        lastHitMatrix = pose.transform.matrix;
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        reticleOk = true;
        const p = new THREE.Vector3();
        p.setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.transform.matrix));
        preview.visible = true;
        preview.position.set(p.x, p.y + next.h/2, p.z);
      }
    } else { reticle.visible = false; preview.visible = false; }
  } else {
    reticle.visible = false;
    const cam = renderer.xr.getCamera();
    if (cam && cam.position.lengthSq() > 0) {
      const dir = new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);
      const fp = cam.position.clone().add(dir.multiplyScalar(1.5));
      fp.y = Math.max(fp.y - 0.5, 0);
      preview.visible = true;
      preview.position.set(fp.x, fp.y + next.h/2, fp.z);
    }
  }
  if (reticle.visible) reticle.material.opacity = 0.5 + 0.35*Math.sin(time*0.003);
  renderer.render(scene, camera);
}

function renderSim() {
  controls.update();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0,0), camera);
  if (mode === 'picking' && truckGrp.visible) {
    const h = rc.intersectObjects(truckGrp.children, true);
    if (h.length) {
      const lp = truckGrp.worldToLocal(h[0].point.clone());
      preview.visible = true;
      preview.position.copy(truckGrp.localToWorld(new THREE.Vector3(lp.x, next.h/2, lp.z)));
    } else preview.visible = false;
  } else if (simFloor) {
    const h = rc.intersectObject(simFloor);
    if (h.length) {
      preview.visible = true;
      preview.position.set(h[0].point.x, h[0].point.y + next.h/2, h[0].point.z);
    } else preview.visible = false;
  }
  renderer.render(scene, camera);
}

$('start-ar').onclick = initAR;
$('start-sim').onclick = initSim;

(async () => {
  if (!navigator.xr) {
    $('ar-status').textContent = '⚠️ WebXR não disponível — use Modo Simulação.';
    $('start-ar').disabled = true; return;
  }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) {
    $('ar-status').textContent = '⚠️ AR não suportado — use Modo Simulação.';
    $('start-ar').disabled = true;
  }
})();

addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
