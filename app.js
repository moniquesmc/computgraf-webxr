// ================================================================
//  Cubagem & Picking WebXR — Three.js + WebXR Device API
//  Visual: tons de rosa 💖
// ================================================================
import * as THREE from 'three';

// ----------------------------------------------------------------
// Limiares de volume (em m³)
// ----------------------------------------------------------------
const VOLUME_THRESHOLD_X = 0.012;   // acima = Vermelho
const VOLUME_THRESHOLD_Y = 0.004;   // abaixo = Azul, entre = Verde

// Cores das caixas (rosa-friendly)
const COLOR_RED   = new THREE.Color(0xe53935);
const COLOR_GREEN = new THREE.Color(0x43a047);
const COLOR_BLUE  = new THREE.Color(0x1e88e5);

// Caçamba
const TRUCK_BED = { width: 2.4, height: 1.5, depth: 6.0 };

// ----------------------------------------------------------------
// Estado
// ----------------------------------------------------------------
let mode = 'cubagem';
let placedBoxes = [];
let nextBox = generateRandomBox();
let reticleVisible = false;
let session = null;
let hitTestSource = null;
let truckPlaced = false;

// ----------------------------------------------------------------
// DOM
// ----------------------------------------------------------------
const overlay    = document.getElementById('overlay');
const startBtn   = document.getElementById('start-ar');
const arStatus   = document.getElementById('ar-status');
const hud        = document.getElementById('hud');
const hudMode    = document.getElementById('hud-mode');
const hudCount   = document.getElementById('hud-count');
const hudNext    = document.getElementById('hud-next');
const hudVol     = document.getElementById('hud-vol');
const modeToggle = document.getElementById('mode-toggle');
const btnPlace   = document.getElementById('btn-place');
const btnUndo    = document.getElementById('btn-undo');
const btnReset   = document.getElementById('btn-reset');
const crosshair  = document.getElementById('crosshair');
const toastEl    = document.getElementById('toast');
const legend     = document.getElementById('legend');

