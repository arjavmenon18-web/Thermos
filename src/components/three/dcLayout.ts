import type { FacilityViewMode } from '../../simulation/types';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface CameraPreset3D {
  pos: Vec3Tuple;
  target: Vec3Tuple;
}

// Compact 3 x 4 server rack installation dimensions (in 3D scene meters)
export const RACK_ROWS = 3;
export const RACK_COLS = 4;
export const RACK_COUNT = 12;

export const RACK_W = 1.14; // Cabinet width (X)
export const RACK_H = 2.26; // Cabinet 42U height (Y)
export const RACK_D = 1.10; // Cabinet depth (Z)

export const COL_PITCH = 1.62; // Tightly packed horizontal pitch (0.48m narrow conduit gap)
export const ROW_PITCH = 2.18; // Service aisle pitch (1.08m aisle for floor conduits & airflow)

// Center the 3 x 4 rack formation near origin
const FIRST_COL_X = -2.15;
const FIRST_ROW_Z = -2.18;

// Plinth bounds supporting racks + left spine/CRAH + right Heat Recovery skid
export const PLINTH_MIN_X = -5.15;
export const PLINTH_MAX_X = 6.05;
export const PLINTH_MIN_Z = -3.65;
export const PLINTH_MAX_Z = 4.35;
export const PLINTH_THICKNESS = 0.30;

// THERMOS Core & Infrastructure world anchors (grounded at y = 0 on plinth top)
export const SPINE_X = -3.35;
export const RECOVERY_COLLECTOR_X = 3.55;
export const CORE_POS: Vec3Tuple = { x: -3.35, y: 0, z: 3.38 };

export const CRAH_SPEC = {
  x: -4.28,
  z: -2.18,
  w: 1.12,
  h: 1.92,
  d: 1.42,
};

export const RECOVERY_SPEC = {
  x: 4.82,
  z: -2.05,
  w: 1.24,
  h: 1.72,
  d: 1.48,
};

// Default elevated isometric / three-quarter digital-twin camera
export const DEFAULT_CAMERA_POS: Vec3Tuple = { x: 8.9, y: 8.6, z: 10.4 };
export const DEFAULT_CAMERA_TARGET: Vec3Tuple = { x: 0.35, y: 0.72, z: 0.22 };

// Gentle camera glide presets framing the active equipment per observation view
export const CAMERA_PRESETS_BY_VIEW: Record<FacilityViewMode, CameraPreset3D> = {
  facility: {
    pos: { x: 8.9, y: 8.6, z: 10.4 },
    target: { x: 0.35, y: 0.72, z: 0.22 },
  },
  compute: {
    pos: { x: 6.4, y: 8.7, z: 10.7 },
    target: { x: -0.18, y: 0.72, z: 0.42 },
  },
  heat: {
    pos: { x: 8.1, y: 8.1, z: 9.5 },
    target: { x: 0.88, y: 0.92, z: -0.10 },
  },
  recovery: {
    // Balanced "bit of both" framing: keeps contributing racks visible on the left while
    // showcasing the right-flank 3D Heat Recovery + Path A & Path B dual conduits clearly
    pos: { x: 8.4, y: 6.1, z: 7.4 },
    target: { x: 2.35, y: 0.76, z: -0.82 },
  },
  cooling: {
    pos: { x: -7.7, y: 7.5, z: 9.7 },
    target: { x: -0.65, y: 0.72, z: -0.15 },
  },
};

// Dedicated Tour Stage 4 camera preset framing warm-rack hydronic collection into the recovery skid
export const COLLECTOR_FOCUS_CAMERA_PRESET: CameraPreset3D = {
  pos: { x: 8.6, y: 7.0, z: 8.6 },
  target: { x: 1.75, y: 0.76, z: -0.45 },
};

const REFERENCE_CAMERA_ASPECT = 1.48;

