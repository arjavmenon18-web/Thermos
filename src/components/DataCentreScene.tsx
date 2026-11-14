import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import type {
  ThermosConfig,
  StepRecord,
  GlobalFacilityState,
  FacilityIncident,
  FacilityViewMode,
} from '../simulation/types';
import type { PathwayPanelKind } from './ThermosCorePanel';
import type { HighlightedPathways } from '../simulation/explanationEngine';
import type { AnimatedTransferPacket } from '../hooks/useSimulation';
import type { ViewportInfo } from '../hooks/useViewport';
import * as E from '../simulation/engine';
import {
  RACK_D,
  RACK_H,
  SPINE_X,
  RECOVERY_COLLECTOR_X,
  CORE_POS,
  CRAH_SPEC,
  RECOVERY_SPEC,
  CAMERA_PRESETS_BY_VIEW,
  PATH_A_LABEL_ANCHOR,
  PATH_B_LABEL_ANCHOR,
  getAspectAdjustedCameraPreset,
  getAspectCameraDistanceLimits,
  getRackPlacement3D,
  getRowAisleZ,
  getCoreToRackPoints3D,
  getRackToRackPoints3D,
  getRackToRecoveryPoints3D,
  getPathAThermalExportPoints3D,
  getPathBTegAuxPoints3D,
  samplePolyline3D,
  clampCameraTarget,
  Vec3Tuple,
  CameraPreset3D,
} from './three/dcLayout';
import {
  RAYCAST_LAYER,
  createSharedFacilityResources,
  createPlinthAssembly,
  createRackAssembly,
  createThermosCoreAssembly,
  createCrahAssembly,
  createHeatRecoveryAssembly,
  createFloorConduitNetwork,
  Rack3DHandle,
} from './three/dcMaterialsAndRack';

export type VisualMode = 'thermal' | 'airflow' | 'workload' | 'normal';

export type ActiveContextualTarget =
  | 'none'
  | 'rack'
  | 'core'
  | 'incident'
  | 'compute'
  | 'heat'
  | 'recovery'
  | 'cooling'
  | 'sim-controls';

interface DataCentreSceneProps {
  temps: number[];
  loads: number[];
  predictions: number[];
  uncertainties: number[];
  activeSensors: number[];
  config: ThermosConfig;
  selectedRackId: number | null;
  onSelectRack: (id: number | null) => void;
  selectedIncidentId: string | null;
  onSelectIncident: (id: string | null) => void;
  revealTruth: boolean;
  minute: number;
  visualMode?: VisualMode;
  viewMode?: FacilityViewMode;
  activeContextualTarget?: ActiveContextualTarget;
  onSelectCore: () => void;
  onSelectPathway: (kind: PathwayPanelKind) => void;
  onOpenResults?: () => void;
  onCanvasBackgroundClick: () => void;
  cameraPresetOverride?: CameraPreset3D | null;
  currentRecord: StepRecord | null;
  facility: GlobalFacilityState;
  activeWorkloadPackets: AnimatedTransferPacket[];
  viewport?: ViewportInfo;
  hasActiveMobileSheet?: boolean;
  connectedRackIds?: number[];
  highlightedPathways?: HighlightedPathways;
}

type BranchColorState = 'idle' | 'blue' | 'green' | 'monitoring' | 'escalated';

// Pre-allocated module-scope scratch math objects (zero GC in render loop)
const _projVec = new THREE.Vector3();
const _camOffset = new THREE.Vector3();
const _targetBeforeClamp = new THREE.Vector3();
const _curSpherical = new THREE.Spherical();
const _goalSpherical = new THREE.Spherical();
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();

