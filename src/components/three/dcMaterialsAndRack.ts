import * as THREE from 'three';
import {
  RACK_W,
  RACK_H,
  RACK_D,
  PLINTH_MIN_X,
  PLINTH_MAX_X,
  PLINTH_MIN_Z,
  PLINTH_MAX_Z,
  PLINTH_THICKNESS,
  SPINE_X,
  RECOVERY_COLLECTOR_X,
  CORE_POS,
  CRAH_SPEC,
  RECOVERY_SPEC,
  getRackPlacement3D,
  getRowAisleZ,
  getPathAThermalExportPoints3D,
  getPathBTegAuxPoints3D,
  Vec3Tuple,
} from './dcLayout';

export const RAYCAST_LAYER = 1;

export interface SharedFacilityResources {
  disposables: Array<{ dispose: () => void }>;
  contactShadowTex: THREE.CanvasTexture;
  plumeAlphaTex: THREE.CanvasTexture;
  floorTileTex: THREE.CanvasTexture;
  floorBumpTex: THREE.CanvasTexture;
  serverTrayTex: THREE.CanvasTexture;
  serverBumpTex: THREE.CanvasTexture;
  perfMeshTex: THREE.CanvasTexture;
  perfBumpTex: THREE.CanvasTexture;
  sidePanelTex: THREE.CanvasTexture;
  sideBumpTex: THREE.CanvasTexture;
  edgeLineMat: THREE.LineBasicMaterial;
  disposeAll: () => void;
}

export interface Rack3DHandle {
  id: number;
  group: THREE.Group;
  frameMat: THREE.MeshStandardMaterial;
  sideMat: THREE.MeshStandardMaterial;
  lightStripMat: THREE.MeshStandardMaterial;
  bayWashMat: THREE.MeshStandardMaterial;
  outlineMat: THREE.MeshBasicMaterial;
  outlineMesh: THREE.Mesh;
  obstructionBar: THREE.Mesh;
  virtualSensorRing: THREE.Mesh;
  trayGlowMats: THREE.MeshStandardMaterial[];
  trayLedMats: THREE.MeshStandardMaterial[];
  exhaustPlumeGroup: THREE.Group;
  exhaustPlumeMat: THREE.MeshBasicMaterial;
  plumeProxyMesh: THREE.Mesh;
  intakeStreamGroup: THREE.Group;
  intakeStreamMat: THREE.MeshStandardMaterial;
  intakeChevrons: THREE.Mesh[];
  hoverBoost: number;
}

export interface Core3DHandle {
  group: THREE.Group;
  ringMat: THREE.MeshStandardMaterial;
  nodeMat: THREE.MeshStandardMaterial;
  topTrimMat: THREE.MeshStandardMaterial;
  outlineMat: THREE.MeshBasicMaterial;
  outlineMesh: THREE.Mesh;
}

export interface Crah3DHandle {
  group: THREE.Group;
  stripMat: THREE.MeshStandardMaterial;
  plenumMats: THREE.MeshStandardMaterial[];
  plenumDashGroups: THREE.Group[];
  outlineMat: THREE.MeshBasicMaterial;
  outlineMesh: THREE.Mesh;
}

export interface Recovery3DHandle {
  group: THREE.Group;
  stripMat: THREE.MeshStandardMaterial;
  finMat: THREE.MeshStandardMaterial;
  pipeGlowMat: THREE.MeshStandardMaterial;
  pathAPipeMat: THREE.MeshStandardMaterial;
  pathAHeaderMat: THREE.MeshStandardMaterial;
  pathAPulsePool: PulseCapsuleHandle[];
  pathBStripMat: THREE.MeshStandardMaterial;
  pathBTerminalMat: THREE.MeshStandardMaterial;
  pathBPulsePool: PulseCapsuleHandle[];
  outlineMat: THREE.MeshBasicMaterial;
  outlineMesh: THREE.Mesh;
}

export interface ConduitBranchHandle {
  tapStripMat: THREE.MeshStandardMaterial;
  tapNodeMat: THREE.MeshStandardMaterial;
}

export interface PulseCapsuleHandle {
  mesh: THREE.Mesh;
  haloMesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
}

export interface ConduitNetworkHandle {
  group: THREE.Group;
  spineStripMat: THREE.MeshStandardMaterial;
  recoveryCollectorMat: THREE.MeshStandardMaterial;
  rowStripMats: THREE.MeshStandardMaterial[];
  rowJunctionMats: THREE.MeshStandardMaterial[];
  branches: ConduitBranchHandle[];
  pulsePool: PulseCapsuleHandle[];
  packetPool: PulseCapsuleHandle[];
  knnGroup: THREE.Group;
  knnTubeMats: THREE.MeshStandardMaterial[];
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

export function createSharedFacilityResources(maxAnisotropy: number): SharedFacilityResources {
  const disposables: Array<{ dispose: () => void }[]> = [];
  const list: Array<{ dispose: () => void }> = [];
  void disposables;
  const track = <T extends { dispose: () => void }>(item: T): T => {
    list.push(item);
    return item;
  };

  // Subtle architectural CAD crease line material for industrial cabinet edges
  const edgeLineMat = track(
    new THREE.LineBasicMaterial({
      color: 0x7d8594,
      transparent: true,
      opacity: 0.42,
    })
  );

  // 1. Soft radial contact shadow texture
  const [shCanvas, shCtx] = makeCanvas(128, 128);
  const grad = shCtx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(18, 20, 26, 0.44)');
  grad.addColorStop(0.55, 'rgba(18, 20, 26, 0.20)');
  grad.addColorStop(1, 'rgba(18, 20, 26, 0.0)');
  shCtx.fillStyle = grad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadowTex = track(new THREE.CanvasTexture(shCanvas));
  contactShadowTex.colorSpace = THREE.SRGBColorSpace;

  // 2. Precision raised-floor access tile texture + micro-bump (clear tile grid against #F7F7F2)
  const [flCanvas, flCtx] = makeCanvas(256, 256);
  flCtx.fillStyle = '#EAEAE2';
  flCtx.fillRect(0, 0, 256, 256);
  flCtx.strokeStyle = '#CFD1C8';
  flCtx.lineWidth = 4;
  flCtx.strokeRect(2, 2, 252, 252);
  flCtx.strokeStyle = '#DADCD3';
  flCtx.lineWidth = 2;
  flCtx.beginPath();
  flCtx.moveTo(128, 0);
  flCtx.lineTo(128, 256);
  flCtx.moveTo(0, 128);
  flCtx.lineTo(256, 128);
  flCtx.stroke();
  flCtx.fillStyle = '#B8BBB1';
  for (const [cx, cy] of [
    [12, 12],
    [244, 12],
    [12, 244],
    [244, 244],
    [118, 12],
    [138, 12],
    [118, 244],
    [138, 244],
  ]) {
    flCtx.beginPath();
    flCtx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    flCtx.fill();
  }
  const floorTileTex = track(new THREE.CanvasTexture(flCanvas));
  floorTileTex.colorSpace = THREE.SRGBColorSpace;
  floorTileTex.wrapS = THREE.RepeatWrapping;
  floorTileTex.wrapT = THREE.RepeatWrapping;
  floorTileTex.repeat.set(9, 7);
  floorTileTex.anisotropy = maxAnisotropy;

  const [flBumpCanvas, flBumpCtx] = makeCanvas(256, 256);
  flBumpCtx.fillStyle = '#ECECEC';
  flBumpCtx.fillRect(0, 0, 256, 256);
  flBumpCtx.strokeStyle = '#787878';
  flBumpCtx.lineWidth = 4;
  flBumpCtx.strokeRect(2, 2, 252, 252);
  const floorBumpTex = track(new THREE.CanvasTexture(flBumpCanvas));
  floorBumpTex.wrapS = THREE.RepeatWrapping;
  floorBumpTex.wrapT = THREE.RepeatWrapping;
  floorBumpTex.repeat.set(9, 7);
  floorBumpTex.anisotropy = maxAnisotropy;

  // 3. Server tray faceplate texture (2U dark-grey chassis with drive caddies & ventilation slots)
  const [svCanvas, svCtx] = makeCanvas(512, 128);
  svCtx.fillStyle = '#262B35';
  svCtx.fillRect(0, 0, 512, 128);
  // Top anodized bevel highlight & bottom shadow lip
  svCtx.fillStyle = '#4B5465';
  svCtx.fillRect(0, 0, 512, 9);
  svCtx.fillStyle = '#151820';
  svCtx.fillRect(0, 119, 512, 9);

  // 4 Hot-swap NVMe drive caddies on left + recessed honeycomb airflow louver on right
  for (let bay = 0; bay < 4; bay++) {
    const bx = 18 + bay * 72;
    svCtx.fillStyle = '#1E232C';
    svCtx.fillRect(bx, 18, 64, 92);
    svCtx.strokeStyle = '#464F60';
    svCtx.lineWidth = 2;
    svCtx.strokeRect(bx, 18, 64, 92);
    svCtx.fillStyle = '#0F1218';
    for (let vx = bx + 7; vx < bx + 47; vx += 7) {
      for (let vy = 26; vy < 102; vy += 9) {
        svCtx.fillRect(vx, vy, 4.5, 5);
      }
    }
    // Brushed release latch tab
    svCtx.fillStyle = '#687387';
    svCtx.fillRect(bx + 51, 24, 7, 80);
  }
  // Right ventilation intake grille slots
  svCtx.fillStyle = '#181C24';
  svCtx.fillRect(312, 18, 160, 92);
  svCtx.strokeStyle = '#3A4250';
  svCtx.lineWidth = 2;
  svCtx.strokeRect(312, 18, 160, 92);
  svCtx.fillStyle = '#0B0E13';
  for (let vy = 27; vy <= 99; vy += 11) {
    svCtx.fillRect(322, vy, 138, 5);
  }
  const serverTrayTex = track(new THREE.CanvasTexture(svCanvas));
  serverTrayTex.colorSpace = THREE.SRGBColorSpace;
  serverTrayTex.anisotropy = maxAnisotropy;

  const [svBumpCanvas, svBumpCtx] = makeCanvas(512, 128);
  svBumpCtx.fillStyle = '#C0C0C0';
  svBumpCtx.fillRect(0, 0, 512, 128);
  svBumpCtx.fillStyle = '#282828';
  for (let bay = 0; bay < 4; bay++) {
    const bx = 18 + bay * 72;
    for (let vx = bx + 7; vx < bx + 47; vx += 7) {
      for (let vy = 26; vy < 102; vy += 9) {
        svBumpCtx.fillRect(vx, vy, 4.5, 5);
      }
    }
  }
  for (let vy = 27; vy <= 99; vy += 11) {
    svBumpCtx.fillRect(322, vy, 138, 5);
  }
  const serverBumpTex = track(new THREE.CanvasTexture(svBumpCanvas));
  serverBumpTex.anisotropy = maxAnisotropy;

  // 4. Perforated exhaust grille texture
  const [pfCanvas, pfCtx] = makeCanvas(256, 256);
  pfCtx.fillStyle = '#323844';
  pfCtx.fillRect(0, 0, 256, 256);
  pfCtx.fillStyle = '#141820';
  for (let y = 8; y < 252; y += 10) {
    const offset = (y / 10) % 2 === 0 ? 0 : 5;
    for (let x = 8 + offset; x < 248; x += 10) {
      pfCtx.beginPath();
      pfCtx.arc(x, y, 3.2, 0, Math.PI * 2);
      pfCtx.fill();
    }
  }
  const perfMeshTex = track(new THREE.CanvasTexture(pfCanvas));
  perfMeshTex.colorSpace = THREE.SRGBColorSpace;
  perfMeshTex.wrapS = THREE.RepeatWrapping;
  perfMeshTex.wrapT = THREE.RepeatWrapping;
  perfMeshTex.repeat.set(2, 3);
  perfMeshTex.anisotropy = maxAnisotropy;

  const [pfBumpCanvas, pfBumpCtx] = makeCanvas(256, 256);
  pfBumpCtx.fillStyle = '#D0D0D0';
  pfBumpCtx.fillRect(0, 0, 256, 256);
  pfBumpCtx.fillStyle = '#202020';
  for (let y = 8; y < 252; y += 10) {
    const offset = (y / 10) % 2 === 0 ? 0 : 5;
    for (let x = 8 + offset; x < 248; x += 10) {
      pfBumpCtx.beginPath();
      pfBumpCtx.arc(x, y, 3.2, 0, Math.PI * 2);
      pfBumpCtx.fill();
    }
  }
  const perfBumpTex = track(new THREE.CanvasTexture(pfBumpCanvas));
  perfBumpTex.wrapS = THREE.RepeatWrapping;
  perfBumpTex.wrapT = THREE.RepeatWrapping;
  perfBumpTex.repeat.set(2, 3);
  perfBumpTex.anisotropy = maxAnisotropy;

  // 5. Industrial brushed metallic side-panel texture (rich light-medium grey for crisp 3D contrast)
  const [spCanvas, spCtx] = makeCanvas(256, 512);
  spCtx.fillStyle = '#B3BAC6';
  spCtx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 240; i++) {
    const x = (i * 37) % 256;
    spCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(24,28,36,0.05)';
    spCtx.fillRect(x, 0, 2, 512);
  }
  spCtx.strokeStyle = '#858E9D';
  spCtx.lineWidth = 4;
  spCtx.strokeRect(18, 22, 220, 222);
  spCtx.strokeRect(18, 260, 220, 228);
  spCtx.fillStyle = '#434A57';
  for (let ly = 408; ly <= 468; ly += 10) {
    spCtx.fillRect(40, ly, 176, 4.5);
  }
  spCtx.fillStyle = '#6A7383';
  spCtx.beginPath();
  spCtx.arc(128, 38, 5, 0, Math.PI * 2);
  spCtx.arc(128, 276, 5, 0, Math.PI * 2);
  spCtx.fill();

