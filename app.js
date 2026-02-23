
// ================================================================
//  Cubagem & Picking WebXR  —  Three.js + WebXR Device API
//  Com fallback "Modo Simulação" para desktop / dispositivos sem AR
// ================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ----------------------------------------------------------------
//  Limiares de volume (m³)
// ----------------------------------------------------------------
const THRESH_X = 0.012;  // V > X  → Vermelho
const THRESH_Y = 0.004;  // V < Y  → Azul;  entre → Verde

const COLOR_MAP = {
  red:   new THREE.Color(0xe53935),
  green: new THREE.Color(0x43a047),
  blue:  new THREE.Color(0x1e88e5),
};

const TRUCK = { w: 2.4, h: 1.5, d: 6.0 };

// ----------------------------------------------------------------
//  Estado
// ----------------------------------------------------------------
let appMode      = 'cubagem';   // 'cubagem' | 'picking'
let isSimulation = false;
let placedBoxes  = [];
let nextBox      = genBox();
let reticleHit   = false;

// WebXR
let xrSession     = null;
let hitTestSource = null;

// ----------------------------------------------------------------
//  DOM
// ----------------------------------------------------------------
const $ = id => document.getElementById(id);
const overlay   = $('overlay');
const startAR   = $('start-ar');
const startSim  = $('start-sim');
const arStatus  = $('ar-status');
const hud       = $('hud');
const hudMode   = $('hud-mode');
const hudCount  = $('hud-count');
const hudNext   = $('hud-next');
const hudVol    = $('hud-vol');
const modeBtn   = $('mode-toggle');
const btnPlace  = $('btn-place');
const btnUndo   = $('btn-undo');
const btnReset  = $('btn-reset');
const crosshair = $('crosshair');
const toastEl   = $('toast');
const legend    = $('legend');
const simBadge  = $('sim-badge');

// ----------------------------------------------------------------
//  Three.js core
// ----------------------------------------------------------------
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 80);
camera.position.set(0, 2.5, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace   = THREE.SRGBColorSpace;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// Orbit (somente simulação)
let controls = null;

// Luzes
scene.add(new THREE.AmbientLight(0xffc0cb, 0.65));
const dLight = new THREE.DirectionalLight(0xffffff, 1.5);
dLight.position.set(4, 6, 4);
scene.add(dLight);
scene.add(new THREE.PointLight(0xff69b4, 0.6, 15));

// ---- Reticle (anel rosa) ----
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.11, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff69b4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

// ---- Preview ----
let preview = makeBoxMesh(nextBox, true);
preview.visible = false;
scene.add(preview);

// ---- Truck group ----
const truckGrp = new THREE.Group();
truckGrp.visible = false;
scene.add(truckGrp);
buildTruck();

// ---- Sim-mode floor ----
let simFloor = null;

// ================================================================
//  BOX helpers
// ================================================================
function genBox() {
  const w = +(Math.random() * 0.4 + 0.1).toFixed(2);
  const h = +(Math.random() * 0.3 + 0.05).toFixed(2);
  const d = +(Math.random() * 0.4 + 0.1).toFixed(2);
  const v = w * h * d;
  const color = v > THRESH_X ? 'red' : v > THRESH_Y ? 'green' : 'blue';
  return { w, h, d, v, color };
}

function makeBoxMesh(box, ghost = false) {
  const geo = new THREE.BoxGeometry(box.w, box.h, box.d);
  const mat = new THREE.MeshStandardMaterial({
    color: COLOR_MAP[box.color].clone(),
    transparent: true,
    opacity: ghost ? 0.38 : 0.9,
    roughness: 0.45,
    metalness: 0.08,
  });
  const m = new THREE.Mesh(geo, mat);
  m.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: ghost ? 0xff69b4 : 0x1a0a12 })
  ));
  return m;
}

// ================================================================
//  Stacking rules
// ================================================================
function canStack(top, bot) {
  if (top === bot) return true;
  if (top === 'blue'  && (bot === 'green' || bot === 'red')) return true;
  if (top === 'green' && bot === 'red') return true;
  return false;
}

