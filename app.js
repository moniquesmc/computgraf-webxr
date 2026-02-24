import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── Config ── */
const TX = 0.012, TY = 0.004;
const CMAP = { red: 0xe53935, green: 0x43a047, blue: 0x1e88e5 };
const TRUCK = { w: 0.60, h: 0.35, d: 1.00 };
const BOX_W = [0.04, 0.14], BOX_H = [0.03, 0.10], BOX_D = [0.04, 0.14];

let mode = 'cubagem', isSim = false, boxes = [], next = genBox();
let xrSession = null, htSource = null, truckPlaced = false;
let controls = null, simFloor = null;

/* ── Hit state ── */
let hitActive = false;
let hitPosition = new THREE.Vector3();
let hitMatrix = new THREE.Matrix4();
let hitTimestamp = 0;
const HIT_GRACE = 2000;

/* ── AR ref spaces ── */
let arRefSpace = null;
let viewerSpace = null;

/* ── Debug ── */
let debugEl = null;
let hitCount = 0;

const $ = id => document.getElementById(id);

/* ═══════════  Scene  ═══════════ */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 80);
camera.position.set(0, 1.5, 2.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dl = new THREE.DirectionalLight(0xffffff, 1.5);
dl.position.set(3, 8, 5); scene.add(dl);
scene.add(new THREE.PointLight(0xff69b4, 0.5, 10));

/* ── Reticle ── */
const reticle = new THREE.Group();
const ringGeo = new THREE.RingGeometry(0.06, 0.09, 32).rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
const ring = new THREE.Mesh(ringGeo, ringMat);
const dot = new THREE.Mesh(
  new THREE.CircleGeometry(0.012, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x00ff44, side: THREE.DoubleSide })
);
reticle.add(ring, dot);
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

/* ── Ground plane invisível (fallback) ── */
const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
);
groundPlane.position.y = 0;
groundPlane.visible = false;
scene.add(groundPlane);

let preview = mkBox(next, true); preview.visible = false; scene.add(preview);

const truckGrp = new THREE.Group(); truckGrp.visible = false; scene.add(truckGrp);
buildTruck();

/* ═══════════  Helpers  ═══════════ */
function rnd(a, b) { return +(Math.random() * (b - a) + a).toFixed(3); }

function genBox() {
  const w = rnd(...BOX_W), h = rnd(...BOX_H), d = rnd(...BOX_D), v = w * h * d;
  return { w, h, d, v, color: v > TX ? 'red' : v > TY ? 'green' : 'blue' };
}

function mkBox(b, ghost = false) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  const m = new THREE.MeshStandardMaterial({
    color: CMAP[b.color], transparent: true,
    opacity: ghost ? 0.3 : 0.9, roughness: 0.4, metalness: 0.05
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g),
    new THREE.LineBasicMaterial({ color: ghost ? 0xff69b4 : 0x111111 })));
  return mesh;
}

function canStack(t, b) {
  return t === b || (t === 'blue' && (b === 'green' || b === 'red')) || (t === 'green' && b === 'red');
}

function findTop(x, z, list) {
  let best = null, by = 0;
  for (const b of list) {
    const p = b.mesh.position;
    if (Math.abs(p.x - x) < 0.07 && Math.abs(p.z - z) < 0.07) {
      const t = p.y + b.h / 2;
      if (t > by) { by = t; best = b; }
    }
  }
  return best;
}

