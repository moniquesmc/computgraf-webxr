import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── Limiares de volume (m³) ── */
const TX = 0.012, TY = 0.004;
const CMAP = { red: 0xe53935, green: 0x43a047, blue: 0x1e88e5 };

/* ── Caçamba escala maquete ── */
const TRUCK = { w: 0.60, h: 0.35, d: 1.00 };

/* ── Caixas proporcionais ── */
const BOX_W = [0.04, 0.14];
const BOX_H = [0.03, 0.10];
const BOX_D = [0.04, 0.14];

let mode = 'cubagem', isSim = false, boxes = [], next = genBox();
let reticleHit = false, xrSession = null, htSource = null, truckPlaced = false;

/* ── Cache do último hit válido ── */
let lastHitMatrix = new THREE.Matrix4();
let lastHitValid = false;
let lastHitTimestamp = 0;
const HIT_GRACE_MS = 1500; // 1.5s de tolerância

const $ = id => document.getElementById(id);

/* ═══════════════  Cena, câmera, renderer  ═══════════════ */
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

let controls = null;

/* ── Luzes ── */
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dl = new THREE.DirectionalLight(0xffffff, 1.8);
dl.position.set(3, 8, 5);
dl.castShadow = false;
scene.add(dl);
const pl = new THREE.PointLight(0xff69b4, 0.5, 12);
pl.position.set(0, 2, 0);
scene.add(pl);

/* ── Reticle (indicador de superfície) ── */
const reticle = new THREE.Group();
const reticleRing = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.10, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff69b4, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
);
const reticleDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.015, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff2d87, side: THREE.DoubleSide })
);
reticle.add(reticleRing, reticleDot);
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

/* ── Preview ── */
let preview = mkBox(next, true);
preview.visible = false;
scene.add(preview);

/* ── Truck ── */
const truckGrp = new THREE.Group();
truckGrp.visible = false;
scene.add(truckGrp);
buildTruck();

let simFloor = null;

/* ═══════════════════  Funções de caixa  ═══════════════════ */
function rnd(min, max) { return +(Math.random() * (max - min) + min).toFixed(3); }

function genBox() {
  const w = rnd(...BOX_W), h = rnd(...BOX_H), d = rnd(...BOX_D);
  const v = w * h * d;
  return { w, h, d, v, color: v > TX ? 'red' : v > TY ? 'green' : 'blue' };
}

function mkBox(b, ghost = false) {
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mat = new THREE.MeshStandardMaterial({
    color: CMAP[b.color],
    transparent: true,
    opacity: ghost ? 0.3 : 0.9,
    roughness: 0.45,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: ghost ? 0xff69b4 : 0x111111 })
  ));
  return mesh;
}

function canStack(top, bot) {
  if (top === bot) return true;
  if (top === 'blue' && (bot === 'green' || bot === 'red')) return true;
  if (top === 'green' && bot === 'red') return true;
  return false;
}

function findTop(x, z, list) {
  let best = null, bestY = 0;
  for (const b of list) {
    const p = b.mesh.position;
    if (Math.abs(p.x - x) < 0.07 && Math.abs(p.z - z) < 0.07) {
      const top = p.y + b.h / 2;
      if (top > bestY) { bestY = top; best = b; }
    }
  }
  return best;
}