  const sidePanelTex = track(new THREE.CanvasTexture(spCanvas));
  sidePanelTex.colorSpace = THREE.SRGBColorSpace;
  sidePanelTex.anisotropy = maxAnisotropy;

  const [spBumpCanvas, spBumpCtx] = makeCanvas(256, 512);
  spBumpCtx.fillStyle = '#C8C8C8';
  spBumpCtx.fillRect(0, 0, 256, 512);
  spBumpCtx.strokeStyle = '#505050';
  spBumpCtx.lineWidth = 4;
  spBumpCtx.strokeRect(18, 22, 220, 222);
  spBumpCtx.strokeRect(18, 260, 220, 228);
  spBumpCtx.fillStyle = '#242424';
  for (let ly = 408; ly <= 468; ly += 10) {
    spBumpCtx.fillRect(40, ly, 176, 4.5);
  }
  const sideBumpTex = track(new THREE.CanvasTexture(spBumpCanvas));
  sideBumpTex.anisotropy = maxAnisotropy;

  // 6. Soft vertical fade alpha map for convective exhaust thermal plumes (zero hard top seam)
  const [plCanvas, plCtx] = makeCanvas(64, 128);
  const plGrad = plCtx.createLinearGradient(0, 128, 0, 0);
  plGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.92)');
  plGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.48)');
  plGrad.addColorStop(0.82, 'rgba(255, 255, 255, 0.14)');
  plGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  plCtx.fillStyle = plGrad;
  plCtx.fillRect(0, 0, 64, 128);
  const plumeAlphaTex = track(new THREE.CanvasTexture(plCanvas));

  return {
    disposables: list,
    contactShadowTex,
    plumeAlphaTex,
    floorTileTex,
    floorBumpTex,
    serverTrayTex,
    serverBumpTex,
    perfMeshTex,
    perfBumpTex,
    sidePanelTex,
    sideBumpTex,
    edgeLineMat,
    disposeAll: () => {
      for (const d of list) {
        d.dispose();
      }
    },
  };
}

function addCrispEdges(
  mesh: THREE.Mesh,
  edgeMat: THREE.LineBasicMaterial,
  track: <T extends { dispose: () => void }>(item: T) => T
) {
  const edgeGeo = track(new THREE.EdgesGeometry(mesh.geometry, 25));
  const lines = new THREE.LineSegments(edgeGeo, edgeMat);
  mesh.add(lines);
}

/**
 * Builds the raised engineering plinth on the #F7F7F2 laboratory floor.
 */
export function createPlinthAssembly(
  res: SharedFacilityResources,
  enableShadows: boolean
): THREE.Group {
  const group = new THREE.Group();
  const track = <T extends { dispose: () => void }>(item: T): T => {
    res.disposables.push(item);
    return item;
  };

  const w = PLINTH_MAX_X - PLINTH_MIN_X;
  const d = PLINTH_MAX_Z - PLINTH_MIN_Z;
  const cx = (PLINTH_MIN_X + PLINTH_MAX_X) * 0.5;
  const cz = (PLINTH_MIN_Z + PLINTH_MAX_Z) * 0.5;

  // Soft outer laboratory floor plane receiving shadow under plinth
  const labFloorGeo = track(new THREE.PlaneGeometry(54, 54));
  const labFloorMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xf7f7f2,
    })
  );
  const labFloor = new THREE.Mesh(labFloorGeo, labFloorMat);
  labFloor.rotation.x = -Math.PI / 2;
  labFloor.position.set(cx, -PLINTH_THICKNESS - 0.06, cz);
  group.add(labFloor);

  // Soft ambient ground shadow under plinth
  const plinthShadowGeo = track(new THREE.PlaneGeometry(w + 1.6, d + 1.6));
  const plinthShadowMat = track(
    new THREE.MeshBasicMaterial({
      map: res.contactShadowTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    })
  );
  const plinthShadow = new THREE.Mesh(plinthShadowGeo, plinthShadowMat);
  plinthShadow.rotation.x = -Math.PI / 2;
  plinthShadow.position.set(cx + 0.08, -PLINTH_THICKNESS - 0.045, cz + 0.08);
  group.add(plinthShadow);

  // Recessed dark under-plinth pedestal base
  const subBaseGeo = track(new THREE.BoxGeometry(w - 0.28, 0.08, d - 0.28));
  const subBaseMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x9ea29a,
      roughness: 0.75,
      metalness: 0.18,
    })
  );
  const subBase = new THREE.Mesh(subBaseGeo, subBaseMat);
  subBase.position.set(cx, -PLINTH_THICKNESS - 0.02, cz);
  group.add(subBase);

  // Main raised floor slab sides
  const slabGeo = track(new THREE.BoxGeometry(w, PLINTH_THICKNESS - 0.015, d));
  const slabSideMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xc8cac1,
      roughness: 0.66,
      metalness: 0.14,
      envMapIntensity: 0.28,
    })
  );
  const slab = new THREE.Mesh(slabGeo, slabSideMat);
  slab.position.set(cx, -PLINTH_THICKNESS * 0.5 - 0.008, cz);
  slab.receiveShadow = enableShadows;
  addCrispEdges(slab, res.edgeLineMat, track);
  group.add(slab);

  // Top precision tile surface at y = 0
  const topTileGeo = track(new THREE.PlaneGeometry(w - 0.08, d - 0.08));
  const topTileMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: res.floorTileTex,
      bumpMap: res.floorBumpTex,
      bumpScale: 0.006,
      roughness: 0.80,
      metalness: 0.05,
      envMapIntensity: 0.22,
    })
  );
  const topTile = new THREE.Mesh(topTileGeo, topTileMat);
  topTile.rotation.x = -Math.PI / 2;
  topTile.position.set(cx, 0, cz);
  topTile.receiveShadow = enableShadows;
  group.add(topTile);

  // Anodized aluminium perimeter trim bezel around plinth edge
  const trimMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xaeb4bf,
      roughness: 0.40,
      metalness: 0.50,
      envMapIntensity: 0.45,
    })
  );
  const trimThickness = 0.05;
  const trimHeight = 0.032;
  const trimFBGeo = track(new THREE.BoxGeometry(w + 0.02, trimHeight, trimThickness));
  const trimLRGeo = track(new THREE.BoxGeometry(trimThickness, trimHeight, d + 0.02));

  const trimFront = new THREE.Mesh(trimFBGeo, trimMat);
  trimFront.position.set(cx, 0.002, PLINTH_MAX_Z);
  const trimBack = new THREE.Mesh(trimFBGeo, trimMat);
  trimBack.position.set(cx, 0.002, PLINTH_MIN_Z);
  const trimLeft = new THREE.Mesh(trimLRGeo, trimMat);
  trimLeft.position.set(PLINTH_MIN_X, 0.002, cz);
  const trimRight = new THREE.Mesh(trimLRGeo, trimMat);
  trimRight.position.set(PLINTH_MAX_X, 0.002, cz);
  group.add(trimFront, trimBack, trimLeft, trimRight);

  return group;
}