function findTop(x, z, list) {
  let best = null, bestY = 0;
  for (const b of list) {
    const p = b.mesh.position;
    if (Math.abs(p.x - x) < 0.15 && Math.abs(p.z - z) < 0.15) {
      const t = p.y + b.h / 2;
      if (t > bestY) { bestY = t; best = b; }
    }
  }
  return best;
}

// ================================================================
//  Truck
// ================================================================
function buildTruck() {
  const { w: tw, h: th, d: td } = TRUCK;
  const wt = 0.03;
  const mk = (gw, gh, gd) => new THREE.Mesh(
    new THREE.BoxGeometry(gw, gh, gd),
    new THREE.MeshStandardMaterial({ color: 0xff69b4, transparent: true, opacity: 0.12, side: THREE.DoubleSide, roughness: 0.9 })
  );
  const fl = mk(tw, wt, td); fl.material.opacity = 0.2; truckGrp.add(fl);
  const wl = mk(wt, th, td); wl.position.set(-tw/2, th/2, 0); truckGrp.add(wl);
  const wr = mk(wt, th, td); wr.position.set( tw/2, th/2, 0); truckGrp.add(wr);
  const wb = mk(tw, th, wt); wb.position.set(0, th/2, -td/2); truckGrp.add(wb);
  const eg = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td)),
    new THREE.LineBasicMaterial({ color: 0xff2d87 })
  );
  eg.position.set(0, th/2, 0);
  truckGrp.add(eg);
  const g = new THREE.GridHelper(Math.max(tw, td), 12, 0xff69b4, 0x4a1042);
  g.position.y = 0.015; g.material.transparent = true; g.material.opacity = 0.3;
  truckGrp.add(g);
}

function insideTruck(p, b) {
  const hw = TRUCK.w/2, hd = TRUCK.d/2;
  return !(p.x - b.w/2 < -hw || p.x + b.w/2 > hw || p.z - b.d/2 < -hd || p.z + b.d/2 > hd || p.y + b.h/2 > TRUCK.h);
}

// ================================================================
//  UI helpers
// ================================================================
let toastTmr;
function toast(msg, ms = 2500, ok = false) {
  toastEl.textContent = msg;
  toastEl.className = 'show ' + (ok ? 'success' : 'error');
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => toastEl.className = '', ms);
}

function updHUD() {
  const mn = appMode === 'cubagem' ? 'Cubagem' : 'Picking';
  hudMode.innerHTML  = 'Modo: <b>' + mn + '</b>';
  hudCount.innerHTML = 'Caixas: <b>' + placedBoxes.length + '</b>';
  const cl = { red: '🔴 Vermelha', green: '🟢 Verde', blue: '🔵 Azul' }[nextBox.color];
  hudNext.innerHTML  = 'Próxima: <b>' + cl + '</b>';
  hudVol.innerHTML   = 'Vol: <b>' + (nextBox.v * 1e6).toFixed(0) + ' cm³</b> (' +
                        nextBox.w.toFixed(2) + '×' + nextBox.h.toFixed(2) + '×' + nextBox.d.toFixed(2) + 'm)';
  modeBtn.textContent = '🔄 ' + mn;
}

function refreshPreview() {
  scene.remove(preview);
  preview.geometry.dispose();
  preview = makeBoxMesh(nextBox, true);
  preview.visible = false;
  scene.add(preview);
}