/**
 * Scales camera radius (and subtly centers target) when viewport aspect ratio narrows below 1.48
 * so horizontal FOV shrinkage on portrait phones, tablets, and split-screen panes never clips
 * left-flank CRAH/Core or right-flank Heat Recovery Path A/B assemblies.
 */
export function getAspectAdjustedCameraPreset(
  preset: CameraPreset3D,
  aspect: number
): CameraPreset3D {
  const safeAspect = Math.max(0.4, aspect || REFERENCE_CAMERA_ASPECT);
  if (safeAspect >= REFERENCE_CAMERA_ASPECT) {
    return {
      pos: { ...preset.pos },
      target: { ...preset.target },
    };
  }

  const distScale = Math.min(2.26, Math.pow(REFERENCE_CAMERA_ASPECT / safeAspect, 0.85));
  const portraitBlend = Math.min(1, (REFERENCE_CAMERA_ASPECT - safeAspect) / 0.9);
  // Gently pull X target closer to plinth center (0.35) on very narrow portrait screens so both flanks fit
  const adjTargetX = preset.target.x * (1 - 0.38 * portraitBlend) + 0.35 * (0.38 * portraitBlend);
  const adjTargetY = preset.target.y - 0.22 * portraitBlend;
  const adjTargetZ = preset.target.z;

  const dx = preset.pos.x - preset.target.x;
  const dy = preset.pos.y - preset.target.y;
  const dz = preset.pos.z - preset.target.z;

  return {
    pos: {
      x: Number((adjTargetX + dx * distScale).toFixed(3)),
      y: Number((adjTargetY + dy * distScale).toFixed(3)),
      z: Number((adjTargetZ + dz * distScale).toFixed(3)),
    },
    target: {
      x: Number(adjTargetX.toFixed(3)),
      y: Number(adjTargetY.toFixed(3)),
      z: Number(adjTargetZ.toFixed(3)),
    },
  };
}

export function getAspectCameraDistanceLimits(aspect: number): {
  minDistance: number;
  maxDistance: number;
} {
  const safeAspect = Math.max(0.4, aspect || REFERENCE_CAMERA_ASPECT);
  const distScale =
    safeAspect < REFERENCE_CAMERA_ASPECT
      ? Math.min(2.25, Math.pow(REFERENCE_CAMERA_ASPECT / safeAspect, 0.84))
      : 1;
  return {
    minDistance: 5.8,
    maxDistance: Number(Math.max(22.5, 22.5 * distScale * 1.18).toFixed(2)),
  };
}


export interface RackPlacement3D {
  id: number;
  row: number;
  col: number;
  x: number; // Center X
  z: number; // Center Z
  frontZ: number; // Front door Z (+Z faces front aisle)
  tapX: number; // Front-left vertical THERMOS light-bar X
  aisleZ: number; // Row floor conduit Z
}

export function getRowAisleZ(row: number): number {
  const clampedRow = Math.max(0, Math.min(RACK_ROWS - 1, row));
  return Number((FIRST_ROW_Z + clampedRow * ROW_PITCH + RACK_D * 0.5 + 0.34).toFixed(4));
}

export function getRackPlacement3D(rackId: number): RackPlacement3D {
  const row = Math.floor(rackId / RACK_COLS);
  const col = rackId % RACK_COLS;
  const x = Number((FIRST_COL_X + col * COL_PITCH).toFixed(4));
  const z = Number((FIRST_ROW_Z + row * ROW_PITCH).toFixed(4));
  const frontZ = Number((z + RACK_D * 0.5).toFixed(4));
  // Aligns with the front-left vertical THERMOS light-strip channel on each 3D cabinet
  const tapX = Number((x - RACK_W * 0.5 + 0.11).toFixed(4));
  const aisleZ = getRowAisleZ(row);
  return { id: rackId, row, col, x, z, frontZ, tapX, aisleZ };
}

/**
 * Orthogonal 3D floor pathway waypoints from THERMOS CORE to a specific rack's vertical light strip.
 */