/* ═══════════════════  Caçamba  ═══════════════════ */
function buildTruck() {
  while (truckGrp.children.length) {
    const c = truckGrp.children[0];
    truckGrp.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
      else c.material.dispose();
    }
  }
  const { w: tw, h: th, d: td } = TRUCK;
  const wallMat = () => new THREE.MeshStandardMaterial({
    color: 0xff69b4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, roughness: 0.8, depthWrite: false
  });

  // Chão
  const floor = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.012, td), wallMat());
  floor.material.opacity = 0.3;
  floor.material.color.set(0xff2d87);
  truckGrp.add(floor);

  // Paredes
  const t = 0.012;
  const wl = new THREE.Mesh(new THREE.BoxGeometry(t, th, td), wallMat());
  wl.position.set(-tw/2, th/2, 0); truckGrp.add(wl);
  const wr = new THREE.Mesh(new THREE.BoxGeometry(t, th, td), wallMat());
  wr.position.set(tw/2, th/2, 0); truckGrp.add(wr);
  const wb = new THREE.Mesh(new THREE.BoxGeometry(tw, th, t), wallMat());
  wb.position.set(0, th/2, -td/2); truckGrp.add(wb);

  // Wireframe
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xff2d87 });
  const box = new THREE.BoxGeometry(tw, th, td);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), edgeMat);
  edges.position.set(0, th/2, 0); truckGrp.add(edges);

  // Glow
  const edgeMat2 = new THREE.LineBasicMaterial({ color: 0xff69b4, transparent: true, opacity: 0.35 });
  const box2 = new THREE.BoxGeometry(tw + 0.008, th + 0.008, td + 0.008);
  const edges2 = new THREE.LineSegments(new THREE.EdgesGeometry(box2), edgeMat2);
  edges2.position.set(0, th/2, 0); truckGrp.add(edges2);

  // Grid chão
  const grid = new THREE.GridHelper(Math.max(tw, td), 8, 0xff69b4, 0x4a1042);
  grid.position.y = 0.008; grid.material.transparent = true; grid.material.opacity = 0.35;
  truckGrp.add(grid);

  // Esferas decorativas nos cantos
  const sg = new THREE.SphereGeometry(0.01, 8, 8);
  const sm = new THREE.MeshBasicMaterial({ color: 0xff2d87 });
  [[-tw/2,0,-td/2],[tw/2,0,-td/2],[-tw/2,0,td/2],[tw/2,0,td/2],
   [-tw/2,th,-td/2],[tw/2,th,-td/2],[-tw/2,th,td/2],[tw/2,th,td/2]
  ].forEach(p => { const s = new THREE.Mesh(sg, sm); s.position.set(...p); truckGrp.add(s); });

  // Label
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const cx = cv.getContext('2d');
  cx.font = 'bold 52px Poppins, sans-serif';
  cx.fillStyle = '#ff2d87'; cx.textAlign = 'center';
  cx.fillText('CAÇAMBA', 256, 78);
  const tex = new THREE.CanvasTexture(cv);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(0.45, 0.11),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  lbl.position.set(0, th + 0.08, 0); lbl.rotation.x = -0.12;
  truckGrp.add(lbl);
}

function insideTruck(p, b) {
  const hw = TRUCK.w / 2, hd = TRUCK.d / 2;
  return !(
    p.x - b.w/2 < -hw || p.x + b.w/2 > hw ||
    p.z - b.d/2 < -hd || p.z + b.d/2 > hd ||
    p.y + b.h/2 > TRUCK.h
  );
}

/* ═══════════════════  UI helpers  ═══════════════════ */
let toastTimer;
function toast(msg, ms = 2500, ok = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show ' + (ok ? 'success' : 'error');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', ms);
}

function updHUD() {
  const mn = mode === 'cubagem' ? 'Cubagem' : 'Picking';
  $('hud-mode').innerHTML = 'Modo: <b>' + mn + '</b>';
  $('hud-count').innerHTML = 'Caixas: <b>' + boxes.length + '</b>';
  const names = { red: 'Vermelha', green: 'Verde', blue: 'Azul' };
  $('hud-next').innerHTML = 'Próxima: <b>' + names[next.color] + '</b>';
  $('hud-vol').innerHTML = 'Vol: <b>' + (next.v * 1e6).toFixed(0) + ' cm³</b>';
  $('mode-toggle').textContent = '🔄 ' + mn;
}

function refreshPreview() {
  scene.remove(preview);
  if (preview.geometry) preview.geometry.dispose();
  preview = mkBox(next, true);
  preview.visible = false;
  scene.add(preview);
}

/* ═══════════════════  Posição do hit  ═══════════════════ */
function getReticlePosition() {
  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  if (isSim) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    if (mode === 'picking' && truckGrp.visible) {
      const hits = rc.intersectObjects(truckGrp.children, true);
      if (hits.length) {
        return { ok: true, pos: hits[0].point.clone(), local: truckGrp.worldToLocal(hits[0].point.clone()) };
      }
      return { ok: false };
    }
    const hits = rc.intersectObject(simFloor);
    if (hits.length) return { ok: true, pos: hits[0].point.clone() };
    return { ok: false };
  }

  /* AR: reticle ativo */
  if (reticleHit) {
    reticle.matrix.decompose(pos, rot, scl);
    return { ok: true, pos };
  }

  /* AR: cache recente */
  if (lastHitValid && (performance.now() - lastHitTimestamp < HIT_GRACE_MS)) {
    lastHitMatrix.decompose(pos, rot, scl);
    return { ok: true, pos };
  }

  /* AR: fallback — coloca 1m à frente da câmera no chão estimado */
  const xrCam = renderer.xr.getCamera();
  if (xrCam) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.quaternion);
    pos.copy(xrCam.position).add(dir.multiplyScalar(0.8));
    pos.y = 0; // assume chão em y=0
    return { ok: true, pos, fallback: true };
  }

  return { ok: false };
}

