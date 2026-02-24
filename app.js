// ================================================================
//  Cubagem & Picking WebXR — v6 FINAL (conforme enunciado)
//  ✅ Three.js + WebXR Device API (sem soluções legadas)
//  ✅ Hit Testing real de superfícies
//  ✅ Cor definida PELO VOLUME da caixa (V>X=vermelho, Y<V<X=verde, V<Y=azul)
//  ✅ Regras de empilhamento por cor
//  ✅ Destaque visual quando empilhamento é impossível
//  ✅ Módulo Cubagem + Módulo Picking com caçamba
// ================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Thresholds de volume (m³) calibrados para ~33% cada cor ----
// X = 0.032 m³ (32.000 cm³)   Y = 0.012 m³ (12.000 cm³)
// Vermelho: V > 0.032    Verde: 0.012 < V ≤ 0.032    Azul: V ≤ 0.012
const TX = 0.032;
const TY = 0.012;

const CMAP = { red: 0xe53935, green: 0x43a047, blue: 0x1e88e5 };

// Caçamba do caminhão (Picking)
const TRUCK = { w: 4.8, h: 3.0, d: 12.0 };

// ---- State ----
let mode = 'cubagem';
let isSim = false;
let boxes = [];
let next = genBox();
let reticleOk = false;
let xrSession = null;
let htSource = null;
let truckPlaced = false;

// ---- Seleção & Movimento ----
let selectedBox = null;
const moveSpeed = 0.05;
const keysDown = {};

// ---- DOM ----
const $ = id => document.getElementById(id);

// ---- Three.js Setup ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 120);
camera.position.set(0, 6, 14);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);
let controls = null;

// Iluminação
scene.add(new THREE.AmbientLight(0xffc0cb, 0.8));
const dl = new THREE.DirectionalLight(0xffffff, 1.8);
dl.position.set(6, 10, 6); scene.add(dl);
const dl2 = new THREE.DirectionalLight(0xffffff, 0.6);
dl2.position.set(-4, 8, -4); scene.add(dl2);
const pl = new THREE.PointLight(0xff69b4, 0.7, 20);
pl.position.set(0, 5, 0); scene.add(pl);

// Reticle (marcador AR)
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.18, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff69b4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

// Preview (fantasma da próxima caixa)
let preview = mkBox(next, true);
preview.visible = false;
scene.add(preview);

// Grupo da caçamba
const truckGrp = new THREE.Group();
truckGrp.visible = false;
scene.add(truckGrp);
buildTruck();

let simFloor = null;
let selOutline = null;

// ================================================================
//  GERAÇÃO DE CAIXA — Dimensões aleatórias, COR PELO VOLUME
// ================================================================
function genBox() {
  // Ranges calibrados para distribuição equilibrada das 3 cores
  const w = +(Math.random() * 0.55 + 0.05).toFixed(2);   // 0.05 a 0.60 m
  const h = +(Math.random() * 0.45 + 0.05).toFixed(2);   // 0.05 a 0.50 m
  const d = +(Math.random() * 0.55 + 0.05).toFixed(2);   // 0.05 a 0.60 m
  const v = w * h * d;

  // COR DEFINIDA PELO VOLUME (conforme enunciado)
  // Vermelho: V > X (TX)
  // Verde:    Y < V ≤ X (TY < V ≤ TX)
  // Azul:     V ≤ Y (TY)
  let color;
  if (v > TX) color = 'red';
  else if (v > TY) color = 'green';
  else color = 'blue';

  return { w, h, d, v, color };
}

function mkBox(b, ghost = false) {
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mat = new THREE.MeshStandardMaterial({
    color: CMAP[b.color],
    transparent: true,
    opacity: ghost ? 0.35 : 0.92,
    roughness: 0.35,
    metalness: 0.08,
  });
  const m = new THREE.Mesh(geo, mat);
  m.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: ghost ? 0xff69b4 : 0x220011, linewidth: 1 })
  ));
  return m;
}

