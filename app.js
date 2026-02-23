import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── Limiares de volume (m³) ── */
const TX = 0.012, TY = 0.004;
const CMAP = { red: 0xe53935, green: 0x43a047, blue: 0x1e88e5 };

/* ── Caçamba — escala maquete para AR (era 2.4×1.5×6.0, agora ~60cm×35cm×1m) ── */
const TRUCK = { w: 0.60, h: 0.35, d: 1.00 };

/* ── Tamanho máximo das caixas também reduzido para caber na caçamba ── */
const BOX_W_MIN = 0.04, BOX_W_MAX = 0.14;
const BOX_H_MIN = 0.03, BOX_H_MAX = 0.10;
const BOX_D_MIN = 0.04, BOX_D_MAX = 0.14;

let mode = 'cubagem', isSim = false, boxes = [], next = genBox();
let reticleOk = false, xrSession = null, htSource = null, truckPlaced = false;
let arRefSpace = null;
let lastHitPose = null;          // guarda último hit válido
let lastHitTime = 0;             // timestamp do último hit
const HIT_STALE_MS = 800;       // hit válido por até 800ms após perda

const $ = id => document.getElementById(id);

/* ── Renderer & Scene ── */
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
scene.add(new THREE.AmbientLight(0xffc0cb, 0.7));
const dl = new THREE.DirectionalLight(0xffffff, 1.6);
dl.position.set(4, 6, 4);
scene.add(dl);
scene.add(new THREE.PointLight(0xff69b4, 0.7, 15));

/* ── Reticle ── */
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.09, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff69b4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

/* ── Preview box ── */
let preview = mkBox(next, true);
preview.visible = false;
scene.add(preview);

/* ── Truck group ── */
const truckGrp = new THREE.Group();
truckGrp.visible = false;
scene.add(truckGrp);
buildTruck();
let simFloor = null;

/* ═══════════════════════  Funções auxiliares  ═══════════════════════ */

function genBox() {
  const w = +(Math.random() * (BOX_W_MAX - BOX_W_MIN) + BOX_W_MIN).toFixed(3);
  const h = +(Math.random() * (BOX_H_MAX - BOX_H_MIN) + BOX_H_MIN).toFixed(3);
  const d = +(Math.random() * (BOX_D_MAX - BOX_D_MIN) + BOX_D_MIN).toFixed(3);
  const v = w * h * d;
  return { w, h, d, v, color: v > TX ? 'red' : v > TY ? 'green' : 'blue' };
}