// ----------------------------------------------------------------
// Three.js Setup
// ----------------------------------------------------------------
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 40);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// Luzes
scene.add(new THREE.AmbientLight(0xffc0cb, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(3, 5, 3);
dirLight.castShadow = true;
scene.add(dirLight);
const pinkLight = new THREE.PointLight(0xff69b4, 0.5, 10);
pinkLight.position.set(0, 2, 0);
scene.add(pinkLight);

// Reticle (anel rosa)
const reticleGeo = new THREE.RingGeometry(0.07, 0.1, 40).rotateX(-Math.PI / 2);
const reticleMat = new THREE.MeshBasicMaterial({
  color: 0xff69b4,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85
});
const reticle = new THREE.Mesh(reticleGeo, reticleMat);
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

// Preview da próxima caixa
let previewMesh = createBoxMesh(nextBox, true);
previewMesh.visible = false;
scene.add(previewMesh);

// Grupo da caçamba
const truckGroup = new THREE.Group();
truckGroup.visible = false;
scene.add(truckGroup);
buildTruckBed();

// ----------------------------------------------------------------
// Geração de caixas
// ----------------------------------------------------------------
function generateRandomBox() {
  const w = parseFloat((Math.random() * 0.4 + 0.1).toFixed(2));
  const h = parseFloat((Math.random() * 0.3 + 0.05).toFixed(2));
  const d = parseFloat((Math.random() * 0.4 + 0.1).toFixed(2));
  const volume = w * h * d;
  let color;
  if (volume > VOLUME_THRESHOLD_X) color = 'red';
  else if (volume > VOLUME_THRESHOLD_Y) color = 'green';
  else color = 'blue';
  return { w, h, d, volume, color };
}

function getThreeColor(c) {
  if (c === 'red')   return COLOR_RED.clone();
  if (c === 'green') return COLOR_GREEN.clone();
  return COLOR_BLUE.clone();
}

function createBoxMesh(box, isPreview = false) {
  const geo = new THREE.BoxGeometry(box.w, box.h, box.d);
  const mat = new THREE.MeshStandardMaterial({
    color: getThreeColor(box.color),
    transparent: true,
    opacity: isPreview ? 0.4 : 0.88,
    roughness: 0.45,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Wireframe rosa
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges,
    new THREE.LineBasicMaterial({
      color: isPreview ? 0xff69b4 : 0x1a0a12,
      linewidth: 1
    })
  );
  mesh.add(line);

  return mesh;
}

// ----------------------------------------------------------------
// Regras de empilhamento
// ----------------------------------------------------------------
function canStack(topColor, bottomColor) {
  if (topColor === bottomColor) return true;
  if (topColor === 'blue'  && (bottomColor === 'green' || bottomColor === 'red')) return true;
  if (topColor === 'green' && bottomColor === 'red') return true;
  return false;
}

function findStackTarget(posX, posZ, list) {
  let best = null;
  let bestTop = 0;
  const tol = 0.15;
  for (const b of list) {
    const bp = b.mesh.position;
    if (Math.abs(bp.x - posX) < tol && Math.abs(bp.z - posZ) < tol) {
      const top = bp.y + b.h / 2;
      if (top > bestTop) { bestTop = top; best = b; }
    }
  }
  return best;
}

// ----------------------------------------------------------------
// Caçamba do caminhão (wireframe rosa)
// ----------------------------------------------------------------
function buildTruckBed() {
  const { width: tw, height: th, depth: td } = TRUCK_BED;
  const wt = 0.03;

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xff69b4,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });

  // Chão
  const floor = new THREE.Mesh(new THREE.BoxGeometry(tw, wt, td), wallMat.clone());
  floor.material.opacity = 0.18;
  truckGroup.add(floor);

  // Paredes
  const wallL = new THREE.Mesh(new THREE.BoxGeometry(wt, th, td), wallMat.clone());
  wallL.position.set(-tw/2, th/2, 0);
  truckGroup.add(wallL);

  const wallR = new THREE.Mesh(new THREE.BoxGeometry(wt, th, td), wallMat.clone());
  wallR.position.set(tw/2, th/2, 0);
  truckGroup.add(wallR);

  const wallB = new THREE.Mesh(new THREE.BoxGeometry(tw, th, wt), wallMat.clone());
  wallB.position.set(0, th/2, -td/2);
  truckGroup.add(wallB);

  // Wireframe principal
  const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td));
  const edgesLine = new THREE.LineSegments(edgesGeo,
    new THREE.LineBasicMaterial({ color: 0xff2d87, linewidth: 2 })
  );
  edgesLine.position.set(0, th/2, 0);
  truckGroup.add(edgesLine);

  // Grid no chão
  const gridHelper = new THREE.GridHelper(Math.max(tw, td), 12, 0xff69b4, 0x4a1042);
  gridHelper.position.y = 0.02;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.3;
  truckGroup.add(gridHelper);
}

function isInsideTruck(pos, box) {
  const hw = TRUCK_BED.width/2, hd = TRUCK_BED.depth/2;
  const bw = box.w/2, bd = box.d/2;
  const top = pos.y + box.h/2;
  return !(pos.x-bw < -hw || pos.x+bw > hw || pos.z-bd < -hd || pos.z+bd > hd || top > TRUCK_BED.height);
}

// ----------------------------------------------------------------
// Toast
// ----------------------------------------------------------------
let toastTimeout;
function showToast(msg, ms = 2500, success = false) {
  toastEl.textContent = msg;
  toastEl.className = 'show ' + (success ? 'success' : 'error');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toastEl.className = ''; }, ms);
}