// Precomputed static 3D floor pathways for all 12 racks, 3 row aisles, and hydronic recovery collector
const STATIC_CORE_TO_RACK_PATHS: Vec3Tuple[][] = Array.from({ length: E.N }, (_, i) =>
  getCoreToRackPoints3D(i, 0.026)
);
const STATIC_RACK_TO_RECOVERY_PATHS: Vec3Tuple[][] = Array.from({ length: E.N }, (_, i) =>
  getRackToRecoveryPoints3D(i, 0.030)
);
const STATIC_ROW_SCAN_PATHS: Vec3Tuple[][] = [0, 1, 2].map((row) => [
  { x: -3.35, y: 0.026, z: getRowAisleZ(row) },
  { x: 3.55, y: 0.026, z: getRowAisleZ(row) },
]);
const STATIC_PATH_A_EXPORT_PATH: Vec3Tuple[] = getPathAThermalExportPoints3D();
const STATIC_PATH_B_TEG_AUX_PATH: Vec3Tuple[] = getPathBTegAuxPoints3D();

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const DataCentreScene: React.FC<DataCentreSceneProps> = ({
  config,
  selectedRackId,
  onSelectRack,
  selectedIncidentId,
  onSelectIncident,
  revealTruth,
  viewMode = 'facility',
  activeContextualTarget = 'none',
  onSelectCore,
  onSelectPathway,
  onOpenResults,
  onCanvasBackgroundClick,
  cameraPresetOverride = null,
  currentRecord,
  facility,
  activeWorkloadPackets,
  viewport,
  hasActiveMobileSheet = false,
  connectedRackIds,
  highlightedPathways,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const overlayBoundsRef = useRef<HTMLDivElement | null>(null);
  const rackBadgeRefs = useRef<Array<HTMLDivElement | null>>([]);
  const crahBadgeRef = useRef<HTMLDivElement | null>(null);
  const recoveryBadgeRef = useRef<HTMLDivElement | null>(null);
  const pathABadgeRef = useRef<HTMLDivElement | null>(null);
  const pathBBadgeRef = useRef<HTMLDivElement | null>(null);
  const coreBadgeRef = useRef<HTMLDivElement | null>(null);
  const computePathBadgeRef = useRef<HTMLButtonElement | null>(null);
  const heatPathBadgeRef = useRef<HTMLButtonElement | null>(null);

  const [contextLost, setContextLost] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const isMobile = viewport?.isMobile ?? false;
  const isExtraNarrow = viewport?.isExtraNarrow ?? false;
  const isCoarsePointer = viewport?.isCoarsePointer ?? false;

  const thermos = facility.thermos;
  const visualState = thermos.visualState;

  const selectedIncident: FacilityIncident | null = useMemo(() => {
    if (!selectedIncidentId) return null;
    return facility.activeIncidents.find((i) => i.id === selectedIncidentId) ?? null;
  }, [selectedIncidentId, facility.activeIncidents]);

  const incidentHighlightedRacks = useMemo(() => {
    if (!selectedIncident || selectedIncident.affectedRacks.length > 8) return new Set<number>();
    return new Set(selectedIncident.affectedRacks);
  }, [selectedIncident]);

  const branchStates = useMemo(() => {
    const map = new Map<number, BranchColorState>();
    for (let i = 0; i < E.N; i++) {
      const r = facility.racks[i];
      if (!r) {
        map.set(i, 'idle');
        continue;
      }
      if (
        visualState === 'INTERVENING' &&
        (thermos.interveningRacks.includes(i) || thermos.receivingRacks.includes(i))
      ) {
        map.set(i, 'green');
      } else if (
        visualState === 'RESOLVED' &&
        facility.lastVerifiedOutcome?.targetedRacks.includes(i)
      ) {
        map.set(i, 'green');
      } else if (
        r.thermosBranchState === 'GREEN_INTERVENING' ||
        r.thermosBranchState === 'GREEN_RECEIVING'
      ) {
        map.set(i, 'green');
      } else if (r.thermosBranchState === 'MONITORING') {
        map.set(i, 'monitoring');
      } else if (r.thermosBranchState === 'ESCALATED') {
        map.set(i, 'escalated');
      } else if (
        thermos.inspectedRacks.includes(i) ||
        r.thermosBranchState === 'BLUE_COORDINATING' ||
        r.thermosBranchState === 'BLUE_SENSING'
      ) {
        map.set(i, 'blue');
      } else {
        map.set(i, 'idle');
      }
    }
    return map;
  }, [facility.racks, facility.lastVerifiedOutcome, thermos, visualState]);

  // Mutable ref bridge so Three.js loop reads latest simulation state without re-creating WebGLRenderer
  const liveRef = useRef({
    facility,
    currentRecord,
    config,
    viewMode,
    activeContextualTarget,
    selectedRackId,
    incidentHighlightedRacks,
    connectedRackSet: new Set<number>(),
    highlightedPathways: undefined as HighlightedPathways | undefined,
    branchStates,
    activeWorkloadPackets,
    onSelectRack,
    onSelectCore,
    onSelectPathway,
    onCanvasBackgroundClick,
  });
  const connectedRackSet = useMemo(
    () => new Set<number>(connectedRackIds ?? []),
    [connectedRackIds]
  );

  liveRef.current = {
    facility,
    currentRecord,
    config,
    viewMode,
    activeContextualTarget,
    selectedRackId,
    incidentHighlightedRacks,
    connectedRackSet,
    highlightedPathways,
    branchStates,
    activeWorkloadPackets,
    onSelectRack,
    onSelectCore,
    onSelectPathway,
    onCanvasBackgroundClick,
  };

  // Smooth camera transition controller ref (for View Mode glides, Zoom In / Out / Reset Camera)
  const cameraActionRef = useRef<{
    zoomFactor: ((factor: number) => void) | null;
    resetView: (() => void) | null;
    glideTo: ((preset: CameraPreset3D) => void) | null;
  }>({ zoomFactor: null, resetView: null, glideTo: null });

  const handleZoomIn = useCallback(() => {
    cameraActionRef.current.zoomFactor?.(0.84);
  }, []);

  const handleZoomOut = useCallback(() => {
    cameraActionRef.current.zoomFactor?.(1.18);
  }, []);

  const activeBasePreset = cameraPresetOverride ?? CAMERA_PRESETS_BY_VIEW[viewMode];
  const activeBasePresetRef = useRef<CameraPreset3D>(activeBasePreset);
  activeBasePresetRef.current = activeBasePreset;

  const handleResetCamera = useCallback(() => {
    cameraActionRef.current.glideTo?.(activeBasePreset);
  }, [activeBasePreset]);

  // Gently glide 3D camera whenever observation viewMode or tour camera preset changes
  const isInitialMountRef = useRef(true);
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    cameraActionRef.current.glideTo?.(activeBasePreset);
  }, [activeBasePreset]);

  // Mount Three.js 3D Digital Twin once
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const isSoftwareGl = detectSoftwareWebGL();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = Math.max(1, mountEl.clientWidth);
    const initH = Math.max(1, mountEl.clientHeight);
    renderer.setSize(initW, initH);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    mountEl.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f7f2);
    scene.fog = new THREE.Fog(0xf7f7f2, 28, 72);

    // Procedural Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const initAspect = initW / initH;
    const initAdjusted = getAspectAdjustedCameraPreset(activeBasePresetRef.current, initAspect);
    const initLimits = getAspectCameraDistanceLimits(initAspect);

    // Elevated three-quarter architectural telephoto perspective camera
    const camera = new THREE.PerspectiveCamera(29, initAspect, 0.2, 95);
    camera.position.set(initAdjusted.pos.x, initAdjusted.pos.y, initAdjusted.pos.z);
    camera.lookAt(initAdjusted.target.x, initAdjusted.target.y, initAdjusted.target.z);

    // Interactive 3D OrbitControls (Rotate, Zoom, Pan with controlled limits)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(
      initAdjusted.target.x,
      initAdjusted.target.y,
      initAdjusted.target.z
    );
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.78;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.8;
    // Prevent extreme camera angles (no going underground or flipping upside down)
    controls.minPolarAngle = 0.24;
    controls.maxPolarAngle = Math.PI * 0.455;
    controls.minDistance = initLimits.minDistance;
    controls.maxDistance = initLimits.maxDistance;
    controls.update();

    // Balanced 3-Point Warm/Cool Engineering Laboratory Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xf2f6ff, 0xc4c7be, 0.62);
    hemiLight.position.set(0, 18, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbf2, 1.38);
    keyLight.position.set(9.5, 15.5, 10.5);
    keyLight.target.position.set(0.3, 0.5, 0.1);
    scene.add(keyLight.target);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      const sd = 7.4;
      keyLight.shadow.camera.left = -sd;
      keyLight.shadow.camera.right = sd;
      keyLight.shadow.camera.top = sd;
      keyLight.shadow.camera.bottom = -sd;
      keyLight.shadow.camera.near = 2;
      keyLight.shadow.camera.far = 34;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdce8ff, 0.48);
    rimLight.position.set(-9.0, 9.5, -9.5);
    scene.add(rimLight);

    // Build Shared Procedural Textures & 3D Facility Assemblies
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const sharedRes = createSharedFacilityResources(maxAniso);

    const plinthGroup = createPlinthAssembly(sharedRes, !isSoftwareGl);
    scene.add(plinthGroup);

    const rackHandles: Rack3DHandle[] = [];
    for (let i = 0; i < E.N; i++) {
      const rackHandle = createRackAssembly(i, sharedRes, !isSoftwareGl);
      scene.add(rackHandle.group);
      rackHandles.push(rackHandle);
    }

    const coreHandle = createThermosCoreAssembly(sharedRes, !isSoftwareGl);
    scene.add(coreHandle.group);

    const crahHandle = createCrahAssembly(sharedRes, !isSoftwareGl);
    scene.add(crahHandle.group);

    const recoveryHandle = createHeatRecoveryAssembly(sharedRes, !isSoftwareGl);
    scene.add(recoveryHandle.group);

    const conduitHandle = createFloorConduitNetwork(sharedRes, E.adjacent(6));
    scene.add(conduitHandle.group);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Smooth camera glide state
    let viewW = initW;
    let viewH = initH;
    let userAdjustedOrbit = false;

    const transitionState = {
      active: false,
      goalPos: new THREE.Vector3(initAdjusted.pos.x, initAdjusted.pos.y, initAdjusted.pos.z),
      goalTarget: new THREE.Vector3(
        initAdjusted.target.x,
        initAdjusted.target.y,
        initAdjusted.target.z
      ),
    };

    const cancelTransition = () => {
      transitionState.active = false;
      userAdjustedOrbit = true;
    };
    controls.addEventListener('start', cancelTransition);

    cameraActionRef.current.zoomFactor = (factor: number) => {
      const baseTarget = transitionState.active ? transitionState.goalTarget : controls.target;
      const basePos = transitionState.active ? transitionState.goalPos : camera.position;
      _camOffset.copy(basePos).sub(baseTarget);
      const nextDist = THREE.MathUtils.clamp(
        _camOffset.length() * factor,
        controls.minDistance,
        controls.maxDistance
      );
      _camOffset.normalize().multiplyScalar(nextDist);
      transitionState.goalTarget.copy(baseTarget);
      transitionState.goalPos.copy(baseTarget).add(_camOffset);
      transitionState.active = true;
    };

    cameraActionRef.current.resetView = () => {
      userAdjustedOrbit = false;
      const adj = getAspectAdjustedCameraPreset(activeBasePresetRef.current, viewW / Math.max(1, viewH));
      transitionState.goalPos.set(adj.pos.x, adj.pos.y, adj.pos.z);
      transitionState.goalTarget.set(adj.target.x, adj.target.y, adj.target.z);
      transitionState.active = true;
    };

    cameraActionRef.current.glideTo = (preset: CameraPreset3D) => {
      userAdjustedOrbit = false;
      const adj = getAspectAdjustedCameraPreset(preset, viewW / Math.max(1, viewH));
      transitionState.goalPos.set(adj.pos.x, adj.pos.y, adj.pos.z);
      transitionState.goalTarget.set(adj.target.x, adj.target.y, adj.target.z);
      transitionState.active = true;
    };

    // High-performance Raycasting against proxy volumes on RAYCAST_LAYER (never scene.children recursively)
    const interactables: THREE.Object3D[] = [];
    const rackProxies: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj.layers.isEnabled(RAYCAST_LAYER)) {
        interactables.push(obj);
        if (obj.userData?.interactType === 'rack') {
          rackProxies.push(obj);
        }
      }
    });

    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(RAYCAST_LAYER);
    const pointerNdc = new THREE.Vector2();
    let hoveredRackId: number | null = null;
    let hoveredInteractType: string | null = null;
    let lastEmittedHoverKey: string | null = null;
    let isOrbitDragging = false;
    let downPos = { x: 0, y: 0, button: -1, pointerType: 'mouse' };
    let lastHoverCheckMs = 0;

    const emitHoverKey = (nextKey: string | null) => {
      if (nextKey !== lastEmittedHoverKey) {
        lastEmittedHoverKey = nextKey;
        setHoveredKey(nextKey);
      }
    };

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      return true;
    };

    const onPointerDown = (e: PointerEvent) => {
      downPos = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        pointerType: e.pointerType || 'mouse',
      };
      isOrbitDragging = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      const dragTol = (e.pointerType || downPos.pointerType) === 'touch' ? 14 : 5;
      if (
        downPos.button !== -1 &&
        Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > dragTol
      ) {
        isOrbitDragging = true;
      }
      if (isOrbitDragging || e.pointerType === 'touch') return;

      const now = performance.now();
      if (now - lastHoverCheckMs < 48) return;
      lastHoverCheckMs = now;

      if (!updatePointerNdc(e.clientX, e.clientY)) return;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(interactables, false);
      if (hits.length > 0) {
        const data = hits[0].object.userData;
        const t = data.interactType as string | undefined;
        if (t === 'rack') {
          hoveredRackId = data.rackId as number;
          hoveredInteractType = 'rack';
          renderer.domElement.style.cursor = 'pointer';
          emitHoverKey(`rack-${hoveredRackId}`);
          return;
        }
        if (
          t === 'thermos-core' ||
          t === 'compute-flow' ||
          t === 'heat-flow' ||
          t === 'recovery' ||
          t === 'cooling'
        ) {
          hoveredRackId = null;
          hoveredInteractType = t;
          renderer.domElement.style.cursor = 'pointer';
          emitHoverKey(t);
          return;
        }
      }
      hoveredRackId = null;
      hoveredInteractType = null;
      renderer.domElement.style.cursor = 'grab';
      emitHoverKey(null);
    };

    const onPointerUp = (e: PointerEvent) => {
      const isTouch = (e.pointerType || downPos.pointerType) === 'touch';
      const tapTol = isTouch ? 14 : 5;
      const wasPrimary = isTouch || (e.button === 0 && downPos.button === 0);
      const wasCleanClick =
        wasPrimary &&
        downPos.button !== -1 &&
        Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) <= tapTol;
      downPos.button = -1;
      isOrbitDragging = false;

      if (!wasCleanClick) return;
      if (!updatePointerNdc(e.clientX, e.clientY)) return;

      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(interactables, false);
      if (hits.length > 0) {
        const data = hits[0].object.userData;
        const t = data.interactType as string | undefined;
        if (t === 'rack') {
          const clickedId = data.rackId as number;
          const curSel = liveRef.current.selectedRackId;
          liveRef.current.onSelectRack(curSel === clickedId ? null : clickedId);
          return;
        }
        if (t === 'thermos-core') {
          liveRef.current.onSelectCore();
          return;
        }
        if (t === 'compute-flow') {
          liveRef.current.onSelectPathway('compute');
          return;
        }
        if (t === 'heat-flow') {
          liveRef.current.onSelectPathway('heat');
          return;
        }
        if (t === 'recovery') {
          liveRef.current.onSelectPathway('recovery');
          return;
        }
        if (t === 'cooling') {
          liveRef.current.onSelectPathway('cooling');
          return;
        }
      }
      // Clean click on empty floor / facility background closes any open contextual panel
      liveRef.current.onCanvasBackgroundClick();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Helper to project a 3D world anchor onto CSS overlay coordinates with safe viewport edge clamping
    const placeOverlayBadge = (
      el: HTMLElement | null,
      wx: number,
      wy: number,
      wz: number,
      yAlignPct = -100,
      checkRackOcclusion = false
    ) => {
      if (!el) return;
      _projVec.set(wx, wy, wz);
      if (checkRackOcclusion) {
        const distToAnchor = camera.position.distanceTo(_projVec);
        _camOffset.copy(_projVec).sub(camera.position).normalize();
        raycaster.set(camera.position, _camOffset);
        const occHits = raycaster.intersectObjects(rackProxies, false);
        if (occHits.length > 0 && occHits[0].distance < distToAnchor - 0.55) {
          el.style.opacity = '0';
          return;
        }
      }
      _projVec.project(camera);
      if (_projVec.z > 1 || _projVec.z < -1) {
        el.style.opacity = '0';
        return;
      }
      const rawSx = (_projVec.x * 0.5 + 0.5) * viewW;
      const rawSy = (-_projVec.y * 0.5 + 0.5) * viewH;
      // Hide badges projected completely outside canvas bounds; softly clamp badges near horizontal edges
      if (rawSx < -28 || rawSx > viewW + 28 || rawSy < 12 || rawSy > viewH - 6) {
        el.style.opacity = '0';
        return;
      }
      const edgePadX = viewW < 640 ? 28 : 42;
      const sx = Math.max(edgePadX, Math.min(viewW - edgePadX, rawSx));
      const sy = Math.max(24, Math.min(viewH - 10, rawSy));
      el.style.opacity = '';
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, ${yAlignPct}%)`;
      el.style.zIndex = String(Math.max(1, Math.min(18, Math.round((1 - _projVec.z) * 40))));
    };

    const midRowAisleZ = getRowAisleZ(1);
    const syncAllOverlayBadges = () => {
      camera.updateMatrixWorld(true);
      for (let i = 0; i < E.N; i++) {
        const p = getRackPlacement3D(i);
        placeOverlayBadge(rackBadgeRefs.current[i], p.x, RACK_H + 0.16, p.z, -100);
      }
      placeOverlayBadge(
        crahBadgeRef.current,
        CRAH_SPEC.x,
        CRAH_SPEC.h + 0.24,
        CRAH_SPEC.z,
        -100
      );
      placeOverlayBadge(
        recoveryBadgeRef.current,
        RECOVERY_SPEC.x,
        RECOVERY_SPEC.h + 0.28,
        RECOVERY_SPEC.z,
        -100
      );
      placeOverlayBadge(
        pathABadgeRef.current,
        PATH_A_LABEL_ANCHOR.x,
        PATH_A_LABEL_ANCHOR.y,
        PATH_A_LABEL_ANCHOR.z,
        -100
      );
      placeOverlayBadge(
        pathBBadgeRef.current,
        PATH_B_LABEL_ANCHOR.x,
        PATH_B_LABEL_ANCHOR.y,
        PATH_B_LABEL_ANCHOR.z,
        -100
      );
      placeOverlayBadge(coreBadgeRef.current, CORE_POS.x, 0.58, CORE_POS.z, -100, true);
      placeOverlayBadge(computePathBadgeRef.current, SPINE_X, 0.08, midRowAisleZ, -50, true);
      placeOverlayBadge(
        heatPathBadgeRef.current,
        RECOVERY_COLLECTOR_X,
        0.08,
        midRowAisleZ,
        -50,
        true
      );
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(1, Math.floor(entry.contentRect.width));
      const h = Math.max(1, Math.floor(entry.contentRect.height));
      if (w === viewW && h === viewH) return;
      viewW = w;
      viewH = h;
      const nextAspect = w / h;
      const nextLimits = getAspectCameraDistanceLimits(nextAspect);
      controls.minDistance = nextLimits.minDistance;
      controls.maxDistance = nextLimits.maxDistance;

      camera.aspect = nextAspect;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);

      if (!userAdjustedOrbit) {
        const adj = getAspectAdjustedCameraPreset(activeBasePresetRef.current, nextAspect);
        transitionState.goalPos.set(adj.pos.x, adj.pos.y, adj.pos.z);
        transitionState.goalTarget.set(adj.target.x, adj.target.y, adj.target.z);
        transitionState.active = true;
      }

      renderer.render(scene, camera);
      syncAllOverlayBadges();
    });
    resizeObserver.observe(mountEl);

    // Frame loop with Three.js Skill software-WebGL fenceSync pacing
    const clock = new THREE.Clock();
    let simElapsed = 0;
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(0.1, clock.getDelta());
      if (liveRef.current.facility.isPlaying) {
        simElapsed += dt;
      }
      const elapsed = simElapsed;

      // 1. Spherical arc camera damping & clamped pan bounds
      if (transitionState.active) {
        const dampLambda = isSoftwareGl ? 18 : 11;
        _camOffset.copy(camera.position).sub(controls.target);
        _curSpherical.setFromVector3(_camOffset);

        _projVec.copy(transitionState.goalPos).sub(transitionState.goalTarget);
        _goalSpherical.setFromVector3(_projVec);

        let dTheta = _goalSpherical.theta - _curSpherical.theta;
        while (dTheta > Math.PI) dTheta -= Math.PI * 2;
        while (dTheta < -Math.PI) dTheta += Math.PI * 2;

        _curSpherical.radius = THREE.MathUtils.clamp(
          THREE.MathUtils.damp(_curSpherical.radius, _goalSpherical.radius, dampLambda, dt),
          controls.minDistance,
          controls.maxDistance
        );
        _curSpherical.phi = THREE.MathUtils.clamp(
          THREE.MathUtils.damp(_curSpherical.phi, _goalSpherical.phi, dampLambda, dt),
          controls.minPolarAngle,
          controls.maxPolarAngle
        );
        _curSpherical.theta = THREE.MathUtils.damp(
          _curSpherical.theta,
          _curSpherical.theta + dTheta,
          dampLambda,
          dt
        );

        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          transitionState.goalTarget.x,
          dampLambda,
          dt
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          transitionState.goalTarget.y,
          dampLambda,
          dt
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          transitionState.goalTarget.z,
          dampLambda,
          dt
        );

        _camOffset.setFromSpherical(_curSpherical);
        camera.position.copy(controls.target).add(_camOffset);

        if (
          camera.position.distanceToSquared(transitionState.goalPos) < 0.0012 &&
          controls.target.distanceToSquared(transitionState.goalTarget) < 0.0012
        ) {
          camera.position.copy(transitionState.goalPos);
          controls.target.copy(transitionState.goalTarget);
          transitionState.active = false;
        }
      }

      controls.update();
      _targetBeforeClamp.copy(controls.target);
      const clampedT = clampCameraTarget(controls.target);
      if (
        clampedT.x !== _targetBeforeClamp.x ||
        clampedT.y !== _targetBeforeClamp.y ||
        clampedT.z !== _targetBeforeClamp.z
      ) {
        controls.target.set(clampedT.x, clampedT.y, clampedT.z);
        camera.position.x += clampedT.x - _targetBeforeClamp.x;
        camera.position.y += clampedT.y - _targetBeforeClamp.y;
        camera.position.z += clampedT.z - _targetBeforeClamp.z;
      }

      // 2. Sync 3D Racks, Conduits, Core, CRAH & Heat Recovery with Live Simulation State + Active View Lens
      const state = liveRef.current;
      const fac = state.facility;
      const activeView = state.viewMode;
      const thermosOn = fac.thermos.enabled;
      const vState = fac.thermos.visualState;
      const isCoreGreen = thermosOn && (vState === 'INTERVENING' || vState === 'RESOLVED');
      const breathe = thermosOn && fac.isPlaying ? 0.72 + 0.28 * Math.sin(elapsed * 2.4) : 0.85;

      // Update THERMOS CORE 3D Pedestal (dormant slate when THERMOS is paused)
      const hasManualPendingCue = Boolean(
        thermosOn && fac.pendingPlan && fac.systemMode === 'interactive'
      );
      const coreSelected = state.activeContextualTarget === 'core';
      const coreHovered = hoveredInteractType === 'thermos-core';
      const coreHex = !thermosOn
        ? 0x64748b
        : isCoreGreen
        ? 0x059669
        : vState === 'ESCALATION'
        ? 0xd97706
        : 0x0066ff;
      const coreNodeHex = !thermosOn
        ? 0x94a3b8
        : isCoreGreen
        ? 0x10b981
        : vState === 'ESCALATION'
        ? 0xf59e0b
        : 0x38bdf8;
      coreHandle.ringMat.color.setHex(coreHex);
      coreHandle.ringMat.emissive.setHex(coreHex);
      coreHandle.ringMat.emissiveIntensity = !thermosOn
        ? coreSelected || coreHovered
          ? 0.22
          : 0.06
        : hasManualPendingCue
        ? 0.85 + 0.35 * Math.sin(clock.elapsedTime * 4.2)
        : activeView === 'compute' || coreSelected || coreHovered
        ? 1.15
        : vState === 'IDLE'
        ? 0.55 * breathe
        : 1.05;
      coreHandle.topTrimMat.color.setHex(coreHex);
      coreHandle.topTrimMat.emissive.setHex(coreHex);
      coreHandle.topTrimMat.emissiveIntensity = !thermosOn
        ? 0.05
        : vState === 'IDLE'
        ? 0.45 * breathe
        : 0.85;
      coreHandle.nodeMat.color.setHex(coreNodeHex);
      coreHandle.nodeMat.emissive.setHex(coreHex);
      coreHandle.nodeMat.emissiveIntensity = !thermosOn
        ? 0.08
        : vState === 'IDLE'
        ? 0.7 * breathe
        : 1.25;
      coreHandle.outlineMesh.visible = coreSelected || coreHovered || hasManualPendingCue;
      coreHandle.outlineMat.color.setHex(
        coreSelected ? 0x18181b : hasManualPendingCue ? 0x0066ff : 0x64748b
      );

      // Update Spine Strip (dormant when THERMOS is paused)
      const computeEmphasized =
        activeView === 'compute' || hoveredInteractType === 'compute-flow';
      conduitHandle.spineStripMat.color.setHex(
        !thermosOn ? 0x94a3b8 : isCoreGreen ? 0x10b981 : 0x0066ff
      );
      conduitHandle.spineStripMat.emissive.setHex(
        !thermosOn ? 0x475569 : isCoreGreen ? 0x059669 : 0x0066ff
      );
      conduitHandle.spineStripMat.emissiveIntensity = !thermosOn
        ? computeEmphasized
          ? 0.24
          : 0.05
        : computeEmphasized
        ? 1.12
        : vState === 'IDLE'
        ? 0.5 * breathe
        : 0.95;

      // Update 3 Row Aisle Strips
      for (let row = 0; row < 3; row++) {
        let rowGreen = false;
        let rowActive = false;
        if (thermosOn) {
          for (let c = 0; c < 4; c++) {
            const bs = state.branchStates.get(row * 4 + c) || 'idle';
            if (bs === 'green') rowGreen = true;
            if (bs !== 'idle') rowActive = true;
          }
        }
        const rHex = !thermosOn ? 0x475569 : rowGreen ? 0x059669 : 0x0066ff;
        const rMat = conduitHandle.rowStripMats[row];
        rMat.color.setHex(!thermosOn ? 0x94a3b8 : rowGreen ? 0x10b981 : 0x0066ff);
        rMat.emissive.setHex(rHex);
        rMat.emissiveIntensity = !thermosOn
          ? computeEmphasized
            ? 0.22
            : 0.04
          : computeEmphasized
          ? 0.98
          : rowGreen
          ? 1.0
          : rowActive
          ? 0.78
          : 0.34 * breathe;

        const jMat = conduitHandle.rowJunctionMats[row];
        jMat.emissive.setHex(rHex);
        jMat.emissiveIntensity = !thermosOn
          ? 0.06
          : rowGreen
          ? 1.0
          : rowActive || computeEmphasized
          ? 0.86
          : 0.45;
      }

      // Update CRAH & Cold-Aisle Supply Plenums (baseline static cooling continues even when THERMOS is paused)
      const isWetCooling = fac.activeCoolingMode === 'wet';
      const isCoolingView =
        activeView === 'cooling' ||
        hoveredInteractType === 'cooling' ||
        Boolean(state.highlightedPathways?.cooling);
      const coolingSelected = state.activeContextualTarget === 'cooling';
      crahHandle.outlineMesh.visible = coolingSelected || hoveredInteractType === 'cooling';
      crahHandle.outlineMat.color.setHex(coolingSelected ? 0x18181b : 0x0066ff);
      crahHandle.stripMat.color.setHex(
        isCoolingView
          ? isWetCooling
            ? 0x06b6d4
            : 0x38bdf8
          : !thermosOn
          ? 0x64748b
          : vState === 'INTERVENING'
          ? 0x10b981
          : 0x0066ff
      );
      crahHandle.stripMat.emissive.setHex(
        isCoolingView
          ? isWetCooling
            ? 0x0284c7
            : 0x0066ff
          : !thermosOn
          ? 0x475569
          : vState === 'INTERVENING'
          ? 0x059669
          : 0x0066ff
      );
      crahHandle.stripMat.emissiveIntensity = isCoolingView
        ? 1.15
        : !thermosOn
        ? 0.22
        : vState === 'INTERVENING'
        ? 1.0
        : 0.65;

      const airSpeed = (0.24 + (fac.coolingFanPct / 100) * 0.72) * (isCoolingView ? 1.35 : 1.0);
      const plenumHex = isWetCooling ? 0x0284c7 : isCoolingView ? 0x0066ff : 0x64748b;
      for (let row = 0; row < 3; row++) {
        const pMat = crahHandle.plenumMats[row];
        pMat.color.setHex(plenumHex);
        pMat.emissive.setHex(plenumHex);
        pMat.emissiveIntensity = isCoolingView ? (isWetCooling ? 0.88 : 0.72) : isWetCooling ? 0.45 : 0.22;
        pMat.opacity = isCoolingView
          ? Math.min(0.95, 0.52 + (fac.coolingFanPct / 100) * 0.42)
          : 0.25 + (fac.coolingFanPct / 100) * 0.48;

        const dashGroup = crahHandle.plenumDashGroups[row];
        for (const child of dashGroup.children) {
          const { baseOffset, startX, endX } = child.userData as {
            baseOffset: number;
            startX: number;
            endX: number;
          };
          const t = (baseOffset + elapsed * airSpeed * 0.28) % 1;
          child.position.x = startX + t * (endX - startX);
        }
      }

      // Update Heat Recovery & Seebeck TEG Skid + Dual Bifurcated Pathways (Path A Thermal + Path B TEG)
      const heatHovered = hoveredInteractType === 'heat-flow';
      const recoveryHovered = hoveredInteractType === 'recovery';
      const recoverySelected = state.activeContextualTarget === 'recovery';
      recoveryHandle.outlineMesh.visible = recoverySelected || recoveryHovered;
      recoveryHandle.outlineMat.color.setHex(recoverySelected ? 0x18181b : 0x059669);

      const isRecoveryOrHeat =
        activeView === 'recovery' || activeView === 'heat' || heatHovered || recoveryHovered;
      const exporting =
        fac.heatRecovery.isExporting &&
        fac.heatRecovery.extractedHeatKW > 0.05 &&
        fac.heatRecovery.activeRackIds.length > 0;
      const hasPathAThermal = exporting && fac.heatRecovery.thermalEnergyCapturedKW > 0.04;
      const hasPathBTeg = fac.heatRecovery.tegGenerationKW > 0.0004;

      recoveryHandle.stripMat.color.setHex(exporting ? 0x10b981 : 0x64748b);
      recoveryHandle.stripMat.emissive.setHex(exporting ? 0x059669 : 0x475569);
      recoveryHandle.stripMat.emissiveIntensity = exporting ? (activeView === 'recovery' ? 1.2 : 0.98) : 0.22;
      recoveryHandle.finMat.emissiveIntensity = exporting ? (activeView === 'recovery' ? 0.62 : 0.38) : 0.06;
      recoveryHandle.pipeGlowMat.emissive.setHex(
        activeView === 'heat' || heatHovered ? 0xd97706 : 0x059669
      );
      recoveryHandle.pipeGlowMat.emissiveIntensity =
        exporting || heatHovered
          ? (isRecoveryOrHeat ? 0.88 : 0.55) * breathe
          : 0.08;

      conduitHandle.recoveryCollectorMat.color.setHex(
        exporting || heatHovered
          ? activeView === 'heat' || heatHovered
            ? 0xf59e0b
            : 0x10b981
          : 0x64748b
      );
      conduitHandle.recoveryCollectorMat.emissive.setHex(
        exporting || heatHovered
          ? activeView === 'heat' || heatHovered
            ? 0xd97706
            : 0x059669
          : 0x334155
      );
      conduitHandle.recoveryCollectorMat.emissiveIntensity =
        exporting || heatHovered
          ? isRecoveryOrHeat
            ? 1.08
            : 0.92
          : 0.18;

      // Path A (Useful Thermal Energy Export Pipe & Header)
      recoveryHandle.pathAPipeMat.emissiveIntensity = hasPathAThermal
        ? activeView === 'recovery'
          ? 0.92
          : 0.42
        : 0.06;
      recoveryHandle.pathAHeaderMat.emissiveIntensity = hasPathAThermal
        ? activeView === 'recovery'
          ? 0.75 * breathe
          : 0.32
        : 0.05;

      const pathASpeed = 0.36 + Math.min(1.1, fac.heatRecovery.thermalEnergyCapturedKW / 12) * 0.55;
      const showPathAPulses = hasPathAThermal && (activeView === 'recovery' || activeView === 'facility');
      for (let k = 0; k < recoveryHandle.pathAPulsePool.length; k++) {
        const cap = recoveryHandle.pathAPulsePool[k];
        if (showPathAPulses && (activeView === 'recovery' || k < 3)) {
          const count = activeView === 'recovery' ? recoveryHandle.pathAPulsePool.length : 3;
          const prog = (elapsed * pathASpeed + k / count) % 1;
          const { pos, dir } = samplePolyline3D(STATIC_PATH_A_EXPORT_PATH, prog);
          cap.mesh.visible = true;
          cap.mesh.position.set(pos.x, pos.y, pos.z);
          cap.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        } else {
          cap.mesh.visible = false;
        }
      }

      // Path B (Solid-State Seebeck TEG Auxiliary Electricity Bus -> Rack Sensors & Valve Actuators)
      recoveryHandle.pathBStripMat.emissiveIntensity = hasPathBTeg
        ? activeView === 'recovery'
          ? 1.05
          : 0.45
        : 0.10;
      recoveryHandle.pathBTerminalMat.emissiveIntensity = hasPathBTeg
        ? activeView === 'recovery'
          ? 0.95 * breathe
          : 0.42
        : 0.12;

      const tegWatts = fac.heatRecovery.tegGenerationKW * 1000;
      const pathBSpeed = 0.34 + Math.min(1.0, tegWatts / 65) * 0.52;
      const showPathBPulses = hasPathBTeg && activeView === 'recovery';
      for (let k = 0; k < recoveryHandle.pathBPulsePool.length; k++) {
        const bp = recoveryHandle.pathBPulsePool[k];
        if (showPathBPulses) {
          const prog = (elapsed * pathBSpeed + k / recoveryHandle.pathBPulsePool.length) % 1;
          const { pos, dir } = samplePolyline3D(STATIC_PATH_B_TEG_AUX_PATH, prog);
          bp.mesh.visible = true;
          bp.mesh.position.set(pos.x, pos.y, pos.z);
          bp.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        } else {
          bp.mesh.visible = false;
        }
      }

      // Update 12 True 3D Server Racks + Plumes + Cold Intake Streamlines
      for (let i = 0; i < E.N; i++) {
        const rh = rackHandles[i];
        const rackData = fac.racks[i];
        if (!rackData) continue;

        const bState = thermosOn ? state.branchStates.get(i) || 'idle' : 'idle';
        const isSelected = state.selectedRackId === i;
        const isHovered = hoveredRackId === i;
        const isIncHighlight = state.incidentHighlightedRacks.has(i);
        const isFocusedBlue =
          thermosOn &&
          (vState === 'ANALYSING' || vState === 'COORDINATING' || vState === 'SCANNING') &&
          (fac.thermos.inspectedRacks.includes(i) ||
            Boolean(fac.pendingPlan?.targetRacks.includes(i)));
        const isRecoveryRack = thermosOn && fac.heatRecovery.activeRackIds.includes(i) && exporting;
        const isComputeShedding = thermosOn && rackData.workloadDeltaPct <= -2;
        const isComputeReceiving = thermosOn && rackData.workloadDeltaPct >= 2;

        rh.hoverBoost = THREE.MathUtils.damp(rh.hoverBoost, isHovered || isSelected ? 1 : 0, 10, dt);

        // Cabinet metallic frame subtle highlight + view-aware illumination
        _colorA.setHex(0xc0c6d0);
        _colorB.setHex(0xd6dce6);
        rh.frameMat.color.copy(_colorA).lerp(_colorB, rh.hoverBoost * 0.75);

        if (activeView === 'recovery' && isRecoveryRack) {
          rh.frameMat.emissive.setHex(0x059669);
          rh.frameMat.emissiveIntensity = 0.08;
          rh.bayWashMat.emissive.setHex(0x10b981);
          rh.bayWashMat.emissiveIntensity = 0.78;
        } else if (activeView === 'compute' && isComputeReceiving) {
          rh.frameMat.emissive.setHex(0x059669);
          rh.frameMat.emissiveIntensity = 0.09;
          rh.bayWashMat.emissive.setHex(0x10b981);
          rh.bayWashMat.emissiveIntensity = 0.90;
        } else if (activeView === 'compute' && isComputeShedding) {
          rh.frameMat.emissive.setHex(0xd97706);
          rh.frameMat.emissiveIntensity = 0.07;
          rh.bayWashMat.emissive.setHex(0xf59e0b);
          rh.bayWashMat.emissiveIntensity = 0.72;
        } else if (bState === 'green') {
          rh.frameMat.emissive.setHex(0x059669);
          rh.frameMat.emissiveIntensity = 0.09;
          rh.bayWashMat.emissive.setHex(0x10b981);
          rh.bayWashMat.emissiveIntensity = 0.85;
        } else if (isFocusedBlue || bState === 'blue' || bState === 'monitoring') {
          rh.frameMat.emissive.setHex(0x0066ff);
          rh.frameMat.emissiveIntensity = isFocusedBlue ? 0.08 : 0.035;
          rh.bayWashMat.emissive.setHex(0x0066ff);
          rh.bayWashMat.emissiveIntensity = isFocusedBlue ? 0.65 : 0.25;
        } else {
          rh.frameMat.emissive.setHex(0x000000);
          rh.frameMat.emissiveIntensity = 0;
          rh.bayWashMat.emissiveIntensity = 0;
        }

        // Vertical 3D THERMOS Light-Bar & Floor Tap Branch (dormant slate when THERMOS is paused)
        const stripHex = !thermosOn
          ? 0x94a3b8
          : (activeView === 'compute' && isComputeReceiving) || bState === 'green'
          ? 0x10b981
          : activeView === 'compute' && isComputeShedding
          ? 0xf59e0b
          : bState === 'monitoring'
          ? 0x0ea5e9
          : bState === 'escalated'
          ? 0xdc2626
          : 0x0066ff;
        const stripEmissiveHex = !thermosOn
          ? 0x475569
          : (activeView === 'compute' && isComputeReceiving) || bState === 'green'
          ? 0x059669
          : activeView === 'compute' && isComputeShedding
          ? 0xd97706
          : bState === 'monitoring'
          ? 0x0284c7
          : bState === 'escalated'
          ? 0xb91c1c
          : 0x0066ff;
        const stripInt = !thermosOn
          ? 0.05
          : bState === 'green' || (activeView === 'compute' && (isComputeReceiving || isComputeShedding))
          ? 1.15
          : isFocusedBlue || bState === 'monitoring' || bState === 'escalated'
          ? 0.92
          : bState === 'blue' || activeView === 'compute'
          ? 0.68
          : 0.35 * breathe;

        rh.lightStripMat.color.setHex(stripHex);
        rh.lightStripMat.emissive.setHex(stripEmissiveHex);
        rh.lightStripMat.emissiveIntensity = stripInt;

        const branch = conduitHandle.branches[i];
        branch.tapStripMat.color.setHex(stripHex);
        branch.tapStripMat.emissive.setHex(stripEmissiveHex);
        branch.tapStripMat.emissiveIntensity = stripInt;
        branch.tapNodeMat.color.setHex(stripHex);
        branch.tapNodeMat.emissive.setHex(stripEmissiveHex);
        branch.tapNodeMat.emissiveIntensity = !thermosOn ? 0.06 : Math.min(1.2, stripInt + 0.15);

        // 6 Individual 3D Server Blade Trays: Workload LEDs & Thermal Stress Warmth
        const activeSlots = Math.max(1, Math.min(6, Math.ceil(rackData.workloadUtil * 6)));
        const isCritical = rackData.thermalRiskState === 'CRITICAL';
        const isWarming = rackData.thermalRiskState === 'WARMING';

        for (let s = 0; s < 6; s++) {
          const ledMat = rh.trayLedMats[s];
          const glowMat = rh.trayGlowMats[s];
          const slotActive = s < activeSlots;

          if (slotActive) {
            const ledHex =
              activeView === 'compute'
                ? isComputeReceiving
                  ? 0x10b981
                  : isComputeShedding
                  ? 0xf59e0b
                  : 0x38bdf8
                : isCritical
                ? 0xef4444
                : isWarming
                ? 0xf59e0b
                : bState === 'green'
                ? 0x10b981
                : isFocusedBlue
                ? 0x38bdf8
                : 0x94a3b8;
            ledMat.color.setHex(ledHex);
            ledMat.emissive.setHex(ledHex);
            ledMat.emissiveIntensity =
              activeView === 'compute' || isCritical || isWarming || bState === 'green' ? 1.05 : 0.6;
          } else {
            ledMat.color.setHex(0x3f4756);
            ledMat.emissive.setHex(0x3f4756);
            ledMat.emissiveIntensity = 0.15;
          }

          if (isCritical) {
            glowMat.emissive.setHex(0x991b1b);
            glowMat.emissiveIntensity = activeView === 'heat' ? 0.78 : 0.55;
          } else if (isWarming) {
            glowMat.emissive.setHex(0x92400e);
            glowMat.emissiveIntensity = activeView === 'heat' ? 0.58 : 0.38;
          } else if (activeView === 'heat' && rackData.heatGeneratedKW > 2.0) {
            glowMat.emissive.setHex(0xb45309);
            glowMat.emissiveIntensity = Math.min(0.45, rackData.heatGeneratedKW * 0.055);
          } else if (bState === 'green') {
            glowMat.emissive.setHex(0x065f46);
            glowMat.emissiveIntensity = 0.25;
          } else {
            glowMat.emissiveIntensity = 0;
          }
        }

        // 11. 3D Convective Roof Exhaust Thermal Plume Columns
        const showPlume =
          activeView === 'heat' ||
          (activeView === 'facility' && (isCritical || isWarming)) ||
          (activeView === 'recovery' && isRecoveryRack);
        rh.exhaustPlumeGroup.visible = showPlume;
        rh.plumeProxyMesh.visible = showPlume;
        if (showPlume) {
          const tempFactor = THREE.MathUtils.clamp((rackData.exhaustTempC - 27.5) / 14.0, 0.15, 1.0);
          const kwFactor = THREE.MathUtils.clamp(rackData.heatGeneratedKW / 7.5, 0.25, 1.35);
          const shimmer = 0.94 + 0.06 * Math.sin(elapsed * 3.2 + i * 0.9);
          rh.exhaustPlumeGroup.scale.set(
            1,
            kwFactor * (activeView === 'heat' ? 1.18 : 0.72) * shimmer,
            1
          );
          if (isCritical) {
            rh.exhaustPlumeMat.color.setHex(0xdc2626);
          } else if (activeView === 'recovery' && isRecoveryRack) {
            rh.exhaustPlumeMat.color.setHex(0xd97706);
          } else {
            _colorA.setHex(0xf59e0b);
            _colorB.setHex(0xdc2626);
            rh.exhaustPlumeMat.color.copy(_colorA).lerp(_colorB, Math.max(0, tempFactor - 0.35));
          }
          rh.exhaustPlumeMat.opacity =
            activeView === 'heat'
              ? 0.20 + tempFactor * 0.46
              : isCritical
              ? 0.36
              : 0.22;
        }

        // 12. 3D Cold-Aisle Intake Streamlines (Smart Cooling view)
        const isObstructed = rackData.airflowRestriction >= 0.12;
        rh.intakeStreamGroup.visible = isCoolingView;
        if (isCoolingView) {
          const flowScale = THREE.MathUtils.clamp(
            (fac.coolingFanPct / 100) * (rackData.localAirflowPct / 100),
            0.18,
            1.25
          );
          const streamHex = isObstructed
            ? 0xd97706
            : isWetCooling
            ? 0x0284c7
            : 0x0066ff;
          rh.intakeStreamMat.color.setHex(streamHex);
          rh.intakeStreamMat.emissive.setHex(streamHex);
          rh.intakeStreamMat.emissiveIntensity = isObstructed ? 0.55 : 0.78;
          rh.intakeStreamMat.opacity = isObstructed ? 0.34 : Math.min(0.84, 0.36 + flowScale * 0.42);

          const frontZ = RACK_D * 0.5;
          const speed = (isObstructed ? 0.25 : 0.62) * (0.65 + flowScale * 0.6);
          for (const chev of rh.intakeChevrons) {
            const { laneX, phaseOffset } = chev.userData as {
              laneX: number;
              phaseOffset: number;
            };
            const p = (phaseOffset + elapsed * speed) % 1;
            chev.position.set(laneX, 0.18 + p * 1.18, frontZ + 0.24 * (1 - p) + 0.02);
            chev.rotation.x = -0.38 * (1 - p);
          }
        }

        // Grounded Selection / Warning / Critical / Connected Perimeter Collar
        const isConnectedRack = state.connectedRackSet.has(i);
        if (isSelected) {
          rh.outlineMesh.visible = true;
          rh.outlineMat.color.setHex(0x18181b);
        } else if (isCritical) {
          rh.outlineMesh.visible = true;
          rh.outlineMat.color.setHex(0xdc2626);
        } else if (isIncHighlight || isWarming) {
          rh.outlineMesh.visible = true;
          rh.outlineMat.color.setHex(0xd97706);
        } else if (activeView === 'recovery' && isRecoveryRack) {
          rh.outlineMesh.visible = true;
          rh.outlineMat.color.setHex(0x059669);
        } else if (isConnectedRack) {
          rh.outlineMesh.visible = true;
          rh.outlineMat.color.setHex(0x0066ff);
        } else {
          rh.outlineMesh.visible = false;
        }

        // Physical Obstruction Bar & R07 Virtual Sensor Ring (Virtual sensor is a THERMOS AI capability — off when paused)
        rh.obstructionBar.visible =
          (fac.step > 0 || activeView === 'heat' || activeView === 'cooling') &&
          rackData.airflowRestriction >= 0.12;
        const showVsRing = thermosOn && !rackData.sensorAvailable && i === 6 && state.config.failure;
        rh.virtualSensorRing.visible = showVsRing;
        if (showVsRing) {
          rh.virtualSensorRing.rotation.z = elapsed * 0.7;
        }
      }

      // R07 Spatial k-NN Arches visibility (only active when THERMOS AI is engaged)
      const r07 = fac.racks[6];
      const showKnn = Boolean(thermosOn && r07 && !r07.sensorAvailable);
      conduitHandle.knnGroup.visible = showKnn;
      if (showKnn) {
        const knnPulse = 0.65 + 0.35 * Math.sin(elapsed * 4.0);
        for (const tm of conduitHandle.knnTubeMats) {
          tm.emissiveIntensity = knnPulse;
        }
      }

      // 3. Animate 3D Travelling Light Pulses along Floor Pathways (Strictly zero THERMOS pulses when THERMOS is paused)
      let pulseCursor = 0;
      const assignPulseCustom = (
        path: Vec3Tuple[],
        progress: number,
        bodyHex: number,
        emissiveHex: number,
        haloHex: number
      ) => {
        if (pulseCursor >= conduitHandle.pulsePool.length) return;
        const p = conduitHandle.pulsePool[pulseCursor++];
        const { pos, dir } = samplePolyline3D(path, progress);
        p.mesh.visible = true;
        p.mesh.position.set(pos.x, pos.y, pos.z);
        p.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        p.mat.color.setHex(bodyHex);
        p.mat.emissive.setHex(emissiveHex);
        p.haloMat.color.setHex(haloHex);
      };

      const assignPulse = (path: Vec3Tuple[], progress: number, isGreen: boolean) => {
        assignPulseCustom(
          path,
          progress,
          isGreen ? 0x34d399 : 0x38bdf8,
          isGreen ? 0x059669 : 0x0066ff,
          isGreen ? 0x10b981 : 0x0066ff
        );
      };

      if (thermosOn) {
        if (activeView === 'compute') {
          for (let i = 0; i < E.N; i++) {
            const r = fac.racks[i];
            if (!r || r.workloadUtil < 0.08) continue;
            const speed = 0.42 + r.workloadUtil * 0.55;
            const prog = (elapsed * speed + i * 0.09) % 1;
            assignPulse(STATIC_CORE_TO_RACK_PATHS[i], prog, r.workloadDeltaPct >= 2);
          }
          const executedTransfers =
            fac.thermos.activeTransfers.length > 0
              ? fac.thermos.activeTransfers
              : vState === 'INTERVENING'
              ? state.currentRecord?.transfers ?? []
              : [];
          const pendingTransfers =
            executedTransfers.length === 0 ? fac.pendingPlan?.transfers ?? [] : [];
          executedTransfers.forEach((tr, idx) => {
            const path = getRackToRackPoints3D(tr.fromRack, tr.toRack, 0.030);
            assignPulse(path, (elapsed * 0.95 + idx * 0.25) % 1, true);
            assignPulse(path, (elapsed * 0.95 + idx * 0.25 + 0.5) % 1, true);
          });
          pendingTransfers.forEach((tr, idx) => {
            const path = getRackToRackPoints3D(tr.fromRack, tr.toRack, 0.030);
            assignPulse(path, (elapsed * 0.78 + idx * 0.25) % 1, false);
          });
        } else if (activeView === 'heat' || activeView === 'recovery') {
          const contributingIds =
            exporting && fac.heatRecovery.activeRackIds.length > 0
              ? fac.heatRecovery.activeRackIds
              : fac.racks.filter((r) => r.heatGeneratedKW > 3.5).map((r) => r.id);
          contributingIds.slice(0, 8).forEach((rId, idx) => {
            const path = STATIC_RACK_TO_RECOVERY_PATHS[rId];
            if (!path) return;
            const isAmber = activeView === 'heat';
            assignPulseCustom(
              path,
              (elapsed * 0.78 + idx * 0.19) % 1,
              isAmber ? 0xfbbf24 : 0x34d399,
              isAmber ? 0xd97706 : 0x059669,
              isAmber ? 0xf59e0b : 0x10b981
            );
            if (exporting) {
              assignPulseCustom(
                path,
                (elapsed * 0.78 + idx * 0.19 + 0.5) % 1,
                isAmber ? 0xfbbf24 : 0x34d399,
                isAmber ? 0xd97706 : 0x059669,
                isAmber ? 0xf59e0b : 0x10b981
              );
            }
          });
        } else {
          if (vState === 'SCANNING') {
            for (let r = 0; r < 3; r++) {
              const prog = (elapsed * 0.72 + r * 0.28) % 1;
              assignPulse(STATIC_ROW_SCAN_PATHS[r], prog, false);
            }
          }

          for (let i = 0; i < E.N; i++) {
            const bState = state.branchStates.get(i) || 'idle';
            if (bState === 'green') {
              const prog = (elapsed * 0.95 + i * 0.13) % 1;
              assignPulse(STATIC_CORE_TO_RACK_PATHS[i], prog, true);
            } else if (
              (vState === 'ANALYSING' || vState === 'COORDINATING') &&
              (fac.thermos.inspectedRacks.includes(i) ||
                Boolean(fac.pendingPlan?.targetRacks.includes(i)))
            ) {
              const prog = (elapsed * 0.78 + i * 0.17) % 1;
              assignPulse(STATIC_CORE_TO_RACK_PATHS[i], prog, false);
            }
          }

          if (vState === 'COORDINATING' && fac.pendingPlan) {
            fac.pendingPlan.transfers.forEach((tr, idx) => {
              const path = getRackToRackPoints3D(tr.fromRack, tr.toRack, 0.028);
              assignPulse(path, (elapsed * 0.8 + idx * 0.25) % 1, false);
            });
          }

          if (vState === 'INTERVENING') {
            fac.thermos.activeTransfers.forEach((tr, idx) => {
              const path = getRackToRackPoints3D(tr.fromRack, tr.toRack, 0.028);
              assignPulse(path, (elapsed * 1.05 + idx * 0.22) % 1, true);
            });
          }

          if (exporting) {
            fac.heatRecovery.activeRackIds.slice(0, 6).forEach((rId, idx) => {
              const path = STATIC_RACK_TO_RECOVERY_PATHS[rId];
              if (path) {
                assignPulse(path, (elapsed * 0.86 + idx * 0.21) % 1, true);
              }
            });
          }
        }
      }

      // Hide unused pulses in pool
      for (let k = pulseCursor; k < conduitHandle.pulsePool.length; k++) {
        conduitHandle.pulsePool[k].mesh.visible = false;
      }

      // 4. Animate 3D Workload Transfer Packets (Strictly zero when THERMOS is paused)
      const pkts = thermosOn ? state.activeWorkloadPackets : [];
      const steadyTransfers =
        thermosOn && activeView === 'compute' && pkts.length === 0
          ? fac.thermos.activeTransfers.length > 0
            ? fac.thermos.activeTransfers
            : state.currentRecord?.transfers ?? []
          : [];
      for (let k = 0; k < conduitHandle.packetPool.length; k++) {
        const item = conduitHandle.packetPool[k];
        if (k < pkts.length) {
          const pkt = pkts[k];
          const path = getRackToRackPoints3D(pkt.fromRack, pkt.toRack, 0.042);
          const { pos, dir } = samplePolyline3D(path, pkt.progress);
          item.mesh.visible = true;
          item.mesh.position.set(pos.x, pos.y, pos.z);
          item.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        } else if (k < steadyTransfers.length) {
          const tr = steadyTransfers[k];
          const path = getRackToRackPoints3D(tr.fromRack, tr.toRack, 0.042);
          const prog = (elapsed * 0.58 + k * 0.31) % 1;
          const { pos, dir } = samplePolyline3D(path, prog);
          item.mesh.visible = true;
          item.mesh.position.set(pos.x, pos.y, pos.z);
          item.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        } else {
          item.mesh.visible = false;
        }
      }

      // 5. Render 3D Frame First, Then Project Crisp World-Anchored Micro-Badges in Lockstep
      renderer.render(scene, camera);
      syncAllOverlayBadges();

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', cancelTransition);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      envTarget.dispose();
      sharedRes.disposeAll();
      renderer.dispose();
      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, []);

  const visibleIncidents = facility.activeIncidents.filter((inc) => inc.severity !== 'ADVISORY');
  const rackIncidentsMap = new Map<number, FacilityIncident>();
  let waterIncident: FacilityIncident | null = null;
  let facilitySurgeIncident: FacilityIncident | null = null;

  for (const inc of visibleIncidents) {
    if (inc.type === 'WATER_BUDGET_PRESSURE') {
      if (!waterIncident) waterIncident = inc;
    } else if (inc.affectedRacks.length >= 1 && inc.affectedRacks.length <= 4) {
      const primaryRack = inc.affectedRacks[0];
      if (!rackIncidentsMap.has(primaryRack)) {
        rackIncidentsMap.set(primaryRack, inc);
      }
    } else if (!facilitySurgeIncident) {
      facilitySurgeIncident = inc;
    }
  }

  const thermosOn = thermos.enabled;
  const isCoreGreen = thermosOn && (visualState === 'INTERVENING' || visualState === 'RESOLVED');
  const hasManualPendingCue = Boolean(
    thermosOn && facility.pendingPlan && facility.systemMode === 'interactive'
  );
  const isCoreSelected = activeContextualTarget === 'core';
  const isCoreHovered = hoveredKey === 'thermos-core';
  const isCoolingSelected = activeContextualTarget === 'cooling';
  const isCoolingHovered = hoveredKey === 'cooling';
  const isRecoverySelected = activeContextualTarget === 'recovery';
  const isRecoveryHovered = hoveredKey === 'recovery';
  const isComputeSelected = activeContextualTarget === 'compute';
  const isComputeHovered = hoveredKey === 'compute-flow';
  const isHeatSelected = activeContextualTarget === 'heat';
  const isHeatHovered = hoveredKey === 'heat-flow';

  const formatShortIncidentTag = (inc: FacilityIncident) => {
    switch (inc.type) {
      case 'SENSOR_FAILURE':
        return 'Sensor';
      case 'RESTRICTED_AIRFLOW':
        return 'Airflow';
      case 'RACK_OVERHEATING':
        return 'Overheat';
      case 'RAPID_TEMP_RISE':
        return 'Rapid +ΔT';
      case 'ACTION_VERIFICATION_DEFICIT':
        return 'Deficit';
      case 'WATER_BUDGET_PRESSURE':
        return 'Water';
      default:
        return 'Alert';
    }
  };

  return (
    <div
      ref={overlayBoundsRef}
      className="relative w-full h-full bg-[#F7F7F2] overflow-clip select-none"
      data-thermos-state={thermosOn ? visualState : 'PAUSED'}
      data-step={facility.step}
      data-minute={facility.minute}
      data-recovery-exporting={String(facility.heatRecovery.isExporting)}
      data-testid="thermos-3d-scene"
    >
      {/* Dedicated Isolated Three.js 3D WebGL Viewport Container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="THERMOS Interactive 3D Data Centre Digital Twin"
      />

      {/* Graceful fallback banner if WebGL context is ever interrupted */}
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#F7F7F2]/95 z-30">
          <div className="bg-white border border-[#DFE2DC] rounded-lg px-4 py-3 text-xs font-mono text-[#18181B]">
            Restoring 3D rendering context…
          </div>
        </div>
      )}

      {/* Projected 3D World-Anchored Micro-Badges & Contextual Incident Indicators */}
      <div
        className={`absolute inset-0 pointer-events-none overflow-clip z-10 transition-opacity duration-150 ${
          isMobile && hasActiveMobileSheet ? 'opacity-30' : 'opacity-100'
        }`}
      >
        {/* 12 Quiet Identifiable Rack Labels (R01–R12) + Contextual Incident Markers */}
        {facility.racks.map((rack) => {
          const isSelected = selectedRackId === rack.id;
          const isHovered = hoveredKey === `rack-${rack.id}`;
          const bState = thermosOn ? branchStates.get(rack.id) || 'idle' : 'idle';
          const displayTemp =
            rack.sensorAvailable || revealTruth ? rack.simulatedInletC : rack.estimatedInletC;
          const isRecoveryContributor =
            thermosOn &&
            facility.heatRecovery.isExporting &&
            facility.heatRecovery.activeRackIds.includes(rack.id);
          const utilPct = Math.round(rack.workloadUtil * 100);
          const deltaPct = thermosOn ? Math.round(rack.workloadDeltaPct) : 0;
          const rackIncident = rackIncidentsMap.get(rack.id) ?? null;
          const isIncidentSelected = Boolean(
            rackIncident && selectedIncidentId === rackIncident.id
          );

          const statusDotColor =
            viewMode === 'compute'
              ? !thermosOn
                ? '#64748B'
                : deltaPct >= 2
                ? '#059669'
                : deltaPct <= -2
                ? '#D97706'
                : '#0066FF'
              : viewMode === 'recovery'
              ? isRecoveryContributor
                ? '#059669'
                : '#94A3B8'
              : viewMode === 'cooling'
              ? rack.airflowRestriction >= 0.12
                ? '#D97706'
                : facility.activeCoolingMode === 'wet'
                ? '#0284C7'
                : '#0066FF'
              : rack.thermalRiskState === 'CRITICAL'
              ? '#DC2626'
              : rack.thermalRiskState === 'WARMING'
              ? '#D97706'
              : bState === 'green'
              ? '#059669'
              : '#64748B';

          const borderClass = isSelected
            ? 'bg-[#18181B] text-white border-[#18181B]'
            : rack.thermalRiskState === 'CRITICAL'
            ? 'bg-white/95 text-[#18181B] border-[#FCA5A5]'
            : rack.thermalRiskState === 'WARMING'
            ? 'bg-white/95 text-[#18181B] border-[#FCD34D]'
            : (viewMode === 'recovery' && isRecoveryContributor) ||
              (viewMode === 'compute' && deltaPct >= 2) ||
              bState === 'green'
            ? 'bg-white/95 text-[#18181B] border-[#6EE7B7]'
            : 'bg-white/92 text-[#18181B] border-[#D6D9DF] hover:border-[#94A3B8] hover:bg-white';

          const sensorBlindWhilePaused = !rack.sensorAvailable && !thermosOn && !revealTruth;
          const tempPrefix = !rack.sensorAvailable ? (revealTruth ? '' : '~') : '';
          const tempSuffix = !rack.sensorAvailable && revealTruth ? '°*' : '°';
          let badgeMetricText = sensorBlindWhilePaused
            ? 'Offline'
            : !rack.sensorAvailable
            ? `${tempPrefix}${displayTemp.toFixed(1)}° Est`
            : `${tempPrefix}${displayTemp.toFixed(1)}${tempSuffix}`;
          let badgeMetricClass = isSelected
            ? 'text-[#E4E7EC]'
            : sensorBlindWhilePaused
            ? 'text-[#B45309] font-semibold'
            : rack.thermalRiskState === 'CRITICAL'
            ? 'text-[#B91C1C] font-semibold'
            : rack.thermalRiskState === 'WARMING'
            ? 'text-[#B45309] font-medium'
            : !rack.sensorAvailable
            ? 'text-[#0066FF] font-semibold'
            : 'text-[#52565E]';

          if (viewMode === 'compute') {
            badgeMetricText =
              Math.abs(deltaPct) >= 2
                ? isExtraNarrow
                  ? `${deltaPct > 0 ? '+' : ''}${deltaPct}%`
                  : `${utilPct}% (${deltaPct > 0 ? '+' : ''}${deltaPct}%)`
                : `${utilPct}%`;
            badgeMetricClass = isSelected
              ? 'text-[#E4E7EC]'
              : deltaPct >= 2
              ? 'text-[#059669] font-semibold'
              : deltaPct <= -2
              ? 'text-[#B45309] font-semibold'
              : 'text-[#52565E]';
          } else if (viewMode === 'heat') {
            badgeMetricText = isExtraNarrow
              ? `${rack.exhaustTempC.toFixed(0)}°`
              : `Exh ${rack.exhaustTempC.toFixed(1)}°`;
            badgeMetricClass = isSelected
              ? 'text-[#E4E7EC]'
              : rack.exhaustTempC >= 37
              ? 'text-[#B45309] font-semibold'
              : 'text-[#52565E]';
          } else if (viewMode === 'recovery') {
            badgeMetricText = isRecoveryContributor
              ? `+${rack.recoveryExtractedKW.toFixed(1)}kW`
              : `${rack.exhaustTempC.toFixed(0)}°`;
            badgeMetricClass = isSelected
              ? 'text-[#E4E7EC]'
              : isRecoveryContributor
              ? 'text-[#059669] font-semibold'
              : 'text-[#8E929C]';
          } else if (viewMode === 'cooling') {
            badgeMetricText =
              rack.airflowRestriction >= 0.12
                ? isExtraNarrow
                  ? `−${Math.round(rack.airflowRestriction * 100)}%`
                  : `Restr −${Math.round(rack.airflowRestriction * 100)}%`
                : isExtraNarrow
                ? `${Math.round(rack.localAirflowPct)}%`
                : `Air ${Math.round(rack.localAirflowPct)}%`;
            badgeMetricClass = isSelected
              ? 'text-[#E4E7EC]'
              : rack.airflowRestriction >= 0.12
              ? 'text-[#B45309] font-semibold'
              : 'text-[#0066FF]';
          }

          // Immediate visual distinction on Facility Overview for warming, overheating, and sensor-offline racks
          const showMetricText =
            isSelected ||
            isHovered ||
            viewMode !== 'facility' ||
            rack.thermalRiskState !== 'HEALTHY' ||
            !rack.sensorAvailable;

          return (
            <div
              key={rack.id}
              ref={(el) => {
                rackBadgeRefs.current[rack.id] = el;
              }}
              className="absolute top-0 left-0 flex flex-col items-center gap-0.5 will-change-transform"
            >
              {/* Visible World-Anchored Incident Indicator (Click opens Incident Details) */}
              {rackIncident && (
                <button
                  type="button"
                  data-interactive="true"
                  title={
                    rackIncident.type === 'RESTRICTED_AIRFLOW'
                      ? `${rack.label} Airflow Restricted: cable clutter or dust blocking cooling intake`
                      : rackIncident.type === 'SENSOR_FAILURE'
                      ? `${rack.label} Sensor Failure: thermometer offline, virtual sensing active`
                      : `${rack.label}: ${rackIncident.title}`
                  }
                  aria-label={`Inspect incident on ${rack.label}: ${rackIncident.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIncident(isIncidentSelected ? null : rackIncident.id);
                  }}
                  className={`${
                    isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
                  } flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] border font-mono text-[8.5px] font-semibold leading-none whitespace-nowrap cursor-pointer shadow-[0_1px_3px_rgba(24,24,27,0.08)] transition-colors ${
                    isIncidentSelected
                      ? 'bg-[#18181B] text-white border-[#18181B]'
                      : rackIncident.severity === 'CRITICAL'
                      ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5] hover:bg-[#FEE2E2]'
                      : 'bg-[#FFFBEB] text-[#B45309] border-[#FCD34D] hover:bg-[#FEF3C7]'
                  }`}
                >
                  <span>!</span>
                  <span>{formatShortIncidentTag(rackIncident)}</span>
                </button>
              )}

              {/* Quiet Rack Identifier Badge (Click opens Rack Contextual Panel) */}
              <button
                type="button"
                data-interactive="true"
                data-rack-id={rack.label}
                aria-label={`${rack.label}: ${displayTemp.toFixed(1)} degrees Celsius, ${rack.thermalRiskState.toLowerCase()}`}
                onMouseEnter={() => setHoveredKey(`rack-${rack.id}`)}
                onMouseLeave={() =>
                  setHoveredKey((prev) => (prev === `rack-${rack.id}` ? null : prev))
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRack(isSelected ? null : rack.id);
                }}
                className={`${
                  isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
                } flex items-center gap-1 ${
                  isMobile ? 'px-1.5 py-1 text-[8.5px]' : 'px-1.5 py-0.5 text-[9.5px]'
                } rounded-[4px] border shadow-[0_1px_3px_rgba(24,24,27,0.06)] font-mono leading-none whitespace-nowrap cursor-pointer transition-colors ${borderClass}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: statusDotColor }}
                />
                <span className="font-semibold">{rack.label}</span>
                {showMetricText && (
                  <span
                    className={`${isMobile ? 'text-[8px]' : 'text-[9px]'} tabular-nums ${badgeMetricClass}`}
                  >
                    {badgeMetricText}
                  </span>
                )}
              </button>
            </div>
          );
        })}

        {/* Interactive CRAH Cooling Equipment World Anchor + Water Incident Marker */}
        <div
          ref={crahBadgeRef}
          className="absolute top-0 left-0 flex flex-col items-center gap-0.5 will-change-transform"
        >
          {waterIncident && (
            <button
              type="button"
              data-interactive="true"
              aria-label={`Inspect cooling water incident: ${waterIncident.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectIncident(
                  selectedIncidentId === waterIncident!.id ? null : waterIncident!.id
                );
              }}
              className={`${
                isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
              } px-1.5 py-0.5 rounded-[3px] border font-mono text-[8.5px] font-semibold leading-none whitespace-nowrap cursor-pointer ${
                selectedIncidentId === waterIncident.id
                  ? 'bg-[#18181B] text-white border-[#18181B]'
                  : 'bg-[#FFFBEB] text-[#B45309] border-[#FCD34D] hover:bg-[#FEF3C7]'
              }`}
            >
              ! Water {facility.waterRemainingL.toFixed(0)}L
            </button>
          )}
          <button
            type="button"
            data-interactive="true"
            aria-label="Inspect Smart Cooling equipment"
            onMouseEnter={() => setHoveredKey('cooling')}
            onMouseLeave={() => setHoveredKey((prev) => (prev === 'cooling' ? null : prev))}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPathway('cooling');
            }}
            className={`${
              isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
            } px-1.5 py-0.5 rounded-[4px] border shadow-[0_1px_3px_rgba(24,24,27,0.06)] font-mono text-[9px] leading-tight whitespace-nowrap cursor-pointer transition-colors ${
              isCoolingSelected
                ? 'bg-[#18181B] text-white border-[#18181B]'
                : viewMode === 'cooling' || isCoolingHovered
                ? 'bg-white text-[#18181B] border-[#0066FF]'
                : 'bg-white/90 text-[#52565E] border-[#D6D9DF] hover:text-[#18181B] hover:bg-white'
            }`}
          >
            <span className="font-semibold">COOLING</span>
            {(isCoolingSelected || isCoolingHovered || viewMode === 'cooling') && (
              <span className="ml-1 tabular-nums opacity-90">
                {facility.coolingSupplyC}°C · {facility.activeCoolingMode.toUpperCase()}
              </span>
            )}
          </button>
        </div>

        {/* Interactive Heat Reuse Equipment World Anchor */}
        <div
          ref={recoveryBadgeRef}
          className="absolute top-0 left-0 flex flex-col items-center will-change-transform"
        >
          <button
            type="button"
            data-interactive="true"
            aria-label="Inspect Heat Reuse equipment"
            onMouseEnter={() => setHoveredKey('recovery')}
            onMouseLeave={() => setHoveredKey((prev) => (prev === 'recovery' ? null : prev))}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPathway('recovery');
            }}
            className={`${
              isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
            } px-1.5 py-0.5 rounded-[4px] border shadow-[0_1px_3px_rgba(24,24,27,0.06)] font-mono text-[9px] leading-tight whitespace-nowrap cursor-pointer transition-colors ${
              isRecoverySelected
                ? 'bg-[#18181B] text-white border-[#18181B]'
                : viewMode === 'recovery' || isRecoveryHovered
                ? 'bg-white text-[#18181B] border-[#059669]'
                : 'bg-white/90 text-[#52565E] border-[#D6D9DF] hover:text-[#18181B] hover:bg-white'
            }`}
          >
            <span className="font-semibold">HEAT RECOVERY</span>
            {(isRecoverySelected || isRecoveryHovered || viewMode === 'recovery') && (
              <span
                className={`ml-1 tabular-nums ${
                  isRecoverySelected ? 'text-[#A7F3D0]' : 'text-[#059669]'
                }`}
              >
                {facility.heatRecovery.isExporting
                  ? `${facility.heatRecovery.extractedHeatKW.toFixed(1)} kW_th`
                  : 'Standby'}
              </span>
            )}
          </button>
        </div>

        {/* Path A — Conceptual Hydronic Heat Export 3D World Label */}
        <div
          ref={pathABadgeRef}
          className={`absolute top-0 left-0 px-2 py-0.5 rounded bg-[#F4FBF7]/96 border border-[#6EE7B7] shadow-[0_1px_4px_rgba(24,24,27,0.08)] text-center font-mono leading-tight whitespace-nowrap will-change-transform transition-opacity duration-150 ${
            viewMode === 'recovery' ? '' : 'hidden'
          }`}
        >
          <div className="text-[8.5px] font-semibold text-[#065F46]">CONCEPTUAL HEAT EXPORT</div>
          <div className="text-[8px] text-[#059669] font-semibold tabular-nums">
            {facility.heatRecovery.thermalEnergyCapturedKW.toFixed(1)} kW_th
          </div>
        </div>

        {/* Path B — Auxiliary Experimental Seebeck TEG 3D World Label */}
        <div
          ref={pathBBadgeRef}
          className={`absolute top-0 left-0 px-2 py-0.5 rounded bg-[#F5F9FF]/96 border border-[#93C5FD] shadow-[0_1px_4px_rgba(24,24,27,0.08)] text-center font-mono leading-tight whitespace-nowrap will-change-transform transition-opacity duration-150 ${
            viewMode === 'recovery' ? '' : 'hidden'
          }`}
        >
          <div className="text-[8.5px] font-semibold text-[#1E40AF]">AUX TEG (EXPERIMENTAL)</div>
          <div className="text-[8px] text-[#0066FF] font-semibold tabular-nums">
            {(facility.heatRecovery.tegGenerationKW * 1000).toFixed(0)} W
          </div>
        </div>

        {/* Interactive THERMOS Core World Anchor + Subtle Pending-Plan Cue */}
        <div
          ref={coreBadgeRef}
          className="absolute top-0 left-0 flex flex-col items-center gap-0.5 will-change-transform"
        >
          {facilitySurgeIncident && (
            <button
              type="button"
              data-interactive="true"
              aria-label={`Inspect facility heat alert: ${facilitySurgeIncident.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectIncident(
                  selectedIncidentId === facilitySurgeIncident!.id
                    ? null
                    : facilitySurgeIncident!.id
                );
              }}
              className={`${
                isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
              } px-1.5 py-0.5 rounded-[3px] border font-mono text-[8.5px] font-semibold leading-none whitespace-nowrap cursor-pointer ${
                selectedIncidentId === facilitySurgeIncident.id
                  ? 'bg-[#18181B] text-white border-[#18181B]'
                  : facilitySurgeIncident.severity === 'CRITICAL'
                  ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]'
                  : 'bg-[#FFFBEB] text-[#B45309] border-[#FCD34D]'
              }`}
            >
              ! {facilitySurgeIncident.affectedRacks.length} Racks Hot
            </button>
          )}
          <button
            type="button"
            data-interactive="true"
            aria-label="Inspect THERMOS Core status"
            onMouseEnter={() => setHoveredKey('thermos-core')}
            onMouseLeave={() => setHoveredKey((prev) => (prev === 'thermos-core' ? null : prev))}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCore();
            }}
            className={`${
              isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
            } flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] border shadow-[0_1px_3px_rgba(24,24,27,0.06)] font-mono text-[9px] leading-tight whitespace-nowrap cursor-pointer transition-colors ${
              isCoreSelected
                ? 'bg-[#18181B] text-white border-[#18181B]'
                : hasManualPendingCue
                ? 'bg-white text-[#0066FF] border-[#60A5FA] hover:bg-[#EFF6FF]'
                : isCoreHovered
                ? 'bg-white text-[#18181B] border-[#94A3B8]'
                : 'bg-white/90 text-[#18181B] border-[#D6D9DF] hover:bg-white'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                !thermosOn
                  ? 'bg-[#94A3B8]'
                  : isCoreGreen
                  ? 'bg-[#059669]'
                  : visualState === 'ESCALATION'
                  ? 'bg-[#DC2626]'
                  : 'bg-[#0066FF]'
              }`}
            />
            <span className="font-semibold">CORE</span>
            {hasManualPendingCue && !isCoreSelected && (
              <span className="text-[8.5px] font-semibold text-[#0066FF]">· Plan</span>
            )}
            {!thermosOn && (isCoreHovered || isCoreSelected) && (
              <span className="text-[8.5px] opacity-80">· PAUSED</span>
            )}
            {thermosOn && (isCoreHovered || isCoreSelected) && !hasManualPendingCue && (
              <span className="text-[8.5px] opacity-80">· {visualState}</span>
            )}
          </button>
        </div>

        {/* Discreet Interactive Job Routing Junction Anchor */}
        <button
          ref={computePathBadgeRef}
          type="button"
          data-interactive="true"
          aria-label="Inspect Job Routing"
          onMouseEnter={() => setHoveredKey('compute-flow')}
          onMouseLeave={() => setHoveredKey((prev) => (prev === 'compute-flow' ? null : prev))}
          onClick={(e) => {
            e.stopPropagation();
            onSelectPathway('compute');
          }}
          className={`${
            isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
          } absolute top-0 left-0 flex items-center gap-1 rounded-full border shadow-[0_1px_3px_rgba(24,24,27,0.08)] font-mono text-[8.5px] font-semibold leading-none whitespace-nowrap cursor-pointer transition-all will-change-transform ${
            isComputeSelected
              ? 'px-2 py-0.5 bg-[#18181B] text-white border-[#18181B]'
              : isComputeHovered || viewMode === 'compute'
              ? 'px-2 py-0.5 bg-white text-[#0066FF] border-[#0066FF]'
              : !thermosOn
              ? 'w-3.5 h-3.5 justify-center bg-white/90 border-[#CBD5E1] hover:px-2 hover:w-auto'
              : 'w-3.5 h-3.5 justify-center bg-white/90 border-[#93C5FD] hover:px-2 hover:w-auto'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              !thermosOn ? 'bg-[#94A3B8]' : isCoreGreen ? 'bg-[#059669]' : 'bg-[#0066FF]'
            }`}
          />
          {(isComputeSelected || isComputeHovered || viewMode === 'compute') && (
            <span>Job Routing</span>
          )}
        </button>

        {/* Discreet Interactive Heat Capture Junction Anchor */}
        <button
          ref={heatPathBadgeRef}
          type="button"
          data-interactive="true"
          aria-label="Inspect Heat Capture"
          onMouseEnter={() => setHoveredKey('heat-flow')}
          onMouseLeave={() => setHoveredKey((prev) => (prev === 'heat-flow' ? null : prev))}
          onClick={(e) => {
            e.stopPropagation();
            onSelectPathway('heat');
          }}
          className={`${
            isMobile && hasActiveMobileSheet ? 'pointer-events-none' : 'pointer-events-auto'
          } absolute top-0 left-0 flex items-center gap-1 rounded-full border shadow-[0_1px_3px_rgba(24,24,27,0.08)] font-mono text-[8.5px] font-semibold leading-none whitespace-nowrap cursor-pointer transition-all will-change-transform ${
            isHeatSelected
              ? 'px-2 py-0.5 bg-[#18181B] text-white border-[#18181B]'
              : isHeatHovered || viewMode === 'heat'
              ? 'px-2 py-0.5 bg-white text-[#B45309] border-[#D97706]'
              : 'w-3.5 h-3.5 justify-center bg-white/90 border-[#FCD34D] hover:px-2 hover:w-auto'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              facility.heatRecovery.isExporting ? 'bg-[#D97706]' : 'bg-[#94A3B8]'
            }`}
          />
          {(isHeatSelected || isHeatHovered || viewMode === 'heat') && <span>Heat Capture</span>}
        </button>
      </div>

      {/* Restrained Original Top-Left THERMOS Lockup, Inline Status & Quiet Thermal Key */}
      <div
        data-interactive="true"
        className={`absolute left-3.5 sm:left-4 top-3.5 z-20 flex flex-col items-start gap-1.5 pointer-events-auto transition-opacity duration-150 ${
          isMobile && hasActiveMobileSheet ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex items-center bg-white/92 border border-[#DFE2DC] rounded-md shadow-[0_1px_4px_rgba(24,24,27,0.06)] overflow-hidden">
          <button
            type="button"
            onClick={() => {
              onCanvasBackgroundClick();
              handleResetCamera();
            }}
            className="px-2.5 h-8 flex items-center gap-1.5 text-xs font-bold tracking-tight text-[#18181B] hover:bg-[#F1F1EC] transition-colors cursor-pointer whitespace-nowrap"
            title="Return to Facility Overview & reset camera"
          >
            <span>THERMOS</span>
          </button>
          <span className="h-4 w-px bg-[#ECEEE9]" aria-hidden="true" />
          <div className="px-2.5 h-8 flex items-center gap-1.5 font-mono text-[10.5px] tabular-nums text-[#52565E] whitespace-nowrap">
            <span className="hidden sm:inline">{facility.scenarioLabel}</span>
            <span className="hidden sm:inline text-[#C4C7CE]" aria-hidden="true">
              ·
            </span>
            {(() => {
              const peakC = Math.max(
                ...facility.racks.map((r) =>
                  r.sensorAvailable ? r.simulatedInletC : r.estimatedInletC
                )
              );
              return (
                <span
                  className={
                    peakC >= 30
                      ? 'text-[#DC2626] font-semibold'
                      : peakC >= 27.5
                      ? 'text-[#B45309] font-semibold'
                      : 'text-[#059669] font-semibold'
                  }
                >
                  Peak {peakC.toFixed(1)}°C
                </span>
              );
            })()}
          </div>
          {onOpenResults && (
            <>
              <span className="h-4 w-px bg-[#ECEEE9]" aria-hidden="true" />
              <button
                type="button"
                onClick={onOpenResults}
                className="px-2.5 h-8 text-[11px] font-medium text-[#0066FF] hover:bg-[#EFF6FF] transition-colors cursor-pointer whitespace-nowrap"
              >
                Results
              </button>
            </>
          )}
        </div>

        {/* Quiet Unboxed 1-Line Thermal Key */}
        <div className="hidden sm:flex items-center gap-2.5 px-1 text-[10px] text-[#52565E] font-medium select-none">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            <span>Normal &lt;27.5°</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            <span>Warming 27.5–30°</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
            <span>Overheating ≥30°</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-[#0066FF] bg-[#EFF6FF]" />
            <span>Offline (Est.)</span>
          </span>
        </div>
      </div>

      {/* Bottom-Left Discreet Camera Controls */}
      <div
        data-interactive="true"
        className={`absolute left-3.5 sm:left-4 bottom-3 z-20 flex items-center pointer-events-auto transition-opacity duration-150 ${
          isMobile && hasActiveMobileSheet ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex items-center bg-white/92 border border-[#DFE2DC] rounded-md shadow-[0_1px_4px_rgba(24,24,27,0.05)] overflow-hidden">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            className={`${
              isCoarsePointer || isMobile ? 'w-9 h-9' : 'p-1.5'
            } flex items-center justify-center text-[#52565E] hover:text-[#18181B] hover:bg-[#F1F1EC] transition-colors cursor-pointer`}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            className={`${
              isCoarsePointer || isMobile ? 'w-9 h-9' : 'p-1.5'
            } flex items-center justify-center text-[#52565E] hover:text-[#18181B] hover:bg-[#F1F1EC] border-l border-[#ECEEE9] transition-colors cursor-pointer`}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            aria-label="Reset camera position"
            className={`${
              isCoarsePointer || isMobile ? 'w-9 h-9' : 'p-1.5'
            } flex items-center justify-center text-[#52565E] hover:text-[#18181B] hover:bg-[#F1F1EC] border-l border-[#ECEEE9] transition-colors cursor-pointer`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