/* ═══════════════════  Place / Undo / Reset  ═══════════════════ */
function placeBox() {
  const hit = getReticlePosition();
  if (!hit.ok) {
    toast('Mova o celular devagar para detectar superfície');
    return;
  }

  if (hit.fallback) {
    toast('Superfície estimada — mova devagar para melhorar', 2000);
  }

  const pos = hit.pos;

  if (mode === 'picking') {
    if (!isSim && !truckPlaced) {
      truckGrp.position.copy(pos);
      truckGrp.visible = true;
      truckPlaced = true;
      $('tap-hint').classList.remove('active');
      toast('Caçamba posicionada! Agora empilhe.', 3000, true);
      updHUD();
      return;
    }
    const lp = hit.local ? hit.local.clone() : truckGrp.worldToLocal(pos.clone());
    const st = findTop(lp.x, lp.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('NÃO PODE: ' + next.color + ' sobre ' + st.color); return;
      }
      lp.y = st.mesh.position.y + st.h / 2 + next.h / 2;
      lp.x = st.mesh.position.x; lp.z = st.mesh.position.z;
    } else {
      lp.y = next.h / 2;
    }
    if (!insideTruck(lp, next)) { toast('Fora da caçamba!'); return; }
    const m = mkBox(next); m.position.copy(lp); truckGrp.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa na caçamba!', 1500, true);
  } else {
    const st = findTop(pos.x, pos.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('NÃO PODE: ' + next.color + ' sobre ' + st.color); return;
      }
      pos.y = st.mesh.position.y + st.h / 2 + next.h / 2;
      pos.x = st.mesh.position.x; pos.z = st.mesh.position.z;
    } else {
      pos.y += next.h / 2;
    }
    const m = mkBox(next); m.position.copy(pos); scene.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa posicionada!', 1500, true);
  }
  next = genBox(); refreshPreview(); updHUD();
}

function undoBox() {
  if (!boxes.length) return;
  const b = boxes.pop();
  b.mesh.parent?.remove(b.mesh);
  if (b.mesh.geometry) b.mesh.geometry.dispose();
  toast('Removida!', 1200, true); updHUD();
}

function resetAll() {
  boxes.forEach(b => { b.mesh.parent?.remove(b.mesh); if (b.mesh.geometry) b.mesh.geometry.dispose(); });
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
    if (isSim) {
      truckGrp.visible = true;
      if (!truckPlaced) { truckGrp.position.set(0, 0, -0.8); truckPlaced = true; }
      toast('Picking — caçamba ativa!', 2500, true);
    } else {
      if (truckPlaced) { truckGrp.visible = true; toast('Picking!', 2000, true); }
      else { $('tap-hint').classList.add('active'); toast('Toque COLOCAR para posicionar a caçamba', 3500, true); }
    }
  } else {
    truckGrp.visible = false; $('tap-hint').classList.remove('active'); toast('Cubagem', 1500, true);
  }
  updHUD();
}

/* ── Botões ── */
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