// ----------------------------------------------------------------
// HUD
// ----------------------------------------------------------------
function updateHUD() {
  const mn = mode === 'cubagem' ? 'Cubagem' : 'Picking';
  hudMode.innerHTML  = 'Modo: <b>' + mn + '</b>';
  hudCount.innerHTML = 'Caixas: <b>' + placedBoxes.length + '</b>';
  const cl = nextBox.color === 'red' ? '🔴 Vermelha' : nextBox.color === 'green' ? '🟢 Verde' : '🔵 Azul';
  hudNext.innerHTML  = 'Próxima: <b>' + cl + '</b>';
  const vcm = (nextBox.volume * 1e6).toFixed(0);
  hudVol.innerHTML   = 'Vol: <b>' + vcm + ' cm³</b>  (' + nextBox.w.toFixed(2) + '×' + nextBox.h.toFixed(2) + '×' + nextBox.d.toFixed(2) + 'm)';
  modeToggle.textContent = '🔄 ' + mn;
}

// ----------------------------------------------------------------
// Colocar caixa
// ----------------------------------------------------------------
function placeBox() {
  if (!reticleVisible) { showToast('📍 Aponte para uma superfície!'); return; }

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  reticle.matrix.decompose(pos, quat, scl);

  if (mode === 'picking') {
    if (!truckPlaced) {
      truckGroup.position.set(pos.x, pos.y, pos.z - 1.5);
      truckGroup.visible = true;
      truckPlaced = true;
    }

    const localPos = truckGroup.worldToLocal(pos.clone());
    const stackTarget = findStackTarget(localPos.x, localPos.z, placedBoxes);

    if (stackTarget) {
      if (!canStack(nextBox.color, stackTarget.color)) {
        showToast('❌ ' + nextBox.color.toUpperCase() + ' não empilha sobre ' + stackTarget.color.toUpperCase() + '!');
        return;
      }
      localPos.y = stackTarget.mesh.position.y + stackTarget.h/2 + nextBox.h/2;
      localPos.x = stackTarget.mesh.position.x;
      localPos.z = stackTarget.mesh.position.z;
    } else {
      localPos.y = nextBox.h/2;
    }

    if (!isInsideTruck(localPos, nextBox)) {
      showToast('❌ Caixa fora da caçamba!');
      return;
    }

    const mesh = createBoxMesh(nextBox);
    mesh.position.copy(localPos);
    truckGroup.add(mesh);
    placedBoxes.push({ mesh, color: nextBox.color, volume: nextBox.volume, w: nextBox.w, h: nextBox.h, d: nextBox.d, parent: 'truck' });
    showToast('✅ Caixa colocada na caçamba!', 1500, true);

  } else {
    const stackTarget = findStackTarget(pos.x, pos.z, placedBoxes);

    if (stackTarget) {
      if (!canStack(nextBox.color, stackTarget.color)) {
        showToast('❌ ' + nextBox.color.toUpperCase() + ' não empilha sobre ' + stackTarget.color.toUpperCase() + '!');
        return;
      }
      pos.y = stackTarget.mesh.position.y + stackTarget.h/2 + nextBox.h/2;
      pos.x = stackTarget.mesh.position.x;
      pos.z = stackTarget.mesh.position.z;
    } else {
      pos.y += nextBox.h/2;
    }

    const mesh = createBoxMesh(nextBox);
    mesh.position.copy(pos);
    scene.add(mesh);
    placedBoxes.push({ mesh, color: nextBox.color, volume: nextBox.volume, w: nextBox.w, h: nextBox.h, d: nextBox.d, parent: 'scene' });
    showToast('✅ Caixa posicionada!', 1500, true);
  }

  nextBox = generateRandomBox();
  refreshPreview();
  updateHUD();
}

// ----------------------------------------------------------------
// Desfazer / Resetar
// ----------------------------------------------------------------
function undoBox() {
  if (!placedBoxes.length) return;
  const last = placedBoxes.pop();
  if (last.mesh.parent) last.mesh.parent.remove(last.mesh);
  last.mesh.geometry.dispose();
  showToast('↩ Removida!', 1200, true);
  updateHUD();
}