// ================================================================
//  REGRAS DE EMPILHAMENTO (conforme enunciado)
//  - Mesma cor sobre mesma cor: ✅
//  - Azul sobre Verde ou Vermelha: ✅
//  - Verde sobre Vermelha: ✅
//  - Qualquer outra combinação: ❌
// ================================================================
function canStack(topColor, botColor) {
  if (topColor === botColor) return true;
  if (topColor === 'blue' && (botColor === 'green' || botColor === 'red')) return true;
  if (topColor === 'green' && botColor === 'red') return true;
  return false;
}

function findTop(x, z, list) {
  let best = null, by = 0;
  const threshold = 0.22;
  for (const b of list) {
    const p = b.mesh.position;
    if (Math.abs(p.x - x) < threshold && Math.abs(p.z - z) < threshold) {
      const t = p.y + b.h / 2;
      if (t > by) { by = t; best = b; }
    }
  }
  return best;
}

// ================================================================
//  CAÇAMBA DO CAMINHÃO (Módulo Picking)
// ================================================================
function buildTruck() {
  const { w: tw, h: th, d: td } = TRUCK;
  const wt = 0.06;

  const wallMat = () => new THREE.MeshStandardMaterial({
    color: 0xff69b4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, roughness: 0.85, depthWrite: false
  });

  // Chão sólido
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xff2d87, transparent: true, opacity: 0.4,
    side: THREE.DoubleSide, roughness: 0.9
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(tw, wt, td), floorMat);
  floor.position.y = 0;
  truckGrp.add(floor);

  // Paredes
  const wl = new THREE.Mesh(new THREE.BoxGeometry(wt, th, td), wallMat());
  wl.position.set(-tw / 2, th / 2, 0); truckGrp.add(wl);

  const wr = new THREE.Mesh(new THREE.BoxGeometry(wt, th, td), wallMat());
  wr.position.set(tw / 2, th / 2, 0); truckGrp.add(wr);

  const wb = new THREE.Mesh(new THREE.BoxGeometry(tw, th, wt), wallMat());
  wb.position.set(0, th / 2, -td / 2); truckGrp.add(wb);

  // Frontal (aberta)
  const wf = new THREE.Mesh(new THREE.BoxGeometry(tw, th, wt), wallMat());
  wf.material.opacity = 0.05;
  wf.position.set(0, th / 2, td / 2); truckGrp.add(wf);

  // Wireframe principal
  const edgesBox = new THREE.BoxGeometry(tw, th, td);
  const edges = new THREE.EdgesGeometry(edgesBox);
  const edgeLine = new THREE.LineSegments(edges,
    new THREE.LineBasicMaterial({ color: 0xff2d87, linewidth: 2 })
  );
  edgeLine.position.set(0, th / 2, 0);
  truckGrp.add(edgeLine);

  // Glow wireframe
  const edgesGlow = new THREE.EdgesGeometry(new THREE.BoxGeometry(tw + 0.03, th + 0.03, td + 0.03));
  const glowLine = new THREE.LineSegments(edgesGlow,
    new THREE.LineBasicMaterial({ color: 0xff69b4, transparent: true, opacity: 0.35 })
  );
  glowLine.position.set(0, th / 2, 0);
  truckGrp.add(glowLine);

  // Grid no chão
  const g = new THREE.GridHelper(Math.max(tw, td), 20, 0xff69b4, 0x4a1042);
  g.position.y = 0.04;
  g.material.transparent = true;
  g.material.opacity = 0.35;
  truckGrp.add(g);

  // Marcadores de cantos
  const cornerGeo = new THREE.SphereGeometry(0.06, 12, 12);
  const cornerMat = new THREE.MeshBasicMaterial({ color: 0xff2d87 });
  [
    [-tw/2, 0, -td/2], [tw/2, 0, -td/2], [-tw/2, 0, td/2], [tw/2, 0, td/2],
    [-tw/2, th, -td/2], [tw/2, th, -td/2], [-tw/2, th, td/2], [tw/2, th, td/2],
  ].forEach(c => {
    const s = new THREE.Mesh(cornerGeo, cornerMat);
    s.position.set(c[0], c[1], c[2]);
    truckGrp.add(s);
  });

  // Label CAÇAMBA
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 192);
  ctx.font = 'bold 80px Poppins, sans-serif';
  ctx.fillStyle = '#ff2d87';
  ctx.textAlign = 'center';
  ctx.fillText('CAÇAMBA', 512, 120);
  const tex = new THREE.CanvasTexture(canvas);
  const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.8), labelMat);
  labelMesh.position.set(0, th + 0.6, 0);
  labelMesh.rotation.x = -Math.PI * 0.12;
  truckGrp.add(labelMesh);

  // Label dimensões
  const canvas2 = document.createElement('canvas');
  canvas2.width = 1024; canvas2.height = 128;
  const ctx2 = canvas2.getContext('2d');
  ctx2.clearRect(0, 0, 1024, 128);
  ctx2.font = '500 44px Poppins, sans-serif';
  ctx2.fillStyle = '#ff69b4';
  ctx2.textAlign = 'center';
  ctx2.fillText(tw.toFixed(1) + 'm x ' + th.toFixed(1) + 'm x ' + td.toFixed(1) + 'm', 512, 80);
  const tex2 = new THREE.CanvasTexture(canvas2);
  const dimMat = new THREE.MeshBasicMaterial({ map: tex2, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const dimMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.5), dimMat);
  dimMesh.position.set(0, th + 0.15, 0);
  dimMesh.rotation.x = -Math.PI * 0.12;
  truckGrp.add(dimMesh);
}

