import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TX = 0.012, TY = 0.004;
const CMAP = { red: 0xe53935, green: 0x43a047, blue: 0x1e88e5 };
const TRUCK = { w: 2.4, h: 1.5, d: 6.0 };

let mode = 'cubagem', isSim = false, boxes = [], next = genBox();
let reticleOk = false, xrSession = null, htSource = null, truckPlaced = false;
let arRefSpace = null;

const $ = id => document.getElementById(id);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 80);
camera.position.set(0, 3, 6);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);
let controls = null;

scene.add(new THREE.AmbientLight(0xffc0cb, 0.7));
const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(4, 6, 4); scene.add(dl);
scene.add(new THREE.PointLight(0xff69b4, 0.7, 15));

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.12, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff69b4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
reticle.visible = false; reticle.matrixAutoUpdate = false; scene.add(reticle);

let preview = mkBox(next, true); preview.visible = false; scene.add(preview);

const truckGrp = new THREE.Group(); truckGrp.visible = false; scene.add(truckGrp);
buildTruck();
let simFloor = null;

function genBox() {
  const w = +(Math.random() * .4 + .1).toFixed(2);
  const h = +(Math.random() * .3 + .05).toFixed(2);
  const d = +(Math.random() * .4 + .1).toFixed(2);
  const v = w * h * d;
  return { w, h, d, v, color: v > TX ? 'red' : v > TY ? 'green' : 'blue' };
}

function mkBox(b, ghost = false) {
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mat = new THREE.MeshStandardMaterial({
    color: CMAP[b.color], transparent: true,
    opacity: ghost ? .35 : .92, roughness: .4, metalness: .05
  });
  const m = new THREE.Mesh(geo, mat);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: ghost ? 0xff69b4 : 0x220011 })));
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
    if (Math.abs(p.x - x) < .18 && Math.abs(p.z - z) < .18) {
      const t = p.y + b.h / 2;
      if (t > by) { by = t; best = b; }
    }
  }
  return best;
}