/* ═══════════  Truck  ═══════════ */
function buildTruck() {
  while (truckGrp.children.length) truckGrp.remove(truckGrp.children[0]);
  const { w: tw, h: th, d: td } = TRUCK;
  const wm = () => new THREE.MeshStandardMaterial({
    color: 0xff69b4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, roughness: 0.8, depthWrite: false
  });
  const fl = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.01, td), wm());
  fl.material.opacity = 0.3; fl.material.color.set(0xff2d87); truckGrp.add(fl);
  const t = 0.01;
  [[-tw/2, th/2, 0, t, th, td], [tw/2, th/2, 0, t, th, td], [0, th/2, -td/2, tw, th, t]].forEach(([x,y,z,w,h,d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wm());
    wall.position.set(x, y, z); truckGrp.add(wall);
  });
  const eg = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td)),
    new THREE.LineBasicMaterial({ color: 0xff2d87 }));
  eg.position.y = th / 2; truckGrp.add(eg);
  const g = new THREE.GridHelper(Math.max(tw, td), 8, 0xff69b4, 0x4a1042);
  g.position.y = 0.006; g.material.transparent = true; g.material.opacity = 0.3; truckGrp.add(g);
  const sg = new THREE.SphereGeometry(0.01, 8, 8), sm = new THREE.MeshBasicMaterial({ color: 0xff2d87 });
  [[-tw/2,0,-td/2],[tw/2,0,-td/2],[-tw/2,0,td/2],[tw/2,0,td/2],
   [-tw/2,th,-td/2],[tw/2,th,-td/2],[-tw/2,th,td/2],[tw/2,th,td/2]
  ].forEach(p => { const s = new THREE.Mesh(sg, sm); s.position.set(...p); truckGrp.add(s); });
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const cx = cv.getContext('2d');
  cx.font = 'bold 52px sans-serif'; cx.fillStyle = '#ff2d87'; cx.textAlign = 'center'; cx.fillText('CAÇAMBA', 256, 78);
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  lbl.position.set(0, th + 0.06, 0); lbl.rotation.x = -0.1; truckGrp.add(lbl);
}

function insideTruck(p, b) {
  const hw = TRUCK.w / 2, hd = TRUCK.d / 2;
  return !(p.x - b.w/2 < -hw || p.x + b.w/2 > hw || p.z - b.d/2 < -hd || p.z + b.d/2 > hd || p.y + b.h/2 > TRUCK.h);
}

/* ═══════════  UI  ═══════════ */
let tt;
function toast(msg, ms = 2500, ok = false) {
  const el = $('toast');
  el.textContent = msg; el.className = 'show ' + (ok ? 'success' : 'error');
  clearTimeout(tt); tt = setTimeout(() => el.className = '', ms);
}

function updHUD() {
  const mn = mode === 'cubagem' ? 'Cubagem' : 'Picking';
  $('hud-mode').innerHTML = 'Modo: <b>' + mn + '</b>';
  $('hud-count').innerHTML = 'Caixas: <b>' + boxes.length + '</b>';
  $('hud-next').innerHTML = 'Próxima: <b>' + { red:'Vermelha', green:'Verde', blue:'Azul' }[next.color] + '</b>';
  $('hud-vol').innerHTML = 'Vol: <b>' + (next.v * 1e6).toFixed(0) + ' cm³</b>';
  $('mode-toggle').textContent = '🔄 ' + mn;
}

function refreshPreview() {
  scene.remove(preview); preview.geometry?.dispose();
  preview = mkBox(next, true); preview.visible = false; scene.add(preview);
}

function dbg(msg) {
  if (!debugEl) {
    debugEl = document.createElement('div');
    debugEl.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#0f0;font:bold 11px monospace;padding:6px 14px;border-radius:8px;z-index:9999;pointer-events:none;white-space:pre;max-width:90vw;text-align:left;';
    document.body.appendChild(debugEl);
  }
  debugEl.textContent = msg;
}

/* ═══════════  Get position  ═══════════ */
function getPos() {
  if (isSim) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    if (mode === 'picking' && truckGrp.visible) {
      const h = rc.intersectObjects(truckGrp.children, true);
      if (h.length) return { ok: true, pos: h[0].point.clone(), local: truckGrp.worldToLocal(h[0].point.clone()) };
      return { ok: false };
    }
    const h = rc.intersectObject(simFloor);
    return h.length ? { ok: true, pos: h[0].point.clone() } : { ok: false };
  }

  /* AR — hit test ativo */
  if (hitActive) return { ok: true, pos: hitPosition.clone() };

  /* AR — cache recente */
  if (hitTimestamp > 0 && (performance.now() - hitTimestamp < HIT_GRACE)) {
    return { ok: true, pos: hitPosition.clone(), cached: true };
  }

  /* AR — fallback: raycast contra plano y=0 usando câmera XR */
  const xrCam = renderer.xr.getCamera();
  if (xrCam && xrCam.position.lengthSq() > 0) {
    const rc = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -0.5).applyQuaternion(xrCam.quaternion).normalize();
    rc.set(xrCam.position, dir);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    const hit = rc.ray.intersectPlane(plane, target);
    if (hit) {
      return { ok: true, pos: target, fallback: true };
    }

    const fwd = xrCam.position.clone().add(
      new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.quaternion)
    );
    fwd.y = 0;
    return { ok: true, pos: fwd, fallback: true };
  }

  return { ok: false };
}