export function getCoreToRackPoints3D(rackId: number, yHeight = 0.024): Vec3Tuple[] {
  const p = getRackPlacement3D(rackId);
  return [
    { x: CORE_POS.x, y: yHeight, z: CORE_POS.z },
    { x: SPINE_X, y: yHeight, z: p.aisleZ },
    { x: p.tapX, y: yHeight, z: p.aisleZ },
    { x: p.tapX, y: yHeight, z: p.frontZ + 0.02 },
  ];
}

/**
 * Orthogonal 3D floor pathway waypoints connecting source rack to receiver rack for workload transfers.
 */
export function getRackToRackPoints3D(
  fromRack: number,
  toRack: number,
  yHeight = 0.032
): Vec3Tuple[] {
  const src = getRackPlacement3D(fromRack);
  const dst = getRackPlacement3D(toRack);
  if (src.row === dst.row) {
    return [
      { x: src.tapX, y: yHeight, z: src.frontZ + 0.02 },
      { x: src.tapX, y: yHeight, z: src.aisleZ },
      { x: dst.tapX, y: yHeight, z: dst.aisleZ },
      { x: dst.tapX, y: yHeight, z: dst.frontZ + 0.02 },
    ];
  }
  return [
    { x: src.tapX, y: yHeight, z: src.frontZ + 0.02 },
    { x: src.tapX, y: yHeight, z: src.aisleZ },
    { x: SPINE_X, y: yHeight, z: src.aisleZ },
    { x: SPINE_X, y: yHeight, z: dst.aisleZ },
    { x: dst.tapX, y: yHeight, z: dst.aisleZ },
    { x: dst.tapX, y: yHeight, z: dst.frontZ + 0.02 },
  ];
}

/**
 * Orthogonal 3D floor hydronic recovery pathway from a hot rack's manifold tap
 * via the right-flank recovery collector into the Waste-Heat Recovery & Seebeck TEG skid.
 */
export function getRackToRecoveryPoints3D(rackId: number, yHeight = 0.030): Vec3Tuple[] {
  const p = getRackPlacement3D(rackId);
  const midAisleZ = getRowAisleZ(1);
  const intakeX = Number((RECOVERY_SPEC.x - RECOVERY_SPEC.w * 0.35).toFixed(4));
  const intakeZ = Number((RECOVERY_SPEC.z + RECOVERY_SPEC.d * 0.5 + 0.02).toFixed(4));
  if (Math.abs(p.aisleZ - midAisleZ) < 1e-3) {
    return [
      { x: p.tapX, y: yHeight, z: p.frontZ + 0.02 },
      { x: p.tapX, y: yHeight, z: p.aisleZ },
      { x: intakeX, y: yHeight, z: midAisleZ },
      { x: intakeX, y: yHeight, z: intakeZ },
    ];
  }
  return [
    { x: p.tapX, y: yHeight, z: p.frontZ + 0.02 },
    { x: p.tapX, y: yHeight, z: p.aisleZ },
    { x: RECOVERY_COLLECTOR_X, y: yHeight, z: p.aisleZ },
    { x: RECOVERY_COLLECTOR_X, y: yHeight, z: midAisleZ },
    { x: intakeX, y: yHeight, z: midAisleZ },
    { x: intakeX, y: yHeight, z: intakeZ },
  ];
}

/**
 * Path A (Useful Thermal Energy Recovery): 3D insulated hydronic export header
 * exiting the rear-right heat-exchanger flange toward the adjacent building heating terminal.
 */
export function getPathAThermalExportPoints3D(): Vec3Tuple[] {
  const { x, z, w, d } = RECOVERY_SPEC;
  return [
    { x: Number((x + w * 0.5).toFixed(4)), y: 0.54, z: Number((z - d * 0.18).toFixed(4)) },
    { x: 5.76, y: 0.54, z: Number((z - d * 0.18).toFixed(4)) },
    { x: 5.76, y: 0.09, z: Number((z - d * 0.18).toFixed(4)) },
    { x: 5.76, y: 0.09, z: -3.34 },
  ];
}