function buildTruck() {
  const { w: tw, h: th, d: td } = TRUCK;
  const wm = () => new THREE.MeshStandardMaterial({
    color: 0xff69b4, transparent: true, opacity: .18,
    side: THREE.DoubleSide, roughness: .85, depthWrite: false
  });
  const fl = new THREE.Mesh(new THREE.BoxGeometry(tw, .04, td), wm());
  fl.material.opacity = .3; fl.material.color.set(0xff2d87); truckGrp.add(fl);
  const wl = new THREE.Mesh(new THREE.BoxGeometry(.04, th, td), wm()); wl.position.set(-tw / 2, th / 2, 0); truckGrp.add(wl);
  const wr = new THREE.Mesh(new THREE.BoxGeometry(.04, th, td), wm()); wr.position.set(tw / 2, th / 2, 0); truckGrp.add(wr);
  const wb = new THREE.Mesh(new THREE.BoxGeometry(tw, th, .04), wm()); wb.position.set(0, th / 2, -td / 2); truckGrp.add(wb);
  const eg = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td)),
    new THREE.LineBasicMaterial({ color: 0xff2d87 })
  ); eg.position.set(0, th / 2, 0); truckGrp.add(eg);
  const eg2 = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(tw + .02, th + .02, td + .02)),
    new THREE.LineBasicMaterial({ color: 0xff69b4, transparent: true, opacity: .4 })
  ); eg2.position.set(0, th / 2, 0); truckGrp.add(eg2);
  const g = new THREE.GridHelper(Math.max(tw, td), 14, 0xff69b4, 0x4a1042);
  g.position.y = .025; g.material.transparent = true; g.material.opacity = .4; truckGrp.add(g);
  const cg = new THREE.SphereGeometry(.04, 12, 12), cm = new THREE.MeshBasicMaterial({ color: 0xff2d87 });
  [[-tw/2,0,-td/2],[tw/2,0,-td/2],[-tw/2,0,td/2],[tw/2,0,td/2],
   [-tw/2,th,-td/2],[tw/2,th,-td/2],[-tw/2,th,td/2],[tw/2,th,td/2]
  ].forEach(c => { const s = new THREE.Mesh(cg, cm); s.position.set(...c); truckGrp.add(s); });
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const cx = cv.getContext('2d');
  cx.font = 'bold 56px Poppins,sans-serif'; cx.fillStyle = '#ff2d87'; cx.textAlign = 'center';
  cx.fillText('CACAMBA', 256, 80);
  const tx = new THREE.CanvasTexture(cv);
  const lb = new THREE.Mesh(new THREE.PlaneGeometry(2, .5),
    new THREE.MeshBasicMaterial({ map: tx, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  lb.position.set(0, th + .35, 0); lb.rotation.x = -.15; truckGrp.add(lb);
}

function insideTruck(p, b) {
  const hw = TRUCK.w / 2, hd = TRUCK.d / 2;
  return !(p.x - b.w/2 < -hw || p.x + b.w/2 > hw || p.z - b.d/2 < -hd || p.z + b.d/2 > hd || p.y + b.h/2 > TRUCK.h);
}

let tt;
function toast(msg, ms = 2500, ok = false) {
  $('toast').textContent = msg;
  $('toast').className = 'show ' + (ok ? 'success' : 'error');
  clearTimeout(tt); tt = setTimeout(() => $('toast').className = '', ms);
}

function updHUD() {
  const mn = mode === 'cubagem' ? 'Cubagem' : 'Picking';
  $('hud-mode').innerHTML = 'Modo: <b>' + mn + '</b>';
  $('hud-count').innerHTML = 'Caixas: <b>' + boxes.length + '</b>';
  $('hud-next').innerHTML = 'Proxima: <b>' + { red: 'Vermelha', green: 'Verde', blue: 'Azul' }[next.color] + '</b>';
  $('hud-vol').innerHTML = 'Vol: <b>' + (next.v * 1e6).toFixed(0) + 'cm3</b>';
  $('mode-toggle').textContent = 'Modo: ' + mn;
}

function refreshPreview() {
  scene.remove(preview); preview.geometry.dispose();
  preview = mkBox(next, true); preview.visible = false; scene.add(preview);
}

function placeBox() {
  if (!isSim && !reticleOk) { toast('Aponte para o chao!'); return; }
  const pos = new THREE.Vector3();
  if (isSim) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    if (mode === 'picking') {
      const h = rc.intersectObjects(truckGrp.children, true);
      if (h.length) pos.copy(truckGrp.worldToLocal(h[0].point.clone()));
      else pos.set((Math.random() - .5) * 1.5, 0, (Math.random() - .5) * 4);
    } else {
      const h = rc.intersectObject(simFloor);
      if (h.length) pos.copy(h[0].point); else pos.set((Math.random() - .5) * 2, 0, (Math.random() - .5) * 2);
    }
  } else {
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    reticle.matrix.decompose(pos, q, s);
  }
  if (mode === 'picking') {
    if (!isSim && !truckPlaced) {
      const tp = pos.clone(); tp.z -= TRUCK.d / 2 + .3;
      truckGrp.position.copy(tp); truckGrp.visible = true; truckPlaced = true;
      $('tap-hint').classList.remove('active');
      toast('Cacamba posicionada! Agora empilhe as caixas.', 3000, true); updHUD(); return;
    }
    const lp = isSim ? pos.clone() : truckGrp.worldToLocal(pos.clone());
    const st = findTop(lp.x, lp.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) { toast('NAO PODE: ' + next.color + ' sobre ' + st.color); return; }
      lp.y = st.mesh.position.y + st.h / 2 + next.h / 2; lp.x = st.mesh.position.x; lp.z = st.mesh.position.z;
    } else { lp.y = next.h / 2; }
    if (!insideTruck(lp, next)) { toast('Fora da cacamba!'); return; }
    const m = mkBox(next); m.position.copy(lp); truckGrp.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa na cacamba!', 1500, true);
  } else {
    const st = findTop(pos.x, pos.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) { toast('NAO PODE: ' + next.color + ' sobre ' + st.color); return; }
      pos.y = st.mesh.position.y + st.h / 2 + next.h / 2; pos.x = st.mesh.position.x; pos.z = st.mesh.position.z;
    } else { pos.y += next.h / 2; }
    const m = mkBox(next); m.position.copy(pos); scene.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa posicionada!', 1500, true);
  }
  next = genBox(); refreshPreview(); updHUD();
}

function undoBox() {
  if (!boxes.length) return;
  const l = boxes.pop(); l.mesh.parent?.remove(l.mesh); l.mesh.geometry.dispose();
  toast('Removida!', 1200, true); updHUD();
}

function resetAll() {
  boxes.forEach(b => { b.mesh.parent?.remove(b.mesh); b.mesh.geometry.dispose(); });
  boxes = []; truckPlaced = false;
  if (mode === 'picking') {
    if (isSim) { truckGrp.position.set(0, 0, -2); truckPlaced = true; }
    else { truckGrp.visible = false; }
  }
  next = genBox(); refreshPreview(); updHUD(); toast('Resetado!', 1200, true);
}

function toggleMode() {
  mode = mode === 'cubagem' ? 'picking' : 'cubagem';
  if (mode === 'picking') {
    if (isSim) { truckGrp.visible = true; if (!truckPlaced) { truckGrp.position.set(0, 0, -2); truckPlaced = true; } toast('Picking - cacamba ativa!', 2500, true); }
    else {
      if (truckPlaced) { truckGrp.visible = true; toast('Picking!', 2000, true); }
      else { $('tap-hint').classList.add('active'); toast('Aponte pro chao e toque COLOCAR para posicionar a cacamba', 3500, true); }
    }
  } else { truckGrp.visible = false; $('tap-hint').classList.remove('active'); toast('Cubagem', 1500, true); }
  updHUD();
}