/* ═══════════  Actions  ═══════════ */
function placeBox() {
  const r = getPos();
  if (!r.ok) {
    toast('Mova o celular devagar — mapeando ambiente...');
    return;
  }
  if (r.fallback) toast('Posição estimada (sem hit test)', 1500);
  if (r.cached) toast('Usando última posição válida', 1200);

  const pos = r.pos;

  if (mode === 'picking') {
    if (!isSim && !truckPlaced) {
      truckGrp.position.copy(pos);
      truckGrp.visible = true; truckPlaced = true;
      $('tap-hint').classList.remove('active');
      toast('Caçamba posicionada!', 3000, true); updHUD(); return;
    }
    const lp = r.local ? r.local.clone() : truckGrp.worldToLocal(pos.clone());
    const st = findTop(lp.x, lp.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) { toast('NÃO PODE empilhar assim!'); return; }
      lp.y = st.mesh.position.y + st.h / 2 + next.h / 2; lp.x = st.mesh.position.x; lp.z = st.mesh.position.z;
    } else lp.y = next.h / 2;
    if (!insideTruck(lp, next)) { toast('Fora da caçamba!'); return; }
    const m = mkBox(next); m.position.copy(lp); truckGrp.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa na caçamba!', 1500, true);
  } else {
    const st = findTop(pos.x, pos.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) { toast('NÃO PODE empilhar assim!'); return; }
      pos.y = st.mesh.position.y + st.h / 2 + next.h / 2; pos.x = st.mesh.position.x; pos.z = st.mesh.position.z;
    } else pos.y += next.h / 2;
    const m = mkBox(next); m.position.copy(pos); scene.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa posicionada!', 1500, true);
  }
  next = genBox(); refreshPreview(); updHUD();
}

function undoBox() {
  if (!boxes.length) return;
  const b = boxes.pop(); b.mesh.parent?.remove(b.mesh); b.mesh.geometry?.dispose();
  toast('Removida!', 1200, true); updHUD();
}

function resetAll() {
  boxes.forEach(b => { b.mesh.parent?.remove(b.mesh); b.mesh.geometry?.dispose(); });
  boxes = []; truckPlaced = false;
  if (mode === 'picking') {
    if (isSim) { truckGrp.position.set(0, 0, -0.8); truckPlaced = true; }
    else truckGrp.visible = false;
  }
  next = genBox(); refreshPreview(); updHUD(); toast('Resetado!', 1200, true);
}