function insideTruck(p, b) {
  const hw = TRUCK.w / 2, hd = TRUCK.d / 2;
  return !(p.x - b.w/2 < -hw || p.x + b.w/2 > hw || p.z - b.d/2 < -hd || p.z + b.d/2 > hd || p.y + b.h/2 > TRUCK.h);
}

// ================================================================
//  UI — Toast, HUD, Preview
// ================================================================
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

  const colorNames = { red: '🔴 Vermelha', green: '🟢 Verde', blue: '🔵 Azul' };
  $('hud-next').innerHTML = 'Próxima: <b>' + colorNames[next.color] + '</b>';
  $('hud-vol').innerHTML = 'Vol: <b>' + (next.v * 1e6).toFixed(0) + ' cm³</b> (' + next.w.toFixed(2) + 'x' + next.h.toFixed(2) + 'x' + next.d.toFixed(2) + 'm)';
  $('mode-toggle').textContent = '🔄 ' + mn;

  // Info de seleção
  if (selectedBox) {
    const sc = { red: '🔴', green: '🟢', blue: '🔵' }[selectedBox.color];
    $('sel-info').textContent = '📦 Selecionada: ' + sc + ' | WASD/Setas mover | Q/E sobe/desce | ESC deseleciona';
    $('sel-info').style.display = 'block';
  } else {
    $('sel-info').style.display = 'none';
  }
}

function refreshPreview() {
  scene.remove(preview); preview.geometry.dispose();
  preview = mkBox(next, true); preview.visible = false; scene.add(preview);
}

// ================================================================
//  DESTAQUE VISUAL — preview fica vermelho pulsante se não pode empilhar
//  (Requisito B: "destacar quando não for possível empilhar a caixa")
// ================================================================
function updatePreviewFeedback(previewPos) {
  if (!preview.visible) return;

  let blocked = false;

  if (mode === 'picking') {
    // Checar se está dentro da caçamba
    const lp = isSim ? previewPos.clone() : truckGrp.worldToLocal(previewPos.clone());
    if (!insideTruck(lp, next)) {
      blocked = true;
    } else {
      const st = findTop(lp.x, lp.z, boxes);
      if (st && !canStack(next.color, st.color)) {
        blocked = true;
      }
    }
  } else {
    // Cubagem — checar empilhamento
    const st = findTop(previewPos.x, previewPos.z, boxes);
    if (st && !canStack(next.color, st.color)) {
      blocked = true;
    }
  }

  // Atualizar visual do preview
  if (blocked) {
    // DESTAQUE VERMELHO pulsante — empilhamento impossível
    const pulse = 0.5 + 0.3 * Math.sin(Date.now() * 0.008);
    preview.material.color.set(0xff0000);
    preview.material.opacity = pulse;
    // Atualizar edges para vermelho
    preview.children.forEach(c => {
      if (c.isLineSegments) c.material.color.set(0xff0000);
    });
  } else {
    // Normal — cor correta da caixa
    preview.material.color.set(CMAP[next.color]);
    preview.material.opacity = 0.35;
    preview.children.forEach(c => {
      if (c.isLineSegments) c.material.color.set(0xff69b4);
    });
  }
}