function mkBox(b, ghost = false) {
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mat = new THREE.MeshStandardMaterial({
    color: CMAP[b.color], transparent: true,
    opacity: ghost ? 0.35 : 0.92, roughness: 0.4, metalness: 0.05
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
  const tolerance = 0.06;   // tolerância reduzida p/ caixas menores
  for (const b of list) {
    const p = b.mesh.position;
    if (Math.abs(p.x - x) < tolerance && Math.abs(p.z - z) < tolerance) {
      const t = p.y + b.h / 2;
      if (t > by) { by = t; best = b; }
    }
  }
  return best;
}

/* ── Caçamba ── */
function buildTruck() {
  while (truckGrp.children.length) truckGrp.remove(truckGrp.children[0]);

  const { w: tw, h: th, d: td } = TRUCK;
  const wm = () => new THREE.MeshStandardMaterial({
    color: 0xff69b4, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, roughness: 0.85, depthWrite: false
  });

  // Chão
  const fl = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.015, td), wm());
  fl.material.opacity = 0.35;
  fl.material.color.set(0xff2d87);
  truckGrp.add(fl);

  // Paredes
  const wallThick = 0.015;
  const wl = new THREE.Mesh(new THREE.BoxGeometry(wallThick, th, td), wm());
  wl.position.set(-tw / 2, th / 2, 0);
  truckGrp.add(wl);

  const wr = new THREE.Mesh(new THREE.BoxGeometry(wallThick, th, td), wm());
  wr.position.set(tw / 2, th / 2, 0);
  truckGrp.add(wr);

  const wb = new THREE.Mesh(new THREE.BoxGeometry(tw, th, wallThick), wm());
  wb.position.set(0, th / 2, -td / 2);
  truckGrp.add(wb);

  // Wireframe principal
  const eg = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td)),
    new THREE.LineBasicMaterial({ color: 0xff2d87 })
  );
  eg.position.set(0, th / 2, 0);
  truckGrp.add(eg);

  // Wireframe glow
  const eg2 = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(tw + 0.01, th + 0.01, td + 0.01)),
    new THREE.LineBasicMaterial({ color: 0xff69b4, transparent: true, opacity: 0.4 })
  );
  eg2.position.set(0, th / 2, 0);
  truckGrp.add(eg2);

  // Grid
  const g = new THREE.GridHelper(Math.max(tw, td), 10, 0xff69b4, 0x4a1042);
  g.position.y = 0.01;
  g.material.transparent = true;
  g.material.opacity = 0.4;
  truckGrp.add(g);

  // Vértices decorativos
  const cg = new THREE.SphereGeometry(0.012, 10, 10);
  const cm = new THREE.MeshBasicMaterial({ color: 0xff2d87 });
  [[-tw/2, 0, -td/2], [tw/2, 0, -td/2], [-tw/2, 0, td/2], [tw/2, 0, td/2],
   [-tw/2, th, -td/2], [tw/2, th, -td/2], [-tw/2, th, td/2], [tw/2, th, td/2]
  ].forEach(c => {
    const s = new THREE.Mesh(cg, cm);
    s.position.set(...c);
    truckGrp.add(s);
  });

  // Label
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const cx = cv.getContext('2d');
  cx.font = 'bold 56px Poppins,sans-serif';
  cx.fillStyle = '#ff2d87';
  cx.textAlign = 'center';
  cx.fillText('CAÇAMBA', 256, 80);
  const tx = new THREE.CanvasTexture(cv);
  const lb = new THREE.Mesh(
    new THREE.PlaneGeometry(0.50, 0.12),
    new THREE.MeshBasicMaterial({ map: tx, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  lb.position.set(0, th + 0.10, 0);
  lb.rotation.x = -0.15;
  truckGrp.add(lb);
}

function insideTruck(p, b) {
  const hw = TRUCK.w / 2, hd = TRUCK.d / 2;
  return !(
    p.x - b.w / 2 < -hw ||
    p.x + b.w / 2 > hw ||
    p.z - b.d / 2 < -hd ||
    p.z + b.d / 2 > hd ||
    p.y + b.h / 2 > TRUCK.h
  );
}

/* ── Toast ── */
let tt;
function toast(msg, ms = 2500, ok = false) {
  $('toast').textContent = msg;
  $('toast').className = 'show ' + (ok ? 'success' : 'error');
  clearTimeout(tt);
  tt = setTimeout(() => $('toast').className = '', ms);
}

/* ── HUD ── */
function updHUD() {
  const mn = mode === 'cubagem' ? 'Cubagem' : 'Picking';
  $('hud-mode').innerHTML = 'Modo: <b>' + mn + '</b>';
  $('hud-count').innerHTML = 'Caixas: <b>' + boxes.length + '</b>';
  const colorNames = { red: 'Vermelha', green: 'Verde', blue: 'Azul' };
  $('hud-next').innerHTML = 'Próxima: <b>' + colorNames[next.color] + '</b>';
  $('hud-vol').innerHTML = 'Vol: <b>' + (next.v * 1e6).toFixed(0) + ' cm³</b>';
  $('mode-toggle').textContent = '🔄 ' + mn;
}

function refreshPreview() {
  scene.remove(preview);
  preview.geometry.dispose();
  preview = mkBox(next, true);
  preview.visible = false;
  scene.add(preview);
}

/* ══════════════════  Obter posição do hit (com cache)  ══════════════════ */
function getHitPosition() {
  /* Em modo sim, usa raycaster central */
  if (isSim) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    if (mode === 'picking' && truckGrp.visible) {
      const h = rc.intersectObjects(truckGrp.children, true);
      if (h.length) {
        const lp = truckGrp.worldToLocal(h[0].point.clone());
        return { pos: h[0].point.clone(), local: lp, hit: true };
      }
      return { pos: new THREE.Vector3(0, 0, -0.5), local: new THREE.Vector3(0, 0, 0), hit: false };
    } else {
      const h = rc.intersectObject(simFloor);
      if (h.length) return { pos: h[0].point.clone(), hit: true };
      return { pos: new THREE.Vector3(0, 0, 0), hit: false };
    }
  }

  /* Em modo AR, usa o reticle ou cache */
  if (reticleOk) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    reticle.matrix.decompose(p, q, s);
    return { pos: p, hit: true };
  }

  /* Se o hit ficou stale recentemente, ainda aceita */
  if (lastHitPose && (performance.now() - lastHitTime < HIT_STALE_MS)) {
    return { pos: lastHitPose.clone(), hit: true };
  }

  return { pos: null, hit: false };
}