$('btn-place').onclick = placeBox;
$('btn-undo').onclick = undoBox;
$('btn-reset').onclick = resetAll;
$('mode-toggle').onclick = toggleMode;

function enterHUD(sim) {
  $('overlay').classList.add('hidden');
  $('hud').classList.add('active');
  $('crosshair').classList.toggle('active', true);
  $('legend').classList.add('active');
  $('sim-badge').classList.toggle('active', sim);
  updHUD();
}

async function initAR() {
  if (!navigator.xr) { $('ar-status').textContent = 'WebXR indisponivel.'; return; }
  const cfgs = [
    { req: ['hit-test'], opt: ['local-floor', 'dom-overlay'], ov: true },
    { req: ['hit-test'], opt: ['local-floor'], ov: false },
    { req: ['hit-test'], opt: [], ov: false },
    { req: [], opt: ['hit-test', 'local-floor'], ov: false },
  ];
  let session = null;
  for (const c of cfgs) {
    try {
      const opts = { requiredFeatures: c.req, optionalFeatures: c.opt };
      if (c.ov) opts.domOverlay = { root: document.body };
      session = await navigator.xr.requestSession('immersive-ar', opts);
      break;
    } catch (e) { continue; }
  }
  if (!session) { $('ar-status').textContent = 'AR nao suportado. Instale Google Play Services for AR.'; return; }
  xrSession = session;
  session.addEventListener('end', () => {
    xrSession = null; htSource = null;
    $('overlay').classList.remove('hidden');
    $('hud').classList.remove('active');
    $('crosshair').classList.remove('active');
    $('legend').classList.remove('active');
    $('sim-badge').classList.remove('active');
    $('tap-hint').classList.remove('active');
  });
  let refSpace;
  try { refSpace = await session.requestReferenceSpace('local-floor'); }
  catch { try { refSpace = await session.requestReferenceSpace('local'); } catch { refSpace = await session.requestReferenceSpace('viewer'); } }
  arRefSpace = refSpace;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  try {
    const vs = await session.requestReferenceSpace('viewer');
    htSource = await session.requestHitTestSource({ space: vs });
  } catch (e) { console.warn('No hit-test:', e); }
  session.addEventListener('select', () => { placeBox(); });
  enterHUD(false);
  renderer.setAnimationLoop((t, f) => renderAR(t, f, refSpace));
}

function initSim() {
  isSim = true; enterHUD(true);
  simFloor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: .95 }));
  simFloor.rotation.x = -Math.PI / 2; scene.add(simFloor);
  const grid = new THREE.GridHelper(24, 48, 0xff2d87, 0x3a0f28);
  grid.position.y = .005; grid.material.transparent = true; grid.material.opacity = .35; scene.add(grid);
  truckGrp.position.set(0, 0, -2);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .5, 0); controls.enableDamping = true; controls.dampingFactor = .08;
  controls.maxPolarAngle = Math.PI / 2.05; controls.minDistance = 1; controls.maxDistance = 20; controls.update();
  scene.background = new THREE.Color(0x1a0a12); scene.fog = new THREE.Fog(0x1a0a12, 10, 26);
  renderer.setAnimationLoop(renderSim);
}

function renderAR(time, frame, refSpace) {
  if (!frame) return;
  if (htSource) {
    const hits = frame.getHitTestResults(htSource);
    if (hits.length) {
      const pose = hits[0].getPose(refSpace);
      if (pose) {
        reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); reticleOk = true;
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        reticle.matrix.decompose(p, q, s);
        preview.visible = true; preview.position.set(p.x, p.y + next.h / 2, p.z);
      }
    } else { reticle.visible = false; preview.visible = false; reticleOk = false; }
  }
  reticle.material.opacity = .6 + .25 * Math.sin(time * .003);
  renderer.render(scene, camera);
}

function renderSim() {
  controls.update();
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), camera);
  if (mode === 'picking' && truckGrp.visible) {
    const h = rc.intersectObjects(truckGrp.children, true);
    if (h.length) { const lp = truckGrp.worldToLocal(h[0].point.clone()); preview.visible = true; preview.position.copy(truckGrp.localToWorld(new THREE.Vector3(lp.x, next.h / 2, lp.z))); }
    else preview.visible = false;
  } else if (simFloor) {
    const h = rc.intersectObject(simFloor);
    if (h.length) { preview.visible = true; preview.position.set(h[0].point.x, h[0].point.y + next.h / 2, h[0].point.z); }
    else preview.visible = false;
  }
  renderer.render(scene, camera);
}

$('start-ar').onclick = initAR;
$('start-sim').onclick = initSim;

(async () => {
  if (!navigator.xr) { $('ar-status').textContent = 'WebXR nao disponivel - use Modo Simulacao.'; $('start-ar').disabled = true; return; }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) { $('ar-status').textContent = 'AR nao suportado - use Modo Simulacao.'; $('start-ar').disabled = true; }
})();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