/**
 * Builds a composite multi-part 3D enterprise server rack cabinet (R01-R12)
 */
export function createRackAssembly(
  rackId: number,
  res: SharedFacilityResources,
  enableShadows: boolean
): Rack3DHandle {
  const track = <T extends { dispose: () => void }>(item: T): T => {
    res.disposables.push(item);
    return item;
  };

  const placement = getRackPlacement3D(rackId);
  const group = new THREE.Group();
  group.position.set(placement.x, 0, placement.z);

  // 1. Soft radial contact shadow grounded beneath rack
  const shadowGeo = track(new THREE.PlaneGeometry(RACK_W * 1.52, RACK_D * 1.52));
  const shadowMat = track(
    new THREE.MeshBasicMaterial({
      map: res.contactShadowTex,
      transparent: true,
      opacity: 0.80,
      depthWrite: false,
    })
  );
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(0.03, 0.004, 0.03);
  group.add(shadowMesh);

  // 2. Four steel leveling feet at corners
  const footGeo = track(new THREE.CylinderGeometry(0.044, 0.054, 0.045, 12));
  const footMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x333842,
      roughness: 0.45,
      metalness: 0.68,
    })
  );
  for (const [fx, fz] of [
    [-RACK_W * 0.42, -RACK_D * 0.42],
    [RACK_W * 0.42, -RACK_D * 0.42],
    [-RACK_W * 0.42, RACK_D * 0.42],
    [RACK_W * 0.42, RACK_D * 0.42],
  ]) {
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(fx, 0.022, fz);
    group.add(foot);
  }

  // 3. Outer metallic industrial light-grey cabinet frame
  const frameMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xc0c6d0,
      roughness: 0.38,
      metalness: 0.40,
      envMapIntensity: 0.48,
    })
  );

  const sideMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: res.sidePanelTex,
      bumpMap: res.sideBumpTex,
      bumpScale: 0.01,
      roughness: 0.58,
      metalness: 0.28,
      envMapIntensity: 0.42,
    })
  );

  const bodyBaseY = 0.042;
  const bodyTopY = RACK_H;
  const bodyH = bodyTopY - bodyBaseY;
  const recessDepth = 0.095; // Deep 3D recessed front server bay!

  // Bottom plinth & Top crown of cabinet
  const bottomCrownGeo = track(new THREE.BoxGeometry(RACK_W, 0.092, RACK_D));
  const bottomCrown = new THREE.Mesh(bottomCrownGeo, frameMat);
  bottomCrown.position.set(0, bodyBaseY + 0.046, 0);
  bottomCrown.castShadow = enableShadows;
  bottomCrown.receiveShadow = enableShadows;
  addCrispEdges(bottomCrown, res.edgeLineMat, track);
  group.add(bottomCrown);

  const topCrownGeo = track(new THREE.BoxGeometry(RACK_W, 0.096, RACK_D));
  const topCrown = new THREE.Mesh(topCrownGeo, frameMat);
  topCrown.position.set(0, bodyTopY - 0.048, 0);
  topCrown.castShadow = enableShadows;
  topCrown.receiveShadow = enableShadows;
  addCrispEdges(topCrown, res.edgeLineMat, track);
  group.add(topCrown);

  // Dark recessed interior chassis cavity
  const midH = bodyH - 0.188;
  const midCenterY = bodyBaseY + 0.092 + midH * 0.5;
  const innerCoreD = RACK_D - recessDepth - 0.045;
  const innerCoreZ = (0.045 - recessDepth) * 0.5;

  const darkCavityMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x151921,
      roughness: 0.84,
      metalness: 0.2,
    })
  );
  const innerCoreGeo = track(new THREE.BoxGeometry(RACK_W - 0.14, midH, innerCoreD));
  const innerCore = new THREE.Mesh(innerCoreGeo, darkCavityMat);
  innerCore.position.set(0.02, midCenterY, innerCoreZ);
  innerCore.castShadow = enableShadows;
  innerCore.receiveShadow = enableShadows;
  group.add(innerCore);

  // Left & Right structural side walls
  const leftPostW = 0.155;
  const rightPostW = 0.095;
  const leftWallGeo = track(new THREE.BoxGeometry(leftPostW, midH, RACK_D));
  const leftWall = new THREE.Mesh(leftWallGeo, frameMat);
  leftWall.position.set(-RACK_W * 0.5 + leftPostW * 0.5, midCenterY, 0);
  leftWall.castShadow = enableShadows;
  leftWall.receiveShadow = enableShadows;
  addCrispEdges(leftWall, res.edgeLineMat, track);

  const rightWallGeo = track(new THREE.BoxGeometry(rightPostW, midH, RACK_D));
  const rightWall = new THREE.Mesh(rightWallGeo, frameMat);
  rightWall.position.set(RACK_W * 0.5 - rightPostW * 0.5, midCenterY, 0);
  rightWall.castShadow = enableShadows;
  rightWall.receiveShadow = enableShadows;
  addCrispEdges(rightWall, res.edgeLineMat, track);
  group.add(leftWall, rightWall);

  // Sculpted inset brushed-metal side architectural panels (Left & Right)
  const sideInsetGeo = track(new THREE.BoxGeometry(0.02, midH - 0.06, RACK_D - 0.14));
  const leftInset = new THREE.Mesh(sideInsetGeo, sideMat);
  leftInset.position.set(-RACK_W * 0.5 - 0.006, midCenterY, 0);
  leftInset.castShadow = enableShadows;
  leftInset.receiveShadow = enableShadows;

  const rightInset = new THREE.Mesh(sideInsetGeo, sideMat);
  rightInset.position.set(RACK_W * 0.5 + 0.006, midCenterY, 0);
  rightInset.castShadow = enableShadows;
  rightInset.receiveShadow = enableShadows;
  group.add(leftInset, rightInset);

  // 4. Top Roof Perforated Exhaust Grille & Dual Low-Profile Exhaust Fan Shrouds
  const perfMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: res.perfMeshTex,
      bumpMap: res.perfBumpTex,
      bumpScale: 0.014,
      roughness: 0.68,
      metalness: 0.34,
    })
  );
  const topGrilleGeo = track(new THREE.BoxGeometry(RACK_W - 0.26, 0.024, RACK_D - 0.26));
  const topGrille = new THREE.Mesh(topGrilleGeo, perfMat);
  topGrille.position.set(0.01, RACK_H + 0.008, -0.01);
  group.add(topGrille);

  const fanRingMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x454c5a,
      roughness: 0.42,
      metalness: 0.58,
    })
  );
  const fanShroudGeo = track(new THREE.CylinderGeometry(0.185, 0.205, 0.028, 20));
  for (const fz of [-0.21, 0.17]) {
    const shroud = new THREE.Mesh(fanShroudGeo, fanRingMat);
    shroud.position.set(0.01, RACK_H + 0.022, fz);
    group.add(shroud);
  }

  // 5. Rear Split Perforated Exhaust Doors
  const rearDoorW = (RACK_W - 0.20) * 0.48;
  const rearDoorGeo = track(new THREE.BoxGeometry(rearDoorW, midH - 0.04, 0.024));
  const rearDoorL = new THREE.Mesh(rearDoorGeo, perfMat);
  rearDoorL.position.set(-rearDoorW * 0.52, midCenterY, -RACK_D * 0.5 + 0.018);
  const rearDoorR = new THREE.Mesh(rearDoorGeo, perfMat);
  rearDoorR.position.set(rearDoorW * 0.52, midCenterY, -RACK_D * 0.5 + 0.018);
  const rearLatchGeo = track(new THREE.BoxGeometry(0.032, 0.28, 0.038));
  const rearLatch = new THREE.Mesh(rearLatchGeo, fanRingMat);
  rearLatch.position.set(0, midCenterY, -RACK_D * 0.5 + 0.008);
  group.add(rearDoorL, rearDoorR, rearLatch);

  // 6. Six Individual 3D Server Units (2U Trays) inside Recessed Front Bay
  const bayWidth = RACK_W - leftPostW - rightPostW;
  const bayCenterX = (leftPostW - rightPostW) * 0.5;
  const frontPlaneZ = RACK_D * 0.5;
  const trayZ = frontPlaneZ - 0.042; // Physically recessed inside cabinet posts!

  const trayFaceMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: res.serverTrayTex,
      bumpMap: res.serverBumpTex,
      bumpScale: 0.012,
      roughness: 0.46,
      metalness: 0.48,
      envMapIntensity: 0.48,
    })
  );
  const handleMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x9aa3b4,
      roughness: 0.26,
      metalness: 0.74,
      envMapIntensity: 0.65,
    })
  );
  const shelfDividerMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x5c6475,
      roughness: 0.42,
      metalness: 0.58,
    })
  );

  const trayH = 0.242;
  const trayPitch = 0.312;
  const firstTrayY = bodyBaseY + 0.245;

  const trayBodyGeo = track(new THREE.BoxGeometry(bayWidth - 0.028, trayH, 0.072));
  const shelfLipGeo = track(new THREE.BoxGeometry(bayWidth - 0.01, 0.014, 0.082));
  const earHandleGeo = track(new THREE.BoxGeometry(0.024, trayH - 0.036, 0.038));
  const ledGeo = track(new THREE.BoxGeometry(0.028, 0.028, 0.016));
  const thermalSlotGeo = track(new THREE.BoxGeometry(bayWidth - 0.11, 0.024, 0.012));

  const trayGlowMats: THREE.MeshStandardMaterial[] = [];
  const trayLedMats: THREE.MeshStandardMaterial[] = [];

  for (let s = 0; s < 6; s++) {
    const ty = firstTrayY + s * trayPitch;

    // Extruded metallic rack-rail shelf lip beneath each server tray
    const shelfLip = new THREE.Mesh(shelfLipGeo, shelfDividerMat);
    shelfLip.position.set(bayCenterX, ty - trayH * 0.5 - 0.008, trayZ + 0.006);
    group.add(shelfLip);

    const trayMesh = new THREE.Mesh(trayBodyGeo, trayFaceMat);
    trayMesh.position.set(bayCenterX, ty, trayZ);
    trayMesh.castShadow = enableShadows;
    trayMesh.receiveShadow = enableShadows;
    group.add(trayMesh);

    // Left & Right 3D brushed silver rack-mount pull handles
    const leftEar = new THREE.Mesh(earHandleGeo, handleMat);
    leftEar.position.set(bayCenterX - bayWidth * 0.5 + 0.026, ty, trayZ + 0.044);
    const rightEar = new THREE.Mesh(earHandleGeo, handleMat);
    rightEar.position.set(bayCenterX + bayWidth * 0.5 - 0.026, ty, trayZ + 0.044);
    group.add(leftEar, rightEar);

    // Subtle internal thermal louver indicator strip
    const glowMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x1e232d,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.6,
        metalness: 0.2,
      })
    );
    const glowStrip = new THREE.Mesh(thermalSlotGeo, glowMat);
    glowStrip.position.set(bayCenterX, ty - trayH * 0.38, trayZ + 0.036);
    group.add(glowStrip);
    trayGlowMats.push(glowMat);

    // Subtle server unit status LED lens
    const ledMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x475569,
        emissive: 0x475569,
        emissiveIntensity: 0.4,
        roughness: 0.28,
        metalness: 0.1,
      })
    );
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(bayCenterX + bayWidth * 0.5 - 0.068, ty + 0.052, trayZ + 0.04);
    group.add(ledMesh);
    trayLedMats.push(ledMat);
  }

  // 7. Integrated Vertical 3D THERMOS Light-Strip along Front-Left Structural Post
  const stripX = -RACK_W * 0.5 + 0.11;
  const grooveGeo = track(new THREE.BoxGeometry(0.062, RACK_H - 0.12, 0.026));
  const grooveMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1f2430,
      roughness: 0.55,
      metalness: 0.5,
    })
  );
  const grooveMesh = new THREE.Mesh(grooveGeo, grooveMat);
  grooveMesh.position.set(stripX, RACK_H * 0.5 + 0.01, frontPlaneZ - 0.001);
  group.add(grooveMesh);

  const lightStripMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.68,
      roughness: 0.20,
      metalness: 0.06,
    })
  );
  const lightStripGeo = track(new THREE.BoxGeometry(0.038, RACK_H - 0.16, 0.03));
  const lightStripMesh = new THREE.Mesh(lightStripGeo, lightStripMat);
  lightStripMesh.position.set(stripX, RACK_H * 0.5 + 0.01, frontPlaneZ + 0.008);
  group.add(lightStripMesh);

  // Subtle top bay illumination wash bar
  const bayWashMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x2c3340,
      emissive: 0x0066ff,
      emissiveIntensity: 0.0,
      roughness: 0.35,
      metalness: 0.15,
    })
  );
  const bayWashGeo = track(new THREE.BoxGeometry(bayWidth - 0.04, 0.026, 0.065));
  const bayWashMesh = new THREE.Mesh(bayWashGeo, bayWashMat);
  bayWashMesh.position.set(bayCenterX, bodyTopY - 0.105, trayZ + 0.015);
  group.add(bayWashMesh);

  // 8. Restricted Airflow Physical Louver Indicator (R08 obstruction)
  const obstructionGeo = track(new THREE.BoxGeometry(bayWidth - 0.06, 0.055, 0.032));
  const obstructionMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xb45309,
      emissiveIntensity: 0.5,
      roughness: 0.5,
      metalness: 0.2,
    })
  );
  const obstructionBar = new THREE.Mesh(obstructionGeo, obstructionMat);
  obstructionBar.position.set(bayCenterX, bodyBaseY + 0.095, frontPlaneZ + 0.01);
  obstructionBar.visible = false;
  group.add(obstructionBar);

  // 9. Virtual Sensor Spatial Ring above rack (R07 offline)
  const vsRingGeo = track(new THREE.TorusGeometry(0.34, 0.018, 10, 32));
  const vsRingMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.9,
      roughness: 0.25,
    })
  );
  const virtualSensorRing = new THREE.Mesh(vsRingGeo, vsRingMat);
  virtualSensorRing.rotation.x = Math.PI / 2;
  virtualSensorRing.position.set(0, RACK_H + 0.11, 0);
  virtualSensorRing.visible = false;
  group.add(virtualSensorRing);

  // 10. Grounded Selection / Incident Perimeter Frame Collar
  const outlineShape = new THREE.Shape();
  const ow = RACK_W * 0.5 + 0.09;
  const od = RACK_D * 0.5 + 0.09;
  outlineShape.moveTo(-ow, -od);
  outlineShape.lineTo(ow, -od);
  outlineShape.lineTo(ow, od);
  outlineShape.lineTo(-ow, od);
  outlineShape.closePath();

  const holePath = new THREE.Path();
  const iw = RACK_W * 0.5 + 0.035;
  const idp = RACK_D * 0.5 + 0.035;
  holePath.moveTo(-iw, -idp);
  holePath.lineTo(-iw, idp);
  holePath.lineTo(iw, idp);
  holePath.lineTo(iw, -idp);
  holePath.closePath();
  outlineShape.holes.push(holePath);

  const outlineGeo = track(new THREE.ShapeGeometry(outlineShape));
  const outlineMat = track(
    new THREE.MeshBasicMaterial({
      color: 0x18181b,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
  outlineMesh.rotation.x = -Math.PI / 2;
  outlineMesh.position.set(0, 0.015, 0);
  outlineMesh.visible = false;
  group.add(outlineMesh);

  // 11. Convective Roof Exhaust Thermal Plume Columns (for HeatFlow & hotspot legibility)
  const exhaustPlumeGroup = new THREE.Group();
  exhaustPlumeGroup.position.set(0.01, RACK_H + 0.025, 0);
  exhaustPlumeGroup.visible = false;
  const exhaustPlumeMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xd97706,
      alphaMap: res.plumeAlphaTex,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  // Open-ended tapered cylinders anchored at bottom pivot (y = 0..1) above the dual exhaust fan shrouds
  const plumeColGeo = track(new THREE.CylinderGeometry(0.24, 0.175, 0.86, 18, 1, true));
  plumeColGeo.translate(0, 0.43, 0);
  for (const fz of [-0.21, 0.17]) {
    const colMesh = new THREE.Mesh(plumeColGeo, exhaustPlumeMat);
    colMesh.position.set(0, 0, fz);
    colMesh.renderOrder = 4;
    exhaustPlumeGroup.add(colMesh);
  }
  group.add(exhaustPlumeGroup);

  const plumeProxyGeo = track(new THREE.CylinderGeometry(0.42, 0.36, 0.92, 12));
  const plumeProxyMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const plumeProxyMesh = new THREE.Mesh(plumeProxyGeo, plumeProxyMat);
  plumeProxyMesh.position.set(0.01, RACK_H + 0.48, 0);
  plumeProxyMesh.visible = false;
  plumeProxyMesh.layers.set(RAYCAST_LAYER);
  plumeProxyMesh.userData = { interactType: 'heat-flow', rackId };
  group.add(plumeProxyMesh);

  // 12. Cold-Aisle Front Intake Streamline Chevrons (for Smart Cooling legibility)
  const intakeStreamGroup = new THREE.Group();
  intakeStreamGroup.visible = false;
  const intakeStreamMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.55,
      roughness: 0.25,
      depthWrite: false,
    })
  );
  const intakeChevronGeo = track(new THREE.BoxGeometry(0.16, 0.018, 0.11));
  const intakeChevrons: THREE.Mesh[] = [];
  for (let c = 0; c < 3; c++) {
    const laneX = bayCenterX + (c - 1) * 0.23;
    const chev = new THREE.Mesh(intakeChevronGeo, intakeStreamMat);
    chev.userData = { laneX, phaseOffset: c * 0.33 };
    chev.position.set(laneX, 0.32, frontPlaneZ + 0.14);
    chev.renderOrder = 3;
    intakeStreamGroup.add(chev);
    intakeChevrons.push(chev);
  }
  group.add(intakeStreamGroup);

  // 13. Simplified invisible raycasting proxy box on RAYCAST_LAYER
  const proxyGeo = track(new THREE.BoxGeometry(RACK_W + 0.04, RACK_H, RACK_D + 0.04));
  const proxyMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const proxyMesh = new THREE.Mesh(proxyGeo, proxyMat);
  proxyMesh.position.set(0, RACK_H * 0.5, 0);
  proxyMesh.layers.set(RAYCAST_LAYER);
  proxyMesh.userData = { interactType: 'rack', rackId };
  group.add(proxyMesh);

  return {
    id: rackId,
    group,
    frameMat,
    sideMat,
    lightStripMat,
    bayWashMat,
    outlineMat,
    outlineMesh,
    obstructionBar,
    virtualSensorRing,
    trayGlowMats,
    trayLedMats,
    exhaustPlumeGroup,
    exhaustPlumeMat,
    plumeProxyMesh,
    intakeStreamGroup,
    intakeStreamMat,
    intakeChevrons,
    hoverBoost: 0,
  };
}