/* ══════════════════  Place / Undo / Reset  ══════════════════ */
function placeBox() {
  const hitInfo = getHitPosition();

  if (!hitInfo.hit) {
    toast('Aponte para uma superfície plana!');
    return;
  }

  const pos = hitInfo.pos;

  if (mode === 'picking') {
    /* Primeiro toque em picking AR: posiciona a caçamba */
    if (!isSim && !truckPlaced) {
      const tp = pos.clone();
      truckGrp.position.copy(tp);
      truckGrp.visible = true;
      truckPlaced = true;
      $('tap-hint').classList.remove('active');
      toast('Caçamba posicionada! Agora empilhe as caixas.', 3000, true);
      updHUD();
      return;
    }

    /* Calcular posição local dentro da caçamba */
    const lp = isSim
      ? (hitInfo.local ? hitInfo.local.clone() : truckGrp.worldToLocal(pos.clone()))
      : truckGrp.worldToLocal(pos.clone());

    const st = findTop(lp.x, lp.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('NÃO PODE: ' + next.color + ' sobre ' + st.color);
        return;
      }
      lp.y = st.mesh.position.y + st.h / 2 + next.h / 2;
      lp.x = st.mesh.position.x;
      lp.z = st.mesh.position.z;
    } else {
      lp.y = next.h / 2;
    }

    if (!insideTruck(lp, next)) {
      toast('Fora da caçamba!');
      return;
    }

    const m = mkBox(next);
    m.position.copy(lp);
    truckGrp.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa na caçamba!', 1500, true);

  } else {
    /* Modo cubagem */
    const st = findTop(pos.x, pos.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('NÃO PODE: ' + next.color + ' sobre ' + st.color);
        return;
      }
      pos.y = st.mesh.position.y + st.h / 2 + next.h / 2;
      pos.x = st.mesh.position.x;
      pos.z = st.mesh.position.z;
    } else {
      pos.y += next.h / 2;
    }
    const m = mkBox(next);
    m.position.copy(pos);
    scene.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('Caixa posicionada!', 1500, true);
  }

  next = genBox();
  refreshPreview();
  updHUD();
}

function undoBox() {
  if (!boxes.length) return;
  const l = boxes.pop();
  l.mesh.parent?.remove(l.mesh);
  l.mesh.geometry.dispose();
  toast('Removida!', 1200, true);
  updHUD();
}

function resetAll() {
  boxes.forEach(b => {
    b.mesh.parent?.remove(b.mesh);
    b.mesh.geometry.dispose();
  });
  boxes = [];
  truckPlaced = false;
  if (mode === 'picking') {
    if (isSim) {
      truckGrp.position.set(0, 0, -0.8);
      truckPlaced = true;
    } else {
      truckGrp.visible = false;
    }
  }
  next = genBox();
  refreshPreview();
  updHUD();
  toast('Resetado!', 1200, true);
}