// ================================================================
//  PLACE / UNDO / RESET
// ================================================================
function placeBox() {
  if (!isSimulation && !reticleHit) { toast('📍 Aponte para uma superfície!'); return; }

  const pos = new THREE.Vector3();

  if (isSimulation) {
    // Raycaster no centro da tela
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);

    if (appMode === 'picking') {
      const hits = rc.intersectObjects(truckGrp.children, true);
      if (hits.length) {
        pos.copy(truckGrp.worldToLocal(hits[0].point.clone()));
      } else {
        pos.set((Math.random()-0.5)*1.5, 0, (Math.random()-0.5)*4);
      }
    } else {
      const hits = rc.intersectObject(simFloor);
      if (hits.length) pos.copy(hits[0].point);
      else { pos.set((Math.random()-0.5)*2, 0, (Math.random()-0.5)*2); }
    }
  } else {
    // AR – posição do reticle
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    reticle.matrix.decompose(pos, q, s);
  }

  if (appMode === 'picking') {
    const lp = isSimulation ? pos.clone() : truckGrp.worldToLocal(pos.clone());
    const st = findTop(lp.x, lp.z, placedBoxes);
    if (st) {
      if (!canStack(nextBox.color, st.color)) { toast('❌ ' + nextBox.color + ' não empilha sobre ' + st.color + '!'); return; }
      lp.y = st.mesh.position.y + st.h/2 + nextBox.h/2;
      lp.x = st.mesh.position.x; lp.z = st.mesh.position.z;
    } else { lp.y = nextBox.h/2; }
    if (!insideTruck(lp, nextBox)) { toast('❌ Caixa fora da caçamba!'); return; }
    const m = makeBoxMesh(nextBox); m.position.copy(lp); truckGrp.add(m);
    placedBoxes.push({ mesh: m, color: nextBox.color, v: nextBox.v, w: nextBox.w, h: nextBox.h, d: nextBox.d });
    toast('✅ Caixa na caçamba!', 1500, true);
  } else {
    const st = findTop(pos.x, pos.z, placedBoxes);
    if (st) {
      if (!canStack(nextBox.color, st.color)) { toast('❌ ' + nextBox.color + ' não empilha sobre ' + st.color + '!'); return; }
      pos.y = st.mesh.position.y + st.h/2 + nextBox.h/2;
      pos.x = st.mesh.position.x; pos.z = st.mesh.position.z;
    } else { pos.y += nextBox.h/2; }
    const m = makeBoxMesh(nextBox); m.position.copy(pos); scene.add(m);
    placedBoxes.push({ mesh: m, color: nextBox.color, v: nextBox.v, w: nextBox.w, h: nextBox.h, d: nextBox.d });
    toast('✅ Caixa posicionada!', 1500, true);
  }

  nextBox = genBox();
  refreshPreview();
  updHUD();
}

function undoBox() {
  if (!placedBoxes.length) return;
  const l = placedBoxes.pop();
  l.mesh.parent?.remove(l.mesh);
  l.mesh.geometry.dispose();
  toast('↩ Removida!', 1200, true);
  updHUD();
}

function resetAll() {
  placedBoxes.forEach(b => { b.mesh.parent?.remove(b.mesh); b.mesh.geometry.dispose(); });
  placedBoxes = [];
  nextBox = genBox();
  refreshPreview();
  updHUD();
  toast('✨ Resetado!', 1200, true);
}

function toggleMode() {
  appMode = appMode === 'cubagem' ? 'picking' : 'cubagem';
  truckGrp.visible = appMode === 'picking';
  updHUD();
  if (appMode === 'picking') toast('🚛 Modo Picking — caçamba ativa', 2000, true);
  else toast('📐 Modo Cubagem', 1500, true);
}

// Events
btnPlace.onclick = placeBox;
btnUndo.onclick  = undoBox;
btnReset.onclick = resetAll;
modeBtn.onclick  = toggleMode;

// ================================================================
//  START — AR
// ================================================================
async function initAR() {
  if (!navigator.xr) { arStatus.textContent = '⚠️ WebXR não disponível.'; return; }

  // Tentar várias configs
  const configs = [
    { required: ['hit-test', 'local-floor'], optional: ['dom-overlay'] },
    { required: ['hit-test'], optional: ['local-floor', 'dom-overlay'] },
    { required: ['hit-test'], optional: ['dom-overlay'] },
  ];

  let session = null;
  for (const cfg of configs) {
    try {
      const opts = {
        requiredFeatures: cfg.required,
        optionalFeatures: cfg.optional,
        domOverlay: { root: document.body }
      };
      session = await navigator.xr.requestSession('immersive-ar', opts);
      break;
    } catch(e) { continue; }
  }

  if (!session) {
    arStatus.textContent = '❌ Nenhuma configuração AR suportada. Use o Modo Simulação.';
    return;
  }

  xrSession = session;
  session.addEventListener('end', onXREnd);

  // Determinar reference space
  let refSpace;
  try { refSpace = await session.requestReferenceSpace('local-floor'); renderer.xr.setReferenceSpaceType('local-floor'); }
  catch(e) { refSpace = await session.requestReferenceSpace('local'); renderer.xr.setReferenceSpaceType('local'); }

  await renderer.xr.setSession(session);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  enterHUD(false);
  renderer.setAnimationLoop((t, f) => renderAR(t, f, refSpace));
}