// ================================================================
//  SELEÇÃO DE CAIXAS (clique + teclado para mover)
// ================================================================
function selectBox(event) {
  if (!isSim) return;

  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / innerHeight) * 2 + 1;

  const rc = new THREE.Raycaster();
  rc.setFromCamera(mouse, camera);

  const meshes = boxes.map(b => b.mesh);
  const hits = rc.intersectObjects(meshes, false);

  clearSelection();

  if (hits.length > 0) {
    const hitMesh = hits[0].object;
    const box = boxes.find(b => b.mesh === hitMesh);
    if (box) {
      selectedBox = box;
      const outGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(box.w + 0.04, box.h + 0.04, box.d + 0.04));
      selOutline = new THREE.LineSegments(outGeo, new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 }));
      box.mesh.add(selOutline);
      toast('📦 Caixa selecionada! WASD/Setas/Q/E para mover.', 2000, true);
      updHUD();
    }
  } else {
    updHUD();
  }
}

function clearSelection() {
  if (selOutline && selectedBox) {
    selectedBox.mesh.remove(selOutline);
    selOutline.geometry.dispose();
    selOutline.material.dispose();
    selOutline = null;
  }
  selectedBox = null;
}

function moveSelectedBox() {
  if (!selectedBox) return;

  const m = selectedBox.mesh;
  let dx = 0, dz = 0, dy = 0;

  if (keysDown['KeyA'] || keysDown['ArrowLeft']) dx -= moveSpeed;
  if (keysDown['KeyD'] || keysDown['ArrowRight']) dx += moveSpeed;
  if (keysDown['KeyW'] || keysDown['ArrowUp']) dz -= moveSpeed;
  if (keysDown['KeyS'] || keysDown['ArrowDown']) dz += moveSpeed;
  if (keysDown['KeyQ']) dy += moveSpeed;
  if (keysDown['KeyE']) dy -= moveSpeed;

  if (dx !== 0 || dz !== 0 || dy !== 0) {
    m.position.x += dx;
    m.position.y += dy;
    m.position.z += dz;

    // Não descer abaixo do chão
    if (m.position.y < selectedBox.h / 2) {
      m.position.y = selectedBox.h / 2;
    }

    // Limites da caçamba no modo picking
    if (mode === 'picking') {
      const hw = TRUCK.w / 2, hd = TRUCK.d / 2;
      m.position.x = Math.max(-hw + selectedBox.w/2, Math.min(hw - selectedBox.w/2, m.position.x));
      m.position.z = Math.max(-hd + selectedBox.d/2, Math.min(hd - selectedBox.d/2, m.position.z));
      if (m.position.y + selectedBox.h/2 > TRUCK.h) m.position.y = TRUCK.h - selectedBox.h/2;
    }
  }
}

// Eventos de teclado
window.addEventListener('keydown', (e) => {
  keysDown[e.code] = true;
  if (e.code === 'Escape') { clearSelection(); updHUD(); }
});
window.addEventListener('keyup', (e) => { keysDown[e.code] = false; });

// Clique para selecionar
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#hud') || e.target.closest('#overlay') || e.target.closest('#legend')) return;
  selectBox(e);
});