function toggleMode() {
  mode = mode === 'cubagem' ? 'picking' : 'cubagem';
  if (mode === 'picking') {
    if (isSim) { truckGrp.visible = true; if (!truckPlaced) { truckGrp.position.set(0, 0, -0.8); truckPlaced = true; } toast('Picking!', 2500, true); }
    else { if (truckPlaced) { truckGrp.visible = true; toast('Picking!', 2000, true); } else { $('tap-hint').classList.add('active'); toast('Toque COLOCAR para posicionar caçamba', 3500, true); } }
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
  $('crosshair').classList.add('active');
  $('legend').classList.add('active');
  $('sim-badge').classList.toggle('active', sim);
  updHUD();
}

/* ═══════════════════  AR  ═══════════════════ */
async function initAR() {
  if (!navigator.xr) { $('ar-status').textContent = 'WebXR indisponível.'; return; }

  let session = null;
  const attempts = [
    { req: ['hit-test'], opt: ['local-floor', 'dom-overlay'], ov: true },
    { req: ['hit-test'], opt: ['dom-overlay'], ov: true },
    { req: ['hit-test'], opt: ['local-floor'], ov: false },
    { req: ['hit-test'], opt: [], ov: false },
    { req: [], opt: ['hit-test', 'local-floor'], ov: false },
    { req: [], opt: ['hit-test'], ov: false },
    { req: [], opt: [], ov: false },
  ];
  let usedCfg = null;
  for (const cfg of attempts) {
    try {
      const o = { requiredFeatures: cfg.req, optionalFeatures: cfg.opt };
      if (cfg.ov) o.domOverlay = { root: document.body };
      session = await navigator.xr.requestSession('immersive-ar', o);
      usedCfg = cfg;
      break;
    } catch { continue; }
  }
  if (!session) { $('ar-status').textContent = 'AR não suportado.'; return; }
  xrSession = session;

  session.addEventListener('end', () => {
    xrSession = null; htSource = null; hitActive = false; hitTimestamp = 0;
    if (debugEl) debugEl.remove(); debugEl = null;
    $('overlay').classList.remove('hidden');
    $('hud').classList.remove('active');
    $('crosshair').classList.remove('active');
    $('legend').classList.remove('active');
    $('sim-badge').classList.remove('active');
    $('tap-hint').classList.remove('active');
  });

  /* ── Reference space ── */
  arRefSpace = null;
  let rsType = '?';
  for (const t of ['local-floor', 'local', 'viewer']) {
    try { arRefSpace = await session.requestReferenceSpace(t); rsType = t; break; } catch { continue; }
  }

  /* Setar tipo no renderer ANTES de setSession */
  try { renderer.xr.setReferenceSpaceType(rsType === 'local-floor' ? 'local-floor' : 'local'); } catch {}
  await renderer.xr.setSession(session);

  /* ── Hit test source ── */
  let htOk = false;
  try {
    viewerSpace = await session.requestReferenceSpace('viewer');
    htSource = await session.requestHitTestSource({ space: viewerSpace });
    htOk = !!htSource;
    htSource?.addEventListener?.('cancel', () => { htSource = null; });
  } catch (e) {
    console.warn('Hit test falhou:', e);
  }

  /* ── Select event ── */
  session.addEventListener('select', () => placeBox());

  enterHUD(false);
  dbg('AR init OK\nRefSpace: ' + rsType + '\nHitTest: ' + htOk + '\nCfg: req=' + JSON.stringify(usedCfg?.req));

  /* ═══════════  RENDER LOOP AR  ═══════════ */
  renderer.setAnimationLoop((timestamp, frame) => {
    if (!frame) return;

    const rs = renderer.xr.getReferenceSpace() || arRefSpace;

    let htResults = null;
    let htPose = null;
    let htError = '';

    /* ── Processar hit test ── */
    if (htSource && rs) {
      try {
        htResults = frame.getHitTestResults(htSource);
      } catch (e) {
        htError = 'getResults err: ' + e.message;
      }

      if (htResults && htResults.length > 0) {
        try {
          htPose = htResults[0].getPose(rs);
        } catch (e) {
          htError = 'getPose err: ' + e.message;
        }

        if (htPose) {
          hitActive = true;
          hitCount++;

          reticle.visible = true;
          reticle.matrix.fromArray(htPose.transform.matrix);

          const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          reticle.matrix.decompose(p, q, s);
          hitPosition.copy(p);
          hitMatrix.copy(reticle.matrix);
          hitTimestamp = performance.now();

          preview.visible = true;
          preview.position.set(p.x, p.y + next.h / 2, p.z);

          ring.material.color.setHex(0x00ff88);
          dot.material.color.setHex(0x00ff44);
        }
      } else {
        hitActive = false;

        if (hitTimestamp > 0 && (performance.now() - hitTimestamp < HIT_GRACE)) {
          reticle.visible = true;
          reticle.matrix.copy(hitMatrix);
          const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          hitMatrix.decompose(p, q, s);
          preview.visible = true;
          preview.position.set(p.x, p.y + next.h / 2, p.z);
          ring.material.color.setHex(0xffaa00);
          dot.material.color.setHex(0xff8800);
        } else {
          reticle.visible = false;
          preview.visible = false;
          ring.material.color.setHex(0xff0044);
          dot.material.color.setHex(0xff0000);
        }
      }
    } else {
      hitActive = false;
      reticle.visible = false;

      const xrCam = renderer.xr.getCamera();
      if (xrCam) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.quaternion);
        const fwd = xrCam.position.clone().add(dir.multiplyScalar(0.7));
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        const ray = new THREE.Ray(xrCam.position, dir);
        if (ray.intersectPlane(plane, target)) {
          preview.visible = true;
          preview.position.set(target.x, target.y + next.h / 2, target.z);
        } else {
          fwd.y = 0;
          preview.visible = true;
          preview.position.set(fwd.x, fwd.y + next.h / 2, fwd.z);
        }
      }
    }

    /* Pulsar */
    if (reticle.visible) {
      ring.material.opacity = 0.5 + 0.4 * Math.sin(timestamp * 0.004);
    }

    /* Debug overlay */
    const xrCam = renderer.xr.getCamera();
    const camPos = xrCam ? `${xrCam.position.x.toFixed(2)}, ${xrCam.position.y.toFixed(2)}, ${xrCam.position.z.toFixed(2)}` : 'N/A';
    dbg(
      `HitSrc: ${htSource ? 'OK' : 'NULL'} | RS: ${rs ? 'OK' : 'NULL'}\n` +
      `Results: ${htResults ? htResults.length : 'null'} | Pose: ${htPose ? 'OK' : 'null'}\n` +
      `Hits total: ${hitCount} | Active: ${hitActive}\n` +
      `Pos: ${hitPosition.x.toFixed(2)}, ${hitPosition.y.toFixed(2)}, ${hitPosition.z.toFixed(2)}\n` +
      `Cam: ${camPos}\n` +
      (htError ? `ERR: ${htError}\n` : '') +
      `T: ${(timestamp/1000).toFixed(1)}s`
    );

    renderer.render(scene, camera);
  });
}