/* ═══════════════════  AR Init  ═══════════════════ */
async function initAR() {
  if (!navigator.xr) { $('ar-status').textContent = 'WebXR indisponível.'; return; }

  /* Tentar várias configs — do mais completo ao mínimo */
  const configs = [
    { req: ['hit-test', 'local-floor'], opt: ['dom-overlay'], ov: true },
    { req: ['hit-test'], opt: ['local-floor', 'dom-overlay'], ov: true },
    { req: ['hit-test'], opt: ['local-floor'], ov: false },
    { req: ['hit-test'], opt: [], ov: false },
    { req: [], opt: ['hit-test'], ov: false },
  ];

  let session = null;
  for (const cfg of configs) {
    try {
      const opts = { requiredFeatures: cfg.req, optionalFeatures: cfg.opt };
      if (cfg.ov) opts.domOverlay = { root: document.body };
      session = await navigator.xr.requestSession('immersive-ar', opts);
      console.log('AR session criada com config:', JSON.stringify(cfg));
      break;
    } catch (e) {
      console.warn('Config falhou:', cfg.req, e.message);
      continue;
    }
  }
  if (!session) {
    $('ar-status').textContent = 'AR não suportado. Instale Google Play Services for AR.';
    return;
  }

  xrSession = session;
  session.addEventListener('end', () => {
    xrSession = null; htSource = null; lastHitValid = false;
    $('overlay').classList.remove('hidden');
    $('hud').classList.remove('active');
    $('crosshair').classList.remove('active');
    $('legend').classList.remove('active');
    $('sim-badge').classList.remove('active');
    $('tap-hint').classList.remove('active');
  });

  /* ── Reference space: tentar local-floor primeiro ── */
  let refSpaceType = 'local-floor';
  let refSpace;
  for (const rsType of ['local-floor', 'local', 'viewer']) {
    try {
      refSpace = await session.requestReferenceSpace(rsType);
      refSpaceType = rsType;
      console.log('Reference space:', rsType);
      break;
    } catch { continue; }
  }

  /* IMPORTANTE: definir o tipo ANTES de setSession */
  try { renderer.xr.setReferenceSpaceType(refSpaceType); } catch {}
  await renderer.xr.setSession(session);

  /* ── Hit Test Source ── */
  try {
    const viewerSpace = await session.requestReferenceSpace('viewer');
    htSource = await session.requestHitTestSource({ space: viewerSpace });
    console.log('Hit test source criado com sucesso');
    if (htSource) {
      htSource.addEventListener?.('cancel', () => {
        console.warn('Hit test source cancelado');
        htSource = null;
      });
    }
  } catch (e) {
    console.warn('Hit test não disponível:', e);
    toast('Hit test indisponível — posicionamento por estimativa', 3500);
  }

  /* ── Select = colocar ── */
  session.addEventListener('select', () => placeBox());

  enterHUD(false);

  /* ── Render loop ── */
  renderer.setAnimationLoop((timestamp, frame) => {
    if (!frame) return;

    /* Obter o reference space que o renderer está usando */
    const rs = renderer.xr.getReferenceSpace() || refSpace;

    /* ── Hit test ── */
    if (htSource && rs) {
      let results = null;
      try { results = frame.getHitTestResults(htSource); } catch {}

      if (results && results.length > 0) {
        let pose = null;
        try { pose = results[0].getPose(rs); } catch {}

        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          reticleHit = true;

          /* Salvar cache */
          lastHitMatrix.fromArray(pose.transform.matrix);
          lastHitValid = true;
          lastHitTimestamp = performance.now();

          /* Preview */
          const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          reticle.matrix.decompose(p, q, s);
          preview.visible = true;
          preview.position.set(p.x, p.y + next.h / 2, p.z);
        }
      } else {
        reticleHit = false;
        /* Se temos cache recente, manter visual */
        if (lastHitValid && (performance.now() - lastHitTimestamp < HIT_GRACE_MS)) {
          reticle.visible = true;
          reticle.matrix.copy(lastHitMatrix);
          const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          lastHitMatrix.decompose(p, q, s);
          preview.visible = true;
          preview.position.set(p.x, p.y + next.h / 2, p.z);
        } else {
          reticle.visible = false;
          preview.visible = false;
        }
      }
    } else {
      /* Sem hit test source: fallback visual */
      reticleHit = false;
      reticle.visible = false;
      /* Mostrar preview à frente */
      const xrCam = renderer.xr.getCamera();
      if (xrCam) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.quaternion);
        const fwd = xrCam.position.clone().add(dir.multiplyScalar(0.8));
        fwd.y = Math.max(fwd.y - 0.5, 0);
        preview.visible = true;
        preview.position.copy(fwd);
      }
    }

    /* Pulsar reticle */
    if (reticle.visible) {
      reticleRing.material.opacity = 0.55 + 0.35 * Math.sin(timestamp * 0.004);
    }

    renderer.render(scene, camera);
  });
}

/* ═══════════════════  Sim Init  ═══════════════════ */
function initSim() {
  isSim = true;
  enterHUD(true);

  simFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: 0.95 })
  );
  simFloor.rotation.x = -Math.PI / 2;
  scene.add(simFloor);

  const grid = new THREE.GridHelper(10, 20, 0xff2d87, 0x3a0f28);
  grid.position.y = 0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  truckGrp.position.set(0, 0, -0.8);
  camera.position.set(0, 1.0, 1.6);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.15, -0.4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 0.4;
  controls.maxDistance = 6;
  controls.update();

  scene.background = new THREE.Color(0x1a0a12);
  scene.fog = new THREE.Fog(0x1a0a12, 4, 12);

  renderer.setAnimationLoop(() => {
    controls.update();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);

    if (mode === 'picking' && truckGrp.visible) {
      const hits = rc.intersectObjects(truckGrp.children, true);
      if (hits.length) {
        const lp = truckGrp.worldToLocal(hits[0].point.clone());
        preview.visible = true;
        preview.position.copy(truckGrp.localToWorld(new THREE.Vector3(lp.x, next.h / 2, lp.z)));
      } else preview.visible = false;
    } else if (simFloor) {
      const hits = rc.intersectObject(simFloor);
      if (hits.length) {
        preview.visible = true;
        preview.position.set(hits[0].point.x, hits[0].point.y + next.h / 2, hits[0].point.z);
      } else preview.visible = false;
    }

    renderer.render(scene, camera);
  });
}

/* ── Start ── */
$('start-ar').onclick = initAR;
$('start-sim').onclick = initSim;

/* ── Feature detect ── */
(async () => {
  if (!navigator.xr) {
    $('ar-status').textContent = 'WebXR não disponível — use Modo Simulação.';
    $('start-ar').disabled = true;
    return;
  }
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    if (!ok) throw 0;
  } catch {
    $('ar-status').textContent = 'AR não suportado — use Modo Simulação.';
    $('start-ar').disabled = true;
  }
})();

/* ── Resize ── */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