function onXREnd() {
  xrSession = null; hitTestSource = null;
  overlay.classList.remove('hidden');
  hud.classList.remove('active');
  crosshair.classList.remove('active');
  legend.classList.remove('active');
}

// ================================================================
//  START — SIMULATION
// ================================================================
function initSim() {
  isSimulation = true;
  enterHUD(true);

  // Chão rosa
  const floorGeo = new THREE.PlaneGeometry(20, 20);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: 0.95 });
  simFloor = new THREE.Mesh(floorGeo, floorMat);
  simFloor.rotation.x = -Math.PI / 2;
  simFloor.position.y = 0;
  scene.add(simFloor);

  // Grid
  const grid = new THREE.GridHelper(20, 40, 0xff2d87, 0x3a0f28);
  grid.position.y = 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // Truck posicionado
  truckGrp.position.set(3, 0, 0);
  truckGrp.visible = false; // só no modo picking

  // Orbit controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 1;
  controls.maxDistance = 20;
  controls.update();

  // Background
  scene.background = new THREE.Color(0x1a0a12);
  scene.fog = new THREE.Fog(0x1a0a12, 8, 22);

  // Render loop
  renderer.setAnimationLoop(renderSim);
}

// ================================================================
//  Enter HUD
// ================================================================
function enterHUD(sim) {
  overlay.classList.add('hidden');
  hud.classList.add('active');
  crosshair.classList.toggle('active', !sim);
  legend.classList.add('active');
  simBadge.classList.toggle('active', sim);
  updHUD();
}

// ================================================================
//  RENDER — AR
// ================================================================
function renderAR(time, frame, refSpace) {
  if (!frame) return;
  if (hitTestSource) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length) {
      const pose = hits[0].getPose(refSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      reticleHit = true;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      reticle.matrix.decompose(p, q, s);
      preview.visible = true;
      preview.position.set(p.x, p.y + nextBox.h/2, p.z);
    } else {
      reticle.visible = false; preview.visible = false; reticleHit = false;
    }
  }
  reticle.material.opacity = 0.6 + 0.25 * Math.sin(time * 0.003);
  renderer.render(scene, camera);
}

// ================================================================
//  RENDER — SIMULATION
// ================================================================
function renderSim(time) {
  controls.update();

  // Raycaster para preview
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, 0), camera);

  if (appMode === 'picking' && truckGrp.visible) {
    const hits = rc.intersectObjects(truckGrp.children, true);
    if (hits.length) {
      const lp = truckGrp.worldToLocal(hits[0].point.clone());
      preview.visible = true;
      preview.position.copy(truckGrp.localToWorld(new THREE.Vector3(lp.x, nextBox.h/2, lp.z)));
    } else { preview.visible = false; }
  } else if (simFloor) {
    const hits = rc.intersectObject(simFloor);
    if (hits.length) {
      preview.visible = true;
      preview.position.set(hits[0].point.x, hits[0].point.y + nextBox.h/2, hits[0].point.z);
    } else { preview.visible = false; }
  }

  renderer.render(scene, camera);
}

// ================================================================
//  Buttons
// ================================================================
startAR.onclick  = initAR;
startSim.onclick = initSim;

// Suporte check
(async () => {
  if (!navigator.xr) {
    arStatus.textContent = '⚠️ WebXR não disponível — use o Modo Simulação abaixo.';
    startAR.disabled = true;
    return;
  }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) {
    arStatus.textContent = '⚠️ AR não suportado neste device — use o Modo Simulação.';
    startAR.disabled = true;
  }
})();

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