/* ═══════════════════  SIM  ═══════════════════ */
function initSim() {
  isSim = true; enterHUD(true);
  simFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: 0.95 }));
  simFloor.rotation.x = -Math.PI / 2; scene.add(simFloor);
  const grid = new THREE.GridHelper(10, 20, 0xff2d87, 0x3a0f28);
  grid.position.y = 0.003; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  truckGrp.position.set(0, 0, -0.8);
  camera.position.set(0, 1.0, 1.6);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.15, -0.4); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05; controls.minDistance = 0.4; controls.maxDistance = 6; controls.update();
  scene.background = new THREE.Color(0x1a0a12); scene.fog = new THREE.Fog(0x1a0a12, 4, 12);
  renderer.setAnimationLoop(() => {
    controls.update();
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    if (mode === 'picking' && truckGrp.visible) {
      const h = rc.intersectObjects(truckGrp.children, true);
      if (h.length) { preview.visible = true; const lp = truckGrp.worldToLocal(h[0].point.clone()); preview.position.copy(truckGrp.localToWorld(new THREE.Vector3(lp.x, next.h / 2, lp.z))); }
      else preview.visible = false;
    } else if (simFloor) {
      const h = rc.intersectObject(simFloor);
      if (h.length) { preview.visible = true; preview.position.set(h[0].point.x, h[0].point.y + next.h / 2, h[0].point.z); }
      else preview.visible = false;
    }
    renderer.render(scene, camera);
  });
}

$('start-ar').onclick = initAR;
$('start-sim').onclick = initSim;

(async () => {
  if (!navigator.xr) { $('ar-status').textContent = 'WebXR indisponível — use Modo Simulação.'; $('start-ar').disabled = true; return; }
  try { if (!await navigator.xr.isSessionSupported('immersive-ar')) throw 0; } catch { $('ar-status').textContent = 'AR não suportado — use Modo Simulação.'; $('start-ar').disabled = true; }
})();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