// ================================================================
//  COLOCAR CAIXA
// ================================================================
function placeBox() {
  if (!isSim && !reticleOk) { toast('📍 Aponte para uma superfície!'); return; }

  const pos = new THREE.Vector3();

  if (isSim) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    if (mode === 'picking') {
      const h = rc.intersectObjects(truckGrp.children, true);
      if (h.length) pos.copy(truckGrp.worldToLocal(h[0].point.clone()));
      else pos.set((Math.random() - .5) * (TRUCK.w * 0.6), 0, (Math.random() - .5) * (TRUCK.d * 0.6));
    } else {
      const h = rc.intersectObject(simFloor);
      if (h.length) pos.copy(h[0].point);
      else pos.set((Math.random() - .5) * 3, 0, (Math.random() - .5) * 3);
    }
  } else {
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    reticle.matrix.decompose(pos, q, s);
  }

  // === MÓDULO PICKING (B) ===
  if (mode === 'picking') {
    // AR: posicionar caçamba na primeira vez
    if (!isSim && !truckPlaced) {
      const tPos = pos.clone();
      tPos.z -= TRUCK.d / 2 + 0.5;
      truckGrp.position.copy(tPos);
      truckGrp.visible = true;
      truckPlaced = true;
      toast('🚛 Caçamba posicionada! Agora coloque as caixas dentro.', 3000, true);
      updHUD();
      return;
    }

    const lp = isSim ? pos.clone() : truckGrp.worldToLocal(pos.clone());
    const st = findTop(lp.x, lp.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('❌ ' + next.color.toUpperCase() + ' não empilha sobre ' + st.color.toUpperCase() + '!');
        return;
      }
      lp.y = st.mesh.position.y + st.h / 2 + next.h / 2;
      lp.x = st.mesh.position.x; lp.z = st.mesh.position.z;
    } else { lp.y = next.h / 2; }

    if (!insideTruck(lp, next)) { toast('❌ Caixa fora da caçamba!'); return; }

    const m = mkBox(next);
    m.position.copy(lp);
    truckGrp.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('✅ Caixa na caçamba!', 1500, true);
  }
  // === MÓDULO CUBAGEM (A) ===
  else {
    const st = findTop(pos.x, pos.z, boxes);
    if (st) {
      if (!canStack(next.color, st.color)) {
        toast('❌ ' + next.color.toUpperCase() + ' não empilha sobre ' + st.color.toUpperCase() + '!');
        return;
      }
      pos.y = st.mesh.position.y + st.h / 2 + next.h / 2;
      pos.x = st.mesh.position.x; pos.z = st.mesh.position.z;
    } else { pos.y += next.h / 2; }

    const m = mkBox(next);
    m.position.copy(pos);
    scene.add(m);
    boxes.push({ mesh: m, color: next.color, v: next.v, w: next.w, h: next.h, d: next.d });
    toast('✅ Caixa posicionada!', 1500, true);
  }

  next = genBox(); refreshPreview(); updHUD();
}

function undoBox() {
  if (!boxes.length) return;
  clearSelection();
  const l = boxes.pop();
  l.mesh.parent?.remove(l.mesh); l.mesh.geometry.dispose();
  toast('↩ Removida!', 1200, true); updHUD();
}

function resetAll() {
  clearSelection();
  boxes.forEach(b => { b.mesh.parent?.remove(b.mesh); b.mesh.geometry.dispose(); });
  boxes = [];
  truckPlaced = false;
  if (mode === 'picking') {
    if (isSim) { truckGrp.position.set(0, 0, -4); truckPlaced = true; }
    else { truckGrp.visible = false; }
  }
  next = genBox(); refreshPreview(); updHUD();
  toast('✨ Resetado!', 1200, true);
}

function toggleMode() {
  clearSelection();
  mode = mode === 'cubagem' ? 'picking' : 'cubagem';
  if (mode === 'picking') {
    if (isSim) {
      truckGrp.visible = true;
      if (!truckPlaced) { truckGrp.position.set(0, 0, -4); truckPlaced = true; }
      toast('🚛 Modo Picking — coloque caixas na caçamba!', 2500, true);
    } else {
      if (truckPlaced) {
        truckGrp.visible = true;
        toast('🚛 Modo Picking — caçamba ativa!', 2000, true);
      } else {
        toast('🚛 Aponte para o chão e toque COLOCAR para posicionar a caçamba!', 3500, true);
      }
    }
  } else {
    truckGrp.visible = false;
    toast('📐 Modo Cubagem — empilhe livremente!', 1500, true);
  }
  updHUD();
}

// Botões
$('btn-place').onclick = placeBox;
$('btn-undo').onclick = undoBox;
$('btn-reset').onclick = resetAll;
$('mode-toggle').onclick = toggleMode;