function createGroundCollar(
  halfW: number,
  halfD: number,
  track: <T extends { dispose: () => void }>(item: T) => T
): { outlineMat: THREE.MeshBasicMaterial; outlineMesh: THREE.Mesh } {
  const shape = new THREE.Shape();
  const ow = halfW + 0.095;
  const od = halfD + 0.095;
  shape.moveTo(-ow, -od);
  shape.lineTo(ow, -od);
  shape.lineTo(ow, od);
  shape.lineTo(-ow, od);
  shape.closePath();

  const hole = new THREE.Path();
  const iw = halfW + 0.036;
  const idp = halfD + 0.036;
  hole.moveTo(-iw, -idp);
  hole.lineTo(-iw, idp);
  hole.lineTo(iw, idp);
  hole.lineTo(iw, -idp);
  hole.closePath();
  shape.holes.push(hole);

  const outlineMat = track(
    new THREE.MeshBasicMaterial({
      color: 0x18181b,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const outlineMesh = new THREE.Mesh(track(new THREE.ShapeGeometry(shape)), outlineMat);
  outlineMesh.rotation.x = -Math.PI / 2;
  outlineMesh.position.set(0, 0.015, 0);
  outlineMesh.visible = false;
  return { outlineMat, outlineMesh };
}

/**
 * Builds the 3D THERMOS CORE autonomous intelligence pedestal (Front-Left plinth).
 */
export function createThermosCoreAssembly(
  res: SharedFacilityResources,
  enableShadows: boolean
): Core3DHandle {
  const track = <T extends { dispose: () => void }>(item: T): T => {
    res.disposables.push(item);
    return item;
  };

  const group = new THREE.Group();
  group.position.set(CORE_POS.x, 0, CORE_POS.z);

  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.5, 1.4)),
    track(
      new THREE.MeshBasicMaterial({
        map: res.contactShadowTex,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      })
    )
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.02, 0.005, 0.02);
  group.add(shadow);

  const bodyMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xb6bcc7,
      roughness: 0.36,
      metalness: 0.45,
      envMapIntensity: 0.5,
    })
  );
  const darkCollarMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x222834,
      roughness: 0.5,
      metalness: 0.55,
    })
  );
  const whiteDeckMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xf6f6f2,
      roughness: 0.25,
      metalness: 0.08,
    })
  );

  const basePedestal = new THREE.Mesh(track(new THREE.BoxGeometry(0.96, 0.34, 0.88)), bodyMat);
  basePedestal.position.set(0, 0.17, 0);
  basePedestal.castShadow = enableShadows;
  basePedestal.receiveShadow = enableShadows;
  addCrispEdges(basePedestal, res.edgeLineMat, track);

  const collar = new THREE.Mesh(track(new THREE.BoxGeometry(0.90, 0.06, 0.82)), darkCollarMat);
  collar.position.set(0, 0.36, 0);

  const topDeck = new THREE.Mesh(track(new THREE.BoxGeometry(0.94, 0.05, 0.86)), whiteDeckMat);
  topDeck.position.set(0, 0.415, 0);
  topDeck.castShadow = enableShadows;
  topDeck.receiveShadow = enableShadows;
  addCrispEdges(topDeck, res.edgeLineMat, track);
  group.add(basePedestal, collar, topDeck);

  const topTrimMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.75,
      roughness: 0.25,
    })
  );
  const ringMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.95,
      roughness: 0.2,
    })
  );
  const nodeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0066ff,
      emissiveIntensity: 1.05,
      roughness: 0.18,
    })
  );

  const band = new THREE.Mesh(track(new THREE.BoxGeometry(0.965, 0.026, 0.885)), topTrimMat);
  band.position.set(0, 0.38, 0);

  const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.25, 0.028, 14, 36)), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.452, 0);

  const centerNode = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.10, 0.115, 0.038, 24)),
    nodeMat
  );
  centerNode.position.set(0, 0.454, 0);

  group.add(band, ring, centerNode);

  const { outlineMat, outlineMesh } = createGroundCollar(0.48, 0.44, track);
  group.add(outlineMesh);

  const coreProxy = new THREE.Mesh(
    track(new THREE.BoxGeometry(1.16, 0.68, 1.08)),
    track(new THREE.MeshBasicMaterial({ visible: false }))
  );
  coreProxy.position.set(0, 0.34, 0);
  coreProxy.layers.set(RAYCAST_LAYER);
  coreProxy.userData = { interactType: 'thermos-core' };
  group.add(coreProxy);

  return { group, ringMat, nodeMat, topTrimMat, outlineMat, outlineMesh };
}