function toggleMode() {
  mode = mode === 'cubagem' ? 'picking' : 'cubagem';
  if (mode === 'picking') {
    if (isSim) {
      truckGrp.visible = true;
      if (!truckPlaced) {
        truckGrp.position.set(0, 0, -0.8);
        truckPlaced = true;
      }
      toast('Picking — caçamba ativa!', 2500, true);
    } else {
      if (truckPlaced) {
        truckGrp.visible = true;
        toast('Picking!', 2000, true);
      } else {
        $('tap-hint').classList.add('active');
        toast('Aponte para o chão e toque COLOCAR para posicionar a caçamba', 3500, true);
      }
    }
  } else {
    truckGrp.visible = false;
    $('tap-hint').classList.remove('active');
    toast('Cubagem', 1500, true);
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
  $('crosshair').classList.toggle('active', true);
  $('legend').classList.add('active');
  $('sim-badge').classList.toggle('active', sim);
  updHUD();
}

/* ══════════════════════  AR Init  ══════════════════════ */
async function initAR() {
  if (!navigator.xr) {
    $('ar-status').textContent = 'WebXR indisponível.';
    return;
  }

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
  if (!session) {
    $('ar-status').textContent = 'AR não suportado. Instale Google Play Services for AR.';
    return;
  }

  xrSession = session;
  session.addEventListener('end', () => {
    xrSession = null;
    htSource = null;
    lastHitPose = null;
    $('overlay').classList.remove('hidden');
    $('hud').classList.remove('active');
    $('crosshair').classList.remove('active');
    $('legend').classList.remove('active');
    $('sim-badge').classList.remove('active');
    $('tap-hint').classList.remove('active');
  });

  /* Obter reference space com fallbacks */
  let refSpace;
  try {
    refSpace = await session.requestReferenceSpace('local-floor');
  } catch {
    try {
      refSpace = await session.requestReferenceSpace('local');
    } catch {
      refSpace = await session.requestReferenceSpace('viewer');
    }
  }
  arRefSpace = refSpace;

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  /* Hit test source */
  try {
    const vs = await session.requestReferenceSpace('viewer');
    htSource = await session.requestHitTestSource({ space: vs });
    htSource.addEventListener('cancel', () => { htSource = null; });
  } catch (e) {
    console.warn('Hit test não disponível:', e);
    toast('Hit test indisponível — toque para posicionar manualmente', 4000);
  }

  /* Toque na tela = colocar caixa (select event) */
  session.addEventListener('select', () => { placeBox(); });

  enterHUD(false);
  renderer.setAnimationLoop((t, f) => renderAR(t, f, refSpace));
}

/* ══════════════════════  Sim Init  ══════════════════════ */
function initSim() {
  isSim = true;
  enterHUD(true);

  simFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: 0.95 })
  );
  simFloor.rotation.x = -Math.PI / 2;
  scene.add(simFloor);

  const grid = new THREE.GridHelper(12, 24, 0xff2d87, 0x3a0f28);
  grid.position.y = 0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  truckGrp.position.set(0, 0, -0.8);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.2, -0.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 8;
  controls.update();

  camera.position.set(0, 1.0, 1.8);

  scene.background = new THREE.Color(0x1a0a12);
  scene.fog = new THREE.Fog(0x1a0a12, 5, 14);

  renderer.setAnimationLoop(renderSim);
}

/* ══════════════════════  Render Loops  ══════════════════════ */
function renderAR(time, frame, refSpace) {
  if (!frame) return;

  /* Hit test */
  if (htSource) {
    const hits = frame.getHitTestResults(htSource);
    if (hits.length) {
      const pose = hits[0].getPose(refSpace);
      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        reticleOk = true;

        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        reticle.matrix.decompose(p, q, s);
        lastHitPose = p.clone();
        lastHitTime = performance.now();

        preview.visible = true;
        preview.position.set(p.x, p.y + next.h / 2, p.z);
      }
    } else {
      reticle.visible = false;
      reticleOk = false;
      /* Manter preview na última posição conhecida se recente */
      if (lastHitPose && (performance.now() - lastHitTime < HIT_STALE_MS)) {
        preview.visible = true;
        preview.position.set(lastHitPose.x, lastHitPose.y + next.h / 2, lastHitPose.z);
        reticle.visible = true;
      } else {
        preview.visible = false;
      }
    }
  }

  /* Pulsar reticle */
  if (reticle.visible) {
    reticle.material.opacity = 0.6 + 0.25 * Math.sin(time * 0.003);
  }

  renderer.render(scene, camera);
}

function renderSim() {
  controls.update();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, 0), camera);

  if (mode === 'picking' && truckGrp.visible) {
    const h = rc.intersectObjects(truckGrp.children, true);
    if (h.length) {
      const lp = truckGrp.worldToLocal(h[0].point.clone());
      preview.visible = true;
      preview.position.copy(
        truckGrp.localToWorld(new THREE.Vector3(lp.x, next.h / 2, lp.z))
      );
    } else {
      preview.visible = false;
    }
  } else if (simFloor) {
    const h = rc.intersectObject(simFloor);
    if (h.length) {
      preview.visible = true;
      preview.position.set(h[0].point.x, h[0].point.y + next.h / 2, h[0].point.z);
    } else {
      preview.visible = false;
    }
  }

  renderer.render(scene, camera);
}

/* ── Start buttons ── */
$('start-ar').onclick = initAR;
$('start-sim').onclick = initSim;

/* ── Feature detect ── */
(async () => {
  if (!navigator.xr) {
    $('ar-status').textContent = 'WebXR não disponível — use Modo Simulação.';
    $('start-ar').disabled = true;
    return;
  }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) {
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