// ================================================================
//  ENTER HUD
// ================================================================
function enterHUD(sim) {
  $('overlay').classList.add('hidden');
  $('hud').classList.add('active');
  $('crosshair').classList.toggle('active', !sim);
  $('legend').classList.add('active');
  $('sim-badge').classList.toggle('active', sim);
  updHUD();
}

// ================================================================
//  AR — WebXR com Hit Testing
// ================================================================
async function initAR() {
  if (!navigator.xr) { $('ar-status').textContent = '⚠️ WebXR indisponível.'; return; }

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
      console.log('AR session OK:', c);
      break;
    } catch (e) { console.warn('AR config fail:', c, e.message); }
  }

  if (!session) {
    $('ar-status').textContent = '❌ AR não suportado. Instale Google Play Services for AR.';
    return;
  }

  xrSession = session;
  session.addEventListener('end', () => {
    xrSession = null; htSource = null;
    $('overlay').classList.remove('hidden');
    $('hud').classList.remove('active');
    $('crosshair').classList.remove('active');
    $('legend').classList.remove('active');
    $('sim-badge').classList.remove('active');
  });

  let refSpace;
  try { refSpace = await session.requestReferenceSpace('local-floor'); }
  catch { try { refSpace = await session.requestReferenceSpace('local'); } catch { refSpace = await session.requestReferenceSpace('viewer'); } }

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  try {
    const vs = await session.requestReferenceSpace('viewer');
    htSource = await session.requestHitTestSource({ space: vs });
  } catch (e) { console.warn('Hit-test source fail:', e); }

  enterHUD(false);
  renderer.setAnimationLoop((t, f) => renderAR(t, f, refSpace));
}

// ================================================================
//  SIMULAÇÃO DESKTOP
// ================================================================
function initSim() {
  isSim = true;
  enterHUD(true);

  simFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x2d0a1e, roughness: 0.95 })
  );
  simFloor.rotation.x = -Math.PI / 2; scene.add(simFloor);

  const grid = new THREE.GridHelper(40, 60, 0xff2d87, 0x3a0f28);
  grid.position.y = 0.005; grid.material.transparent = true; grid.material.opacity = 0.3;
  scene.add(grid);

  // Caçamba firme no chão y=0
  truckGrp.position.set(0, 0, -4);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, -2);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 2; controls.maxDistance = 35;
  controls.update();

  scene.background = new THREE.Color(0x1a0a12);
  scene.fog = new THREE.Fog(0x1a0a12, 16, 40);

  renderer.setAnimationLoop(renderSim);
}

// ================================================================
//  RENDER AR
// ================================================================
function renderAR(time, frame, refSpace) {
  if (!frame) return;
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
        preview.visible = true;
        preview.position.set(p.x, p.y + next.h / 2, p.z);
        updatePreviewFeedback(preview.position);
      }
    } else {
      reticle.visible = false; preview.visible = false; reticleOk = false;
    }
  }
  reticle.material.opacity = 0.6 + 0.25 * Math.sin(time * 0.003);
  renderer.render(scene, camera);
}

// ================================================================
//  RENDER SIMULAÇÃO — caixas estáticas, sem movimento automático
// ================================================================
function renderSim() {
  controls.update();
  moveSelectedBox();

  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, 0), camera);

  if (mode === 'picking' && truckGrp.visible) {
    const h = rc.intersectObjects(truckGrp.children, true);
    if (h.length) {
      const lp = truckGrp.worldToLocal(h[0].point.clone());
      preview.visible = true;
      preview.position.copy(truckGrp.localToWorld(new THREE.Vector3(lp.x, next.h / 2, lp.z)));
      updatePreviewFeedback(new THREE.Vector3(lp.x, next.h / 2, lp.z));
    } else preview.visible = false;
  } else if (simFloor) {
    const h = rc.intersectObject(simFloor);
    if (h.length) {
      preview.visible = true;
      preview.position.set(h[0].point.x, h[0].point.y + next.h / 2, h[0].point.z);
      updatePreviewFeedback(preview.position);
    } else preview.visible = false;
  }
  renderer.render(scene, camera);
}

// ================================================================
//  INIT
// ================================================================
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
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