/**
 * Builds the 3D CRAH cooling plant (Rear-Left flank) + 3 recessed floor supply air plenums.
 */
export function createCrahAssembly(
  res: SharedFacilityResources,
  enableShadows: boolean
): Crah3DHandle {
  const track = <T extends { dispose: () => void }>(item: T): T => {
    res.disposables.push(item);
    return item;
  };

  const group = new THREE.Group();
  const { x, z, w, h, d } = CRAH_SPEC;

  const unitGroup = new THREE.Group();
  unitGroup.position.set(x, 0, z);
  group.add(unitGroup);

  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(w * 1.48, d * 1.48)),
    track(
      new THREE.MeshBasicMaterial({
        map: res.contactShadowTex,
        transparent: true,
        opacity: 0.74,
        depthWrite: false,
      })
    )
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.03, 0.005, 0.03);
  unitGroup.add(shadow);

  const chassisMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xbac0cb,
      roughness: 0.42,
      metalness: 0.38,
      envMapIntensity: 0.46,
    })
  );
  const sidePanelMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: res.sidePanelTex,
      bumpMap: res.sideBumpTex,
      bumpScale: 0.008,
      roughness: 0.56,
      metalness: 0.28,
    })
  );
  const darkTrimMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x313744,
      roughness: 0.55,
      metalness: 0.48,
    })
  );
  const pipeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x7e8798,
      roughness: 0.32,
      metalness: 0.68,
    })
  );

  const mainBox = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), chassisMat);
  mainBox.position.set(0, h * 0.5, 0);
  mainBox.castShadow = enableShadows;
  mainBox.receiveShadow = enableShadows;
  addCrispEdges(mainBox, res.edgeLineMat, track);
  unitGroup.add(mainBox);

  // Side service panels so CRAH looks detailed from 360 degrees
  const crahSideGeo = track(new THREE.BoxGeometry(0.02, h - 0.16, d - 0.18));
  const crahSideL = new THREE.Mesh(crahSideGeo, sidePanelMat);
  crahSideL.position.set(-w * 0.5 - 0.006, h * 0.5, 0);
  const crahSideR = new THREE.Mesh(crahSideGeo, sidePanelMat);
  crahSideR.position.set(w * 0.5 + 0.006, h * 0.5, 0);
  unitGroup.add(crahSideL, crahSideR);

  // Top return air plenum hood + dual fan grilles
  const hood = new THREE.Mesh(track(new THREE.BoxGeometry(w - 0.14, 0.14, d - 0.16)), darkTrimMat);
  hood.position.set(0, h + 0.07, 0);
  hood.castShadow = enableShadows;
  addCrispEdges(hood, res.edgeLineMat, track);
  unitGroup.add(hood);

  // Chilled-water manifold riser pipes
  const pipeGeo = track(new THREE.CylinderGeometry(0.048, 0.048, h * 0.88, 14));
  const supplyPipe = new THREE.Mesh(pipeGeo, pipeMat);
  supplyPipe.position.set(-w * 0.5 - 0.07, h * 0.44, -0.24);
  const returnPipe = new THREE.Mesh(pipeGeo, pipeMat);
  returnPipe.position.set(-w * 0.5 - 0.07, h * 0.44, 0.20);
  unitGroup.add(supplyPipe, returnPipe);

  // Front & Rear intake louver blades
  const louverGeo = track(new THREE.BoxGeometry(w - 0.22, 0.048, 0.036));
  for (let i = 0; i < 6; i++) {
    const bladeF = new THREE.Mesh(louverGeo, darkTrimMat);
    bladeF.position.set(0, 0.36 + i * 0.22, d * 0.5 + 0.01);
    bladeF.rotation.x = 0.22;
    const bladeB = new THREE.Mesh(louverGeo, darkTrimMat);
    bladeB.position.set(0, 0.36 + i * 0.22, -d * 0.5 - 0.01);
    bladeB.rotation.x = -0.22;
    unitGroup.add(bladeF, bladeB);
  }

  // CRAH THERMOS vertical indicator strip
  const stripMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.78,
      roughness: 0.22,
    })
  );
  const stripMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, h - 0.2, 0.032)), stripMat);
  stripMesh.position.set(w * 0.5 - 0.08, h * 0.5, d * 0.5 + 0.014);
  unitGroup.add(stripMesh);

  // 3 Recessed cold-air supply plenum tracks along the rack aisles
  const plenumTrackMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xcfd7e2,
      roughness: 0.65,
      metalness: 0.2,
    })
  );
  const plenumMats: THREE.MeshStandardMaterial[] = [];
  const plenumDashGroups: THREE.Group[] = [];
  const dashGeo = track(new THREE.BoxGeometry(0.28, 0.01, 0.042));

  for (let row = 0; row < 3; row++) {
    const pz = getRowAisleZ(row) - 0.21;
    const startX = x + w * 0.5;
    const endX = 3.65;
    const len = endX - startX;

    const trough = new THREE.Mesh(
      track(new THREE.BoxGeometry(len, 0.008, 0.08)),
      plenumTrackMat
    );
    trough.position.set((startX + endX) * 0.5, 0.004, pz);
    group.add(trough);

    const pMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        emissive: 0x0284c7,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.6,
        roughness: 0.35,
      })
    );
    plenumMats.push(pMat);

    const dashGroup = new THREE.Group();
    const dashCount = 10;
    for (let k = 0; k < dashCount; k++) {
      const dash = new THREE.Mesh(dashGeo, pMat);
      dash.userData = { baseOffset: k / dashCount, startX, endX };
      dash.position.set(startX + (k / dashCount) * len, 0.011, pz);
      dashGroup.add(dash);
    }
    group.add(dashGroup);
    plenumDashGroups.push(dashGroup);

    // Floor cold-aisle plenum raycast hit-strip for Smart Cooling inspection
    const plenumProxy = new THREE.Mesh(
      track(new THREE.BoxGeometry(len, 0.06, 0.22)),
      track(new THREE.MeshBasicMaterial({ visible: false }))
    );
    plenumProxy.position.set((startX + endX) * 0.5, 0.03, pz);
    plenumProxy.layers.set(RAYCAST_LAYER);
    plenumProxy.userData = { interactType: 'cooling' };
    group.add(plenumProxy);
  }

  const { outlineMat, outlineMesh } = createGroundCollar(w * 0.5, d * 0.5, track);
  unitGroup.add(outlineMesh);

  const crahProxy = new THREE.Mesh(
    track(new THREE.BoxGeometry(w + 0.16, h + 0.24, d + 0.16)),
    track(new THREE.MeshBasicMaterial({ visible: false }))
  );
  crahProxy.position.set(0, h * 0.5 + 0.1, 0);
  crahProxy.layers.set(RAYCAST_LAYER);
  crahProxy.userData = { interactType: 'cooling' };
  unitGroup.add(crahProxy);

  return { group, stripMat, plenumMats, plenumDashGroups, outlineMat, outlineMesh };
}