export const PATH_A_LABEL_ANCHOR: Vec3Tuple = { x: 5.76, y: 0.42, z: -3.22 };

/**
 * Path B (Auxiliary Seebeck TEG Electricity): Low-voltage solid-state DC bus routing from the
 * front-right Seebeck TEG junction block back to the facility sensor & valve-actuator bus.
 */
export function getPathBTegAuxPoints3D(): Vec3Tuple[] {
  const { x, z, w, d } = RECOVERY_SPEC;
  const frontRowZ = getRowAisleZ(2);
  return [
    { x: Number((x + w * 0.28).toFixed(4)), y: 0.28, z: Number((z + d * 0.5 + 0.02).toFixed(4)) },
    { x: Number((x + w * 0.28).toFixed(4)), y: 0.030, z: Number((z + d * 0.5 + 0.34).toFixed(4)) },
    { x: 5.18, y: 0.030, z: frontRowZ },
    { x: RECOVERY_COLLECTOR_X, y: 0.030, z: frontRowZ },
  ];
}

export const PATH_B_LABEL_ANCHOR: Vec3Tuple = { x: 5.18, y: 0.34, z: 0.85 };

/**
 * Interpolate a 3D position and tangent direction along a polyline for progress t in [0, 1].
 */
export function samplePolyline3D(
  waypoints: Vec3Tuple[],
  progress: number
): { pos: Vec3Tuple; dir: Vec3Tuple } {
  if (waypoints.length === 0) {
    return { pos: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 } };
  }
  if (waypoints.length === 1) {
    return { pos: { ...waypoints[0] }, dir: { x: 0, y: 0, z: 1 } };
  }
  const t = Math.max(0, Math.min(1, progress));
  if (t <= 0) {
    const a = waypoints[0];
    const b = waypoints[1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    return {
      pos: { ...a },
      dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len },
    };
  }
  if (t >= 1) {
    const a = waypoints[waypoints.length - 2];
    const b = waypoints[waypoints.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    return {
      pos: { ...b },
      dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len },
    };
  }
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const dx = waypoints[i + 1].x - waypoints[i].x;
    const dy = waypoints[i + 1].y - waypoints[i].y;
    const dz = waypoints[i + 1].z - waypoints[i].z;
    const len = Math.hypot(dx, dy, dz);
    lengths.push(len);
    total += len;
  }
  if (total <= 1e-6) {
    return { pos: { ...waypoints[0] }, dir: { x: 0, y: 0, z: 1 } };
  }

  let target = t * total;
  for (let i = 0; i < lengths.length; i++) {
    const segLen = lengths[i];
    if (target <= segLen || i === lengths.length - 1) {
      const localT = segLen > 1e-6 ? target / segLen : 0;
      const a = waypoints[i];
      const b = waypoints[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const inv = segLen > 1e-6 ? 1 / segLen : 0;
      return {
        pos: {
          x: a.x + dx * localT,
          y: a.y + dy * localT,
          z: a.z + dz * localT,
        },
        dir: {
          x: dx * inv,
          y: dy * inv,
          z: dz * inv,
        },
      };
    }
    target -= segLen;
  }
  const last = waypoints[waypoints.length - 1];
  return { pos: { ...last }, dir: { x: 0, y: 0, z: 1 } };
}

/**
 * Clamp OrbitControls pan target so the user never loses the 3x4 data-centre installation.
 */
export function clampCameraTarget(target: Vec3Tuple): Vec3Tuple {
  return {
    x: Math.max(-3.8, Math.min(4.6, target.x)),
    y: Math.max(0.1, Math.min(1.8, target.y)),
    z: Math.max(-3.0, Math.min(3.4, target.z)),
  };
}