function resetAll() {
  for (const b of placedBoxes) {
    if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
    b.mesh.geometry.dispose();
  }
  placedBoxes = [];
  truckPlaced = false;
  truckGroup.visible = false;
  nextBox = generateRandomBox();
  refreshPreview();
  updateHUD();
  showToast('✨ Cena resetada!', 1200, true);
}

// ----------------------------------------------------------------
// Preview
// ----------------------------------------------------------------
function refreshPreview() {
  scene.remove(previewMesh);
  previewMesh.geometry.dispose();
  previewMesh = createBoxMesh(nextBox, true);
  previewMesh.visible = false;
  scene.add(previewMesh);
}

// ----------------------------------------------------------------
// Alternar modo
// ----------------------------------------------------------------
function toggleMode() {
  if (mode === 'cubagem') {
    mode = 'picking';
    if (!truckPlaced) {
      showToast('🚛 Aponte e coloque a primeira caixa para posicionar a caçamba', 3000, true);
    }
  } else {
    mode = 'cubagem';
    truckGroup.visible = truckPlaced;
  }
  updateHUD();
}

// ----------------------------------------------------------------
// Eventos
// ----------------------------------------------------------------
btnPlace.addEventListener('click', placeBox);
btnUndo.addEventListener('click', undoBox);
btnReset.addEventListener('click', resetAll);
modeToggle.addEventListener('click', toggleMode);

// ----------------------------------------------------------------
// WebXR
// ----------------------------------------------------------------
async function startAR() {
  if (!navigator.xr) {
    arStatus.textContent = '⚠️ WebXR não suportado neste navegador.';
    return;
  }

  const supported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!supported) {
    arStatus.textContent = '⚠️ AR imersivo não suportado neste dispositivo.';
    return;
  }

  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local-floor'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    });

    session.addEventListener('end', onSessionEnd);
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);

    const refSpace = await session.requestReferenceSpace('local-floor');
    const viewerSpace = await session.requestReferenceSpace('viewer');

    session.requestHitTestSource({ space: viewerSpace }).then(src => {
      hitTestSource = src;
    });

    overlay.classList.add('hidden');
    hud.classList.add('active');
    crosshair.classList.add('active');
    legend.classList.add('active');
    updateHUD();

    renderer.setAnimationLoop((time, frame) => render(time, frame, refSpace));

  } catch (err) {
    arStatus.textContent = '❌ Erro: ' + err.message;
    console.error(err);
  }
}

function onSessionEnd() {
  session = null;
  hitTestSource = null;
  overlay.classList.remove('hidden');
  hud.classList.remove('active');
  crosshair.classList.remove('active');
  legend.classList.remove('active');
}

startBtn.addEventListener('click', startAR);

// Check de suporte
(async () => {
  if (!navigator.xr) {
    arStatus.textContent = '⚠️ WebXR não disponível. Use Chrome Android com ARCore.';
    startBtn.disabled = true;
  } else {
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    if (!ok) {
      arStatus.textContent = '⚠️ AR não suportado. Necessário Android + ARCore.';
      startBtn.disabled = true;
    }
  }
})();

// ----------------------------------------------------------------
// Render Loop
// ----------------------------------------------------------------
function render(time, frame, refSpace) {
  if (!frame) return;

  if (hitTestSource) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      reticleVisible = true;

      // Preview
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      reticle.matrix.decompose(p, q, s);
      previewMesh.visible = true;
      previewMesh.position.set(p.x, p.y + nextBox.h/2, p.z);
    } else {
      reticle.visible = false;
      previewMesh.visible = false;
      reticleVisible = false;
    }
  }

  // Animação sutil do reticle
  reticleMat.opacity = 0.6 + 0.25 * Math.sin(time * 0.003);

  renderer.render(scene, camera);
}

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