/**
 * Builds the 3D Waste-Heat Recovery & Seebeck TEG Module (Rear-Right flank, interactive from 360°).
 */
export function createHeatRecoveryAssembly(
  res: SharedFacilityResources,
  enableShadows: boolean
): Recovery3DHandle {
  const track = <T extends { dispose: () => void }>(item: T): T => {
    res.disposables.push(item);
    return item;
  };

  const group = new THREE.Group();
  const { x, z, w, h, d } = RECOVERY_SPEC;

  const skidGroup = new THREE.Group();
  skidGroup.position.set(x, 0, z);
  group.add(skidGroup);

  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(w * 1.48, d * 1.48)),
    track(
      new THREE.MeshBasicMaterial({
        map: res.contactShadowTex,
        transparent: true,
        opacity: 0.74,
        depthWrite: false,
      })
    )
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.03, 0.005, 0.03);
  skidGroup.add(shadow);

  const housingMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xbac0cb,
      roughness: 0.4,
      metalness: 0.40,
      envMapIntensity: 0.46,
    })
  );
  const sidePanelMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: res.sidePanelTex,
      bumpMap: res.sideBumpTex,
      bumpScale: 0.008,
      roughness: 0.56,
      metalness: 0.28,
    })
  );
  const darkCoreMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x262c38,
      roughness: 0.52,
      metalness: 0.55,
    })
  );
  const finMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x526071,
      emissive: 0x059669,
      emissiveIntensity: 0.2,
      roughness: 0.34,
      metalness: 0.62,
    })
  );

  // Main skid housing + crisp CAD edges
  const mainBody = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), housingMat);
  mainBody.position.set(0, h * 0.5, 0);
  mainBody.castShadow = enableShadows;
  mainBody.receiveShadow = enableShadows;
  addCrispEdges(mainBody, res.edgeLineMat, track);
  skidGroup.add(mainBody);

  // Side recessed service panels (visible from right/rear orbit angles!)
  const recSideGeo = track(new THREE.BoxGeometry(0.02, h - 0.16, d - 0.20));
  const recSideL = new THREE.Mesh(recSideGeo, sidePanelMat);
  recSideL.position.set(-w * 0.5 - 0.006, h * 0.5, 0);
  const recSideR = new THREE.Mesh(recSideGeo, sidePanelMat);
  recSideR.position.set(w * 0.5 + 0.006, h * 0.5, 0);
  skidGroup.add(recSideL, recSideR);

  // Seebeck TEG top solid-state manifold block + dual heat-pipe headers
  const tegBlock = new THREE.Mesh(
    track(new THREE.BoxGeometry(w - 0.22, 0.16, d - 0.24)),
    darkCoreMat
  );
  tegBlock.position.set(0, h + 0.08, 0);
  tegBlock.castShadow = enableShadows;
  addCrispEdges(tegBlock, res.edgeLineMat, track);
  skidGroup.add(tegBlock);

  // Stacked heat-exchanger fin plates on BOTH front (+Z) and rear (-Z) faces
  const finGeo = track(new THREE.BoxGeometry(w - 0.20, 0.044, 0.042));
  for (let i = 0; i < 5; i++) {
    const finF = new THREE.Mesh(finGeo, finMat);
    finF.position.set(0, 0.34 + i * 0.23, d * 0.5 + 0.012);
    const finB = new THREE.Mesh(finGeo, finMat);
    finB.position.set(0, 0.34 + i * 0.23, -d * 0.5 - 0.012);
    skidGroup.add(finF, finB);
  }

  // Status indicator bar
  const stripMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x059669,
      emissive: 0x059669,
      emissiveIntensity: 0.85,
      roughness: 0.22,
    })
  );
  const strip = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, h - 0.2, 0.032)), stripMat);
  strip.position.set(-w * 0.5 + 0.08, h * 0.5, d * 0.5 + 0.014);
  skidGroup.add(strip);

  // Exhaust thermal recovery pipe connecting rack array to Heat Recovery skid
  const aisleMidZ = getRowAisleZ(1);
  const pipePoints = [
    new THREE.Vector3(3.65, 0.055, aisleMidZ),
    new THREE.Vector3(x - w * 0.35, 0.055, aisleMidZ),
    new THREE.Vector3(x - w * 0.35, 0.055, z + d * 0.5),
  ];
  const pipeCurve = new THREE.CatmullRomCurve3(pipePoints, false, 'catmullrom', 0.08);
  const pipeGeo = track(new THREE.TubeGeometry(pipeCurve, 28, 0.044, 10, false));
  const pipeGlowMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x9aa3b2,
      emissive: 0x059669,
      emissiveIntensity: 0.35,
      roughness: 0.38,
      metalness: 0.55,
    })
  );
  const pipeMesh = new THREE.Mesh(pipeGeo, pipeGlowMat);
  group.add(pipeMesh);

  // --- DUAL-OUTPUT BIFURCATION ON RIGHT-FLANK RECOVERY SKID ---
  // PATH A: Useful Thermal Energy Recovery (Insulated Hydronic Export Loop -> Building Heating Header)
  const pathAPts = getPathAThermalExportPoints3D().map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const pathACurve = new THREE.CatmullRomCurve3(pathAPts, false, 'catmullrom', 0.08);
  const pathAPipeGeo = track(new THREE.TubeGeometry(pathACurve, 26, 0.042, 10, false));
  const pathAPipeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x9aa3b2,
      emissive: 0x059669,
      emissiveIntensity: 0.32,
      roughness: 0.34,
      metalness: 0.56,
    })
  );
  const pathAPipeMesh = new THREE.Mesh(pathAPipeGeo, pathAPipeMat);
  group.add(pathAPipeMesh);

  // Path A Building Heating Terminal Header Box grounded at rear-right plinth edge
  const pathAEnd = pathAPts[pathAPts.length - 1];
  const pathAHeaderMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xbac0cb,
      emissive: 0x059669,
      emissiveIntensity: 0.25,
      roughness: 0.42,
      metalness: 0.45,
    })
  );
  const pathAHeader = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.34, 0.24, 0.26)),
    pathAHeaderMat
  );
  pathAHeader.position.set(pathAEnd.x, 0.12, pathAEnd.z);
  pathAHeader.castShadow = enableShadows;
  addCrispEdges(pathAHeader, res.edgeLineMat, track);
  group.add(pathAHeader);

  // Pool of 6 reusable Path A Thermal Export Capsules (warm amber-to-emerald kW_th pulses)
  const pathAPulseGeo = track(new THREE.SphereGeometry(0.056, 12, 10));
  const pathAHaloGeo = track(new THREE.PlaneGeometry(0.20, 0.28));
  const pathAPulsePool: PulseCapsuleHandle[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 1.3,
        roughness: 0.18,
      })
    );
    const haloMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
    );
    const mesh = new THREE.Mesh(pathAPulseGeo, mat);
    mesh.scale.set(1, 0.85, 1.35);
    mesh.visible = false;
    const haloMesh = new THREE.Mesh(pathAHaloGeo, haloMat);
    haloMesh.rotation.x = -Math.PI / 2;
    mesh.add(haloMesh);
    group.add(mesh);
    pathAPulsePool.push({ mesh, haloMesh, mat, haloMat });
  }

  // PATH B: Auxiliary Seebeck TEG Electricity (Solid-State Junction -> Sensor & Valve Bus)
  const pathBPts = getPathBTegAuxPoints3D();
  const pathBTerminalMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x0066ff,
      emissiveIntensity: 0.55,
      roughness: 0.32,
      metalness: 0.52,
    })
  );
  // Front-right Seebeck TEG solid-state DC junction housing on the skid face
  const tegTerminal = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.22, 0.26, 0.08)),
    pathBTerminalMat
  );
  tegTerminal.position.set(w * 0.28, 0.28, d * 0.5 + 0.02);
  addCrispEdges(tegTerminal, res.edgeLineMat, track);
  skidGroup.add(tegTerminal);

  const pathBChannelMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x6f7787,
      roughness: 0.48,
      metalness: 0.45,
    })
  );
  const pathBStripMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.55,
      roughness: 0.22,
    })
  );
  // Vertical armoured riser from TEG terminal down to plinth floor channel
  const riserGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 0.28, 10));
  const riserMesh = new THREE.Mesh(riserGeo, pathBChannelMat);
  riserMesh.position.set(pathBPts[0].x, 0.14, pathBPts[0].z + 0.02);
  group.add(riserMesh);

  // Recessed floor low-voltage auxiliary bus segments back into rack sensor network
  addFloorSegment(
    group,
    { x: pathBPts[0].x, y: 0, z: pathBPts[0].z + 0.02 },
    { x: pathBPts[1].x, y: 0, z: pathBPts[1].z },
    pathBChannelMat,
    pathBStripMat,
    0.085,
    0.038,
    track
  );
  addFloorSegment(
    group,
    { x: pathBPts[1].x, y: 0, z: pathBPts[1].z },
    { x: pathBPts[2].x, y: 0, z: pathBPts[2].z },
    pathBChannelMat,
    pathBStripMat,
    0.085,
    0.038,
    track
  );
  addFloorSegment(
    group,
    { x: pathBPts[2].x, y: 0, z: pathBPts[2].z },
    { x: pathBPts[3].x, y: 0, z: pathBPts[3].z },
    pathBChannelMat,
    pathBStripMat,
    0.085,
    0.038,
    track
  );

  // Pool of 6 reusable Path B Auxiliary Electric Micro-Pulses (cobalt low-power W pulses)
  const pathBPulseGeo = track(new THREE.BoxGeometry(0.048, 0.022, 0.18));
  const pathBHaloGeo = track(new THREE.PlaneGeometry(0.16, 0.30));
  const pathBPulsePool: PulseCapsuleHandle[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0066ff,
        emissiveIntensity: 1.35,
        roughness: 0.15,
      })
    );
    const haloMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x0066ff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    const mesh = new THREE.Mesh(pathBPulseGeo, mat);
    mesh.visible = false;
    const haloMesh = new THREE.Mesh(pathBHaloGeo, haloMat);
    haloMesh.rotation.x = -Math.PI / 2;
    haloMesh.position.y = -0.006;
    mesh.add(haloMesh);
    group.add(mesh);
    pathBPulsePool.push({ mesh, haloMesh, mat, haloMat });
  }

  const { outlineMat, outlineMesh } = createGroundCollar(w * 0.5, d * 0.5, track);
  skidGroup.add(outlineMesh);

  // Invisible raycast proxies on skid, Path A building heating header, and Path B TEG bus
  const proxyMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const proxy = new THREE.Mesh(
    track(new THREE.BoxGeometry(w + 0.14, h + 0.24, d + 0.14)),
    proxyMat
  );
  proxy.position.set(0, h * 0.5 + 0.1, 0);
  proxy.layers.set(RAYCAST_LAYER);
  proxy.userData = { interactType: 'recovery' };
  skidGroup.add(proxy);

  const pathAProxy = new THREE.Mesh(track(new THREE.BoxGeometry(0.65, 0.42, 1.45)), proxyMat);
  pathAProxy.position.set(pathAEnd.x, 0.2, (z - d * 0.5 + pathAEnd.z) * 0.5);
  pathAProxy.layers.set(RAYCAST_LAYER);
  pathAProxy.userData = { interactType: 'recovery' };
  group.add(pathAProxy);

  const pathBProxy = new THREE.Mesh(track(new THREE.BoxGeometry(1.15, 0.14, 1.35)), proxyMat);
  pathBProxy.position.set((pathBPts[0].x + pathBPts[2].x) * 0.5, 0.06, (pathBPts[0].z + pathBPts[1].z) * 0.5);
  pathBProxy.layers.set(RAYCAST_LAYER);
  pathBProxy.userData = { interactType: 'recovery' };
  group.add(pathBProxy);

  return {
    group,
    stripMat,
    finMat,
    pipeGlowMat,
    pathAPipeMat,
    pathAHeaderMat,
    pathAPulsePool,
    pathBStripMat,
    pathBTerminalMat,
    pathBPulsePool,
    outlineMat,
    outlineMesh,
  };
}

/**
 * Helper to create a recessed 3D dark-bezel floor channel + inner optical light bar.
 */
function addFloorSegment(
  parent: THREE.Group,
  a: Vec3Tuple,
  b: Vec3Tuple,
  channelMat: THREE.MeshStandardMaterial,
  lightMat: THREE.MeshStandardMaterial,
  channelWidth: number,
  lightWidth: number,
  track: <T extends { dispose: () => void }>(item: T) => T
): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-4) return;
  const cx = (a.x + b.x) * 0.5;
  const cz = (a.z + b.z) * 0.5;
  const angle = Math.atan2(dx, dz);

  // Recessed dark anodized housing trough for unmistakable physical depth
  const troughGeo = track(new THREE.BoxGeometry(channelWidth, 0.014, len + channelWidth * 0.45));
  const trough = new THREE.Mesh(troughGeo, channelMat);
  trough.position.set(cx, 0.007, cz);
  trough.rotation.y = angle;
  parent.add(trough);

  // Physical illuminated optical diffuser strip set inside the trough
  const stripGeo = track(new THREE.BoxGeometry(lightWidth, 0.018, len + lightWidth * 0.25));
  const strip = new THREE.Mesh(stripGeo, lightMat);
  strip.position.set(cx, 0.016, cz);
  strip.rotation.y = angle;
  parent.add(strip);
}

/**
 * Builds the physical 3D recessed floor light-strip network, junction pucks,
 * reusable pulse capsules, workload packet capsules, and R07 spatial k-NN sensor arcs.
 */
export function createFloorConduitNetwork(
  res: SharedFacilityResources,
  adjacentR07: number[]
): ConduitNetworkHandle {
  const track = <T extends { dispose: () => void }>(item: T): T => {
    res.disposables.push(item);
    return item;
  };

  const group = new THREE.Group();

  // Dark gunmetal recessed floor conduit housing so blue & green light strips pop cleanly on off-white tiles
  const channelMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x6f7787,
      roughness: 0.48,
      metalness: 0.45,
      envMapIntensity: 0.4,
    })
  );

  // 1. Main Left Spine (from CRAH front to THERMOS CORE)
  const spineStripMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    })
  );
  addFloorSegment(
    group,
    { x: SPINE_X, y: 0, z: CRAH_SPEC.z + CRAH_SPEC.d * 0.5 - 0.1 },
    { x: CORE_POS.x, y: 0, z: CORE_POS.z },
    channelMat,
    spineStripMat,
    0.16,
    0.082,
    track
  );
  addFloorSegment(
    group,
    { x: SPINE_X, y: 0, z: CRAH_SPEC.z + CRAH_SPEC.d * 0.5 + 0.18 },
    { x: CRAH_SPEC.x + CRAH_SPEC.w * 0.5 - 0.08, y: 0, z: CRAH_SPEC.z + CRAH_SPEC.d * 0.5 + 0.18 },
    channelMat,
    spineStripMat,
    0.12,
    0.058,
    track
  );

  // 2. Three Row Aisle Conduits + Junction Pucks
  const rowStripMats: THREE.MeshStandardMaterial[] = [];
  const rowJunctionMats: THREE.MeshStandardMaterial[] = [];
  const jPuckGeo = track(new THREE.CylinderGeometry(0.11, 0.118, 0.028, 20));
  const jCapGeo = track(new THREE.CylinderGeometry(0.068, 0.068, 0.034, 18));

  for (let row = 0; row < 3; row++) {
    const az = getRowAisleZ(row);
    const rowMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x0066ff,
        emissive: 0x0066ff,
        emissiveIntensity: 0.65,
        roughness: 0.22,
      })
    );
    rowStripMats.push(rowMat);

    addFloorSegment(
      group,
      { x: SPINE_X, y: 0, z: az },
      { x: RECOVERY_COLLECTOR_X, y: 0, z: az },
      channelMat,
      rowMat,
      0.135,
      0.068,
      track
    );

    const puck = new THREE.Mesh(jPuckGeo, channelMat);
    puck.position.set(SPINE_X, 0.014, az);
    const jMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x0066ff,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      })
    );
    const cap = new THREE.Mesh(jCapGeo, jMat);
    cap.position.set(SPINE_X, 0.018, az);
    group.add(puck, cap);
    rowJunctionMats.push(jMat);
  }

  // 2b. Right-Flank Hydronic Heat-Recovery Collector Conduit connecting row aisles to Heat Recovery Skid
  const recoveryCollectorMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x64748b,
      emissive: 0x334155,
      emissiveIntensity: 0.16,
      roughness: 0.22,
    })
  );
  const row0Z = getRowAisleZ(0);
  const row1Z = getRowAisleZ(1);
  const row2Z = getRowAisleZ(2);
  const recIntakeX = RECOVERY_SPEC.x - RECOVERY_SPEC.w * 0.35;
  const recIntakeZ = RECOVERY_SPEC.z + RECOVERY_SPEC.d * 0.5 + 0.02;

  addFloorSegment(
    group,
    { x: RECOVERY_COLLECTOR_X, y: 0, z: row0Z },
    { x: RECOVERY_COLLECTOR_X, y: 0, z: row2Z },
    channelMat,
    recoveryCollectorMat,
    0.135,
    0.068,
    track
  );
  addFloorSegment(
    group,
    { x: RECOVERY_COLLECTOR_X, y: 0, z: row1Z },
    { x: recIntakeX, y: 0, z: row1Z },
    channelMat,
    recoveryCollectorMat,
    0.13,
    0.064,
    track
  );
  addFloorSegment(
    group,
    { x: recIntakeX, y: 0, z: row1Z },
    { x: recIntakeX, y: 0, z: recIntakeZ },
    channelMat,
    recoveryCollectorMat,
    0.13,
    0.064,
    track
  );
  for (const rz of [row0Z, row1Z, row2Z]) {
    const rPuck = new THREE.Mesh(jPuckGeo, channelMat);
    rPuck.position.set(RECOVERY_COLLECTOR_X, 0.014, rz);
    const rCap = new THREE.Mesh(jCapGeo, recoveryCollectorMat);
    rCap.position.set(RECOVERY_COLLECTOR_X, 0.018, rz);
    group.add(rPuck, rCap);
  }

  // 3. Twelve Rack Tap Branches
  const branches: ConduitBranchHandle[] = [];
  const tapNodeGeo = track(new THREE.CylinderGeometry(0.064, 0.07, 0.028, 16));

  for (let i = 0; i < 12; i++) {
    const p = getRackPlacement3D(i);
    const tapStripMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x0066ff,
        emissive: 0x0066ff,
        emissiveIntensity: 0.55,
        roughness: 0.22,
      })
    );
    addFloorSegment(
      group,
      { x: p.tapX, y: 0, z: p.aisleZ },
      { x: p.tapX, y: 0, z: p.frontZ + 0.01 },
      channelMat,
      tapStripMat,
      0.11,
      0.054,
      track
    );

    const tapNodeMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x0066ff,
        emissive: 0x0066ff,
        emissiveIntensity: 0.85,
        roughness: 0.2,
      })
    );
    const tapNode = new THREE.Mesh(tapNodeGeo, tapNodeMat);
    tapNode.position.set(p.tapX, 0.016, p.aisleZ);
    group.add(tapNode);

    branches.push({ tapStripMat, tapNodeMat });
  }

  // 4. Pool of 38 reusable 3D optical light-pulses
  const pulseGeo = track(new THREE.BoxGeometry(0.072, 0.028, 0.28));
  const pulseHaloGeo = track(new THREE.PlaneGeometry(0.26, 0.48));
  const pulsePool: PulseCapsuleHandle[] = [];

  for (let i = 0; i < 38; i++) {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0066ff,
        emissiveIntensity: 1.35,
        roughness: 0.15,
      })
    );
    const haloMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x0066ff,
        transparent: true,
        opacity: 0.30,
        depthWrite: false,
      })
    );
    const mesh = new THREE.Mesh(pulseGeo, mat);
    mesh.visible = false;
    const haloMesh = new THREE.Mesh(pulseHaloGeo, haloMat);
    haloMesh.rotation.x = -Math.PI / 2;
    haloMesh.position.y = -0.008;
    mesh.add(haloMesh);
    group.add(mesh);
    pulsePool.push({ mesh, haloMesh, mat, haloMat });
  }

  // 5. Pool of 16 reusable 3D emerald workload-transfer packets
  const pktGeo = track(new THREE.SphereGeometry(0.078, 16, 12));
  const pktHaloGeo = track(new THREE.RingGeometry(0.088, 0.165, 20));
  const packetPool: PulseCapsuleHandle[] = [];

  for (let i = 0; i < 16; i++) {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 1.4,
        roughness: 0.15,
      })
    );
    const haloMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const mesh = new THREE.Mesh(pktGeo, mat);
    mesh.scale.set(1, 0.65, 1.35);
    mesh.visible = false;
    mesh.layers.enable(RAYCAST_LAYER);
    mesh.userData = { interactType: 'compute-flow' };
    const haloMesh = new THREE.Mesh(pktHaloGeo, haloMat);
    haloMesh.rotation.x = -Math.PI / 2;
    haloMesh.position.y = -0.02;
    mesh.add(haloMesh);
    group.add(mesh);
    packetPool.push({ mesh, haloMesh, mat, haloMat });
  }

  // Invisible raycast hit-volumes along ComputeFlow spine/aisle conduits and HeatFlow collector conduits
  const conduitProxyMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const addFloorHitSegment = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    hitWidth: number,
    interactType: 'compute-flow' | 'heat-flow'
  ) => {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len <= 1e-3) return;
    const hitMesh = new THREE.Mesh(
      track(new THREE.BoxGeometry(hitWidth, 0.075, len + 0.08)),
      conduitProxyMat
    );
    hitMesh.position.set((ax + bx) * 0.5, 0.038, (az + bz) * 0.5);
    hitMesh.rotation.y = Math.atan2(dx, dz);
    hitMesh.layers.set(RAYCAST_LAYER);
    hitMesh.userData = { interactType };
    group.add(hitMesh);
  };

  // ComputeFlow spine & 3 row compute buses
  addFloorHitSegment(
    SPINE_X,
    CRAH_SPEC.z + CRAH_SPEC.d * 0.5 + 0.12,
    CORE_POS.x,
    CORE_POS.z - 0.55,
    0.34,
    'compute-flow'
  );
  for (let row = 0; row < 3; row++) {
    const az = getRowAisleZ(row);
    addFloorHitSegment(SPINE_X, az, RECOVERY_COLLECTOR_X - 0.32, az, 0.26, 'compute-flow');
  }

  // HeatFlow right-flank hydronic collector & intake pipe run
  addFloorHitSegment(RECOVERY_COLLECTOR_X, row0Z, RECOVERY_COLLECTOR_X, row2Z, 0.36, 'heat-flow');
  addFloorHitSegment(RECOVERY_COLLECTOR_X, row1Z, recIntakeX, row1Z, 0.34, 'heat-flow');
  addFloorHitSegment(recIntakeX, row1Z, recIntakeX, recIntakeZ + 0.12, 0.34, 'heat-flow');

  // 6. R07 Offline Spatial k-NN Sensor Estimation 3D Arches
  const knnGroup = new THREE.Group();
  knnGroup.visible = false;
  const knnTubeMats: THREE.MeshStandardMaterial[] = [];
  const pR07 = getRackPlacement3D(6);

  for (const nbrIdx of adjacentR07) {
    const pNbr = getRackPlacement3D(nbrIdx);
    const midX = (pNbr.x + pR07.x) * 0.5;
    const midZ = (pNbr.z + pR07.z) * 0.5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(pNbr.x, RACK_H + 0.05, pNbr.z),
      new THREE.Vector3(midX, RACK_H + 0.46, midZ),
      new THREE.Vector3(pR07.x, RACK_H + 0.11, pR07.z),
    ]);
    const tubeGeo = track(new THREE.TubeGeometry(curve, 24, 0.016, 8, false));
    const tubeMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0066ff,
        emissiveIntensity: 1.0,
        transparent: true,
        opacity: 0.82,
        roughness: 0.2,
      })
    );
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    knnGroup.add(tubeMesh);
    knnTubeMats.push(tubeMat);
  }
  group.add(knnGroup);

  return {
    group,
    spineStripMat,
    recoveryCollectorMat,
    rowStripMats,
    rowJunctionMats,
    branches,
    pulsePool,
    packetPool,
    knnGroup,
    knnTubeMats,
  };
}
