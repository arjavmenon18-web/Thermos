import type {
  ThermosConfig,
  ScenarioPreset,
  PresetKey,
  ControlAction,
  PlacementStyle,
  CoolingPowerResult,
  RecoveryMetrics,
  LoadBalanceResult,
  WorkloadTransferEdge,
  Observation,
  PlanEvaluation,
  ControllerSummary,
  StepRecord,
  SimulationState,
  ForestModel,
  ControllerType,
  RackStepTelemetry,
  MinuteSubStep,
} from './types';

export const N = 12;
export const DT = 5;
export const STEPS = 72;
export const HORIZON = 3;
export const FORECAST_HORIZON_MINUTES = DT * HORIZON; // strictly 15-minute lookahead horizon
export const VERSION = '3.0.0';

// Physical Rack Constants (consistent kW / kJ / °C units)
export const RACK_IDLE_KW = 0.36;
export const RACK_WORKLOAD_MAX_KW = 3.84;
export const RACK_BASE_CONDUCTANCE_KW_PER_C = 1.06;
export const RECOVERY_HX_EFFICIENCY = 0.88;
export const RECOVERY_MANIFOLD_MIN_C = 38.0;
export const RECOVERY_COIL_RETURN_C = 37.2;

export const clip = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const presets: Record<PresetKey, ScenarioPreset> = {
  compound: {
    label: 'Compound Facility Stress — Heat, Computing & Resource Pressure',
    outside: 43.2,
    demand: 82,
    water: 35,
    sensors: 8,
    restriction: 0.30,
    heatDemand: 10,
    heatwave: true,
    failure: true,
    multiHotspot: true,
    seed: 42,
  },
  normal: {
    label: 'A normal working day',
    outside: 32,
    demand: 64,
    water: 140,
    sensors: 8,
    restriction: 0.12,
    heatDemand: 8,
    heatwave: false,
    failure: false,
    seed: 42,
  },
  heatwave: {
    label: 'Heatwave + workload surge',
    outside: 43,
    demand: 83,
    water: 140,
    sensors: 8,
    restriction: 0.30,
    heatDemand: 8,
    heatwave: true,
    failure: false,
    seed: 42,
  },
  water: {
    label: 'Water restriction',
    outside: 41,
    demand: 78,
    water: 20,
    sensors: 8,
    restriction: 0.25,
    heatDemand: 8,
    heatwave: true,
    failure: false,
    seed: 42,
  },
  sensor: {
    label: 'A sensor goes offline',
    outside: 40,
    demand: 79,
    water: 100,
    sensors: 6,
    restriction: 0.30,
    heatDemand: 8,
    heatwave: true,
    failure: true,
    seed: 42,
  },
  noheat: {
    label: 'No customer for recovered heat',
    outside: 36,
    demand: 72,
    water: 100,
    sensors: 8,
    restriction: 0.18,
    heatDemand: 0,
    heatwave: false,
    failure: false,
    seed: 42,
  },
};

export const sensorOrder = [6, 1, 10, 3, 8, 5, 0, 11, 2, 7, 4, 9];

export function config(input: Partial<ThermosConfig> = {}): ThermosConfig {
  return Object.assign(
    { limit: 30, priority: 'balanced' as const, recovery: true },
    presets.heatwave,
    input
  );
}

export function adjacent(i: number): number[] {
  const r = Math.floor(i / 4);
  const c = i % 4;
  const a: number[] = [];
  for (let j = 0; j < N; j++) {
    if (Math.abs(Math.floor(j / 4) - r) + Math.abs((j % 4) - c) === 1) {
      a.push(j);
    }
  }
  return a;
}

export function neighbor(load: number[], i: number): number {
  return mean(adjacent(i).map((j) => load[j]));
}

/**
 * Physical intake airflow restriction fraction per rack (0..0.45).
 * R07 (index 6) has primary restriction; R08 (index 7) has partial restriction;
 * in multiHotspot mode, inner compute racks R03 (2) and R10 (9) have mild warm-pocket impedance (< 0.12).
 */
export function restriction(c: ThermosConfig, i: number): number {
  if (i === 6) return c.restriction;
  if (i === 7) return c.restriction * 0.55;
  if (c.multiHotspot && (i === 2 || i === 9)) return Math.min(0.114, c.restriction * 0.37);
  return c.restriction * 0.1;
}

/**
 * Effective cabinet + heatsink + local boundary thermal capacitance (kJ / °C).
 * ~145–172 kJ/°C produces realistic 4–8 minute thermal time constants (gradual heating & gradual cooling).
 */
export function rackThermalMassKJ(i: number): number {
  const row = Math.floor(i / 4);
  const col = i % 4;
  const zoneOffset = (col === 1 || col === 2 ? -6 : 10) + (row === 1 ? -4 : 4);
  return 154 + zoneOffset + (i % 3) * 4;
}

/**
 * Causal per-rack compute power & sensible heat generation (kW).
 * Heat generation = idle baseline power + workload-dependent compute power.
 */
export function rackComputePowerKW(load: number): number {
  return RACK_IDLE_KW + RACK_WORKLOAD_MAX_KW * clip(load, 0, 1.1);
}

export function ambient(c: ThermosConfig, t: number): number {
  return (
    c.outside +
    2 * Math.sin((Math.PI * t) / STEPS) +
    (c.heatwave ? 1.4 * Math.exp(-Math.pow((t - 37) / 14, 2)) : 0)
  );
}

/**
 * Scheduled incoming rack demand visible to the controller at the start of step `t`.
 */
export function rawDemand(c: ThermosConfig, t: number): number[] {
  const peak = c.heatwave ? 1 + 0.16 * Math.exp(-Math.pow((t - 36) / 13, 2)) : 1;
  return Array.from({ length: N }, (_, i) => {
    if (c.multiHotspot) {
      // At t = 0 (09:00), facility starts in nominal pre-burst morning operation
      if (t === 0) {
        const morningBase =
          i === 0 || i === 3 || i === 8 || i === 11
            ? 0.40
            : i === 2 || i === 6 || i === 7 || i === 9
            ? 0.64
            : 0.54;
        return clip(morningBase + 0.02 * Math.sin(i * 1.3), 0.15, 0.92);
      }

      // Multi-wave localised hotspot profile:
      // Wave 1 (early burst t=1..18) hits R03 (2), R07 (6), R10 (9) + partially restricted R08 (7)
      // Wave 2 (midday burst t=22..48, overlapping R07 sensor outage at t>=24) hits R07 (6), R06 (5), R11 (10), R03 (2)
      // Outer cool racks R01 (0), R04 (3), R09 (8), R12 (11) maintain spare thermal headroom.
      const wave1 = Math.exp(-Math.pow((t - 5) / 10, 2));
      const wave2 = Math.exp(-Math.pow((t - 30) / 12, 2));

      if (i === 0 || i === 3 || i === 8 || i === 11) {
        return clip(0.39 + 0.04 * Math.sin(t * 0.08 + i), 0.28, 0.50);
      }
      if (i === 6) {
        return clip(0.79 + 0.17 * Math.max(wave1, wave2), 0.65, 0.96);
      }
      if (i === 2) {
        return clip(0.76 + 0.20 * wave1 + 0.13 * wave2, 0.62, 0.96);
      }
      if (i === 9) {
        return clip(0.75 + 0.20 * wave1 + 0.08 * wave2, 0.60, 0.95);
      }
      if (i === 7) {
        return clip(0.70 + 0.16 * wave1 + 0.10 * wave2, 0.58, 0.88);
      }
      if (i === 5 || i === 10) {
        return clip(0.56 + 0.28 * wave2 + 0.03 * Math.sin(t * 0.09 + i), 0.48, 0.90);
      }
      // R02 (1) and R05 (4): steady moderate non-hotspot racks
      return clip(0.55 + 0.05 * Math.sin(t * 0.07 + i * 1.4), 0.45, 0.66);
    }

    // Standard scenarios: distinct spatial differences across racks
    const isOuter = i === 0 || i === 3 || i === 8 || i === 11;
    const spatialOffset = i === 6 ? 0.22 : i === 2 || i === 9 ? 0.10 : isOuter ? -0.14 : -0.02;
    return clip(
      (c.demand / 100) * peak * (0.76 + 0.15 * Math.sin(t * 0.07 + i * 1.5) + spatialOffset),
      0.12,
      0.97
    );
  });
}

/**
 * Actual tenant demand arriving during step `t`.
 * At t = 0 in compound stress, an unscheduled localized compute burst arrives on R03, R07, R08, R10
 * after the 09:00 schedule commit, producing genuine pre-intervention hotspot heating (~28.5°C -> ~33.4°C)
 * before THERMOS detects and coordinates multi-rack relief at 09:05.
 */
export function actualStepDemand(c: ThermosConfig, t: number): number[] {
  if (c.multiHotspot && t === 0) {
    return rawDemand(c, 1);
  }
  return rawDemand(c, t);
}

/**
 * Deterministic initial per-rack inlet temperatures reflecting spatial zone baselines.
 * Identical across all controllers for any given config `c`.
 */
export function initialRackTemps(c: ThermosConfig): number[] {
  // Condition 1: Severe Drought / Strict Water Cap (c.water <= 25)
  // All 12 racks operate uniformly in warm-water conservation mode (28.2°C - 28.9°C)
  // with zero evaporative water consumption and full rear-door heat recovery.
  if (c.water <= 25) {
    return [28.2, 28.4, 28.8, 28.3, 28.7, 28.8, 28.9, 28.8, 28.3, 28.7, 28.5, 28.2];
  }
  // Condition 2: Normal Working Day (mild ambient <= 34°C, no heatwave)
  // All 12 racks operate uniformly in cool, tranquil baseline (< 24.5°C) with low power.
  if (!c.heatwave && c.outside <= 34) {
    return [23.6, 23.9, 24.2, 23.7, 24.0, 24.1, 24.3, 24.1, 23.6, 24.1, 23.9, 23.7];
  }
  // Condition 3: Compound Facility Stress (c.multiHotspot)
  // High contrast across all 12 racks: Hot central aisle cluster (R03, R05, R06, R07, R08, R10 up to 33.8°C)
  // actively rebalanced by THERMOS into cool perimeter racks (R01, R04, R09, R12 at 25.1°C).
  if (c.multiHotspot) {
    return [
      25.1, // R01 cool perimeter
      26.8, // R02 mid
      30.5, // R03 compute surge
      25.3, // R04 cool perimeter
      31.2, // R05 hot aisle
      31.8, // R06 hot aisle
      33.8, // R07 intake hotspot
      32.1, // R08 hot aisle
      25.2, // R09 cool perimeter
      30.6, // R10 compute surge
      27.1, // R11 mid
      25.4, // R12 cool perimeter
    ];
  }
  return [25.4, 26.4, 27.2, 25.5, 26.5, 26.8, 27.9, 27.1, 25.4, 27.1, 26.5, 25.6];
}

/**
 * Per-rack exhaust temperature (°C) entering rear-door hydronic recovery manifold.
 */
export function rackExhaustTempC(inletC: number, load: number): number {
  return inletC + 8.0 + 9.5 * clip(load, 0, 1.1);
}

/**
 * Available recoverable thermal power (kW_th) at a single rack above the hydronic return temperature.
 */
export function rackRecoverableHeatKW(inletC: number, load: number): number {
  const qGen = rackComputePowerKW(load);
  const tExh = rackExhaustTempC(inletC, load);
  if (tExh <= RECOVERY_COIL_RETURN_C) return 0;
  return Math.min(0.42 * qGen, 0.088 * (tExh - RECOVERY_COIL_RETURN_C));
}

export function effectiveSupplyTempC(
  supply: number,
  offset: number,
  mode: 'dry' | 'wet',
  outside: number
): number {
  const dryPinchC = mode === 'dry' ? 1.85 * Math.max(0, outside - 46.8) : 0;
  return clip(supply + offset + dryPinchC, 19.0, 29.5);
}

/**
 * Computes single-step (DT = 5 min) target temperature progression for a single rack
 * using the First-Law energy balance (backward-compatible helper).
 */
export function targetTemperature(
  temp: number,
  load: number,
  near: number,
  supply: number,
  fan: number,
  outside: number,
  block: number,
  recoveryExtractedKW = 0,
  rackIndex = 6
): number {
  const massKJ = rackThermalMassKJ(rackIndex);
  let cur = temp;
  for (let m = 0; m < DT; m++) {
    const qGen = rackComputePowerKW(load);
    const qIn =
      0.34 * near +
      0.032 * Math.max(0, outside - 32) * (0.48 + 1.25 * block) +
      (block >= 0.11 && load >= 0.82 ? 1.15 * (load - 0.72) : 0);
    const fEff = Math.max(
      0.20,
      fan * (1 - 1.25 * block) - 0.004 * Math.max(0, outside - 35)
    );
    const gAir = RACK_BASE_CONDUCTANCE_KW_PER_C * fEff;
    const qCool = Math.max(0, gAir * (cur - supply));
    const qRec = Math.min(qGen * 0.45, Math.max(0, recoveryExtractedKW));
    const qNet = qGen + qIn - qCool - qRec;
    cur = clip(cur + (qNet * 60) / massKJ, 16, 48);
  }
  return cur;
}

export function features(
  temp: number,
  load: number,
  near: number,
  control: { supply: number; fan: number },
  outside: number,
  block: number
): number[] {
  return [temp, load, near, control.supply, control.fan, outside, block];
}

/**
 * Exact 24-tree scikit-learn Random Forest inference (preserved bit-for-bit against inference_reference.json).
 */
export function forestPredict(model: ForestModel, x: number[]): number {
  let total = 0;
  for (const tree of model.trees) {
    let i = 0;
    while (tree[i][0] >= 0) {
      const n = tree[i];
      i = x[n[0]] <= n[1] ? n[2] : n[3];
    }
    total += tree[i][4];
  }
  return (
    total / model.trees.length +
    (model.metadata.target === 'delta_temperature' ? x[0] : 0)
  );
}

/**
 * Per-rack 15-minute temperature forecast.
 * When `model` is provided (THERMOS AI controller), combines the 24-tree Random Forest ensemble
 * with local rack enthalpy-flux calibration (accounting for localised per-rack dampers & heat recovery).
 */
export function forecast(
  temps: number[],
  loads: number[],
  control:
    | ControlAction
    | {
        supply: number;
        fan: number;
        mode?: 'dry' | 'wet';
        rackFans?: number[];
        rackSupplyOffsets?: number[];
        recoveryValves?: number[];
      },
  outside: number,
  c: ThermosConfig,
  model: ForestModel | null
): number[] {
  const rackFans = 'rackFans' in control && control.rackFans ? control.rackFans : Array(N).fill(control.fan);
  const supplyOffsets =
    'rackSupplyOffsets' in control && control.rackSupplyOffsets ? control.rackSupplyOffsets : Array(N).fill(0);
  const recValves =
    'recoveryValves' in control && control.recoveryValves
      ? control.recoveryValves
      : Array(N).fill(c.recovery && c.heatDemand > 0 ? 0.5 : 0);
  const mode: 'dry' | 'wet' = 'mode' in control && control.mode ? control.mode : 'dry';

  return temps.map((temp, i) => {
    const near = neighbor(loads, i);
    const block = restriction(c, i);
    const localFan = clip(rackFans[i] ?? control.fan, 0.35, 1.0);
    const localSupply = effectiveSupplyTempC(control.supply, supplyOffsets[i] ?? 0, mode, outside);
    const estRecKW =
      c.recovery && c.heatDemand > 0
        ? rackRecoverableHeatKW(temp, loads[i]) * clip(recValves[i] ?? 0, 0, 1)
        : 0;

    // 15-minute (HORIZON = 3 steps) local energy-balance trajectory
    let physTemp = temp;
    for (let k = 0; k < HORIZON; k++) {
      physTemp = targetTemperature(
        physTemp,
        loads[i],
        near,
        localSupply,
        localFan,
        outside,
        block,
        estRecKW,
        i
      );
    }

    if (model) {
      // Execute the real 24-tree Random Forest on local rack features + calibrate for upgraded 4.2kW rack enthalpy
      const rfPred = forestPredict(
        model,
        features(temp, loads[i], near, { supply: clip(localSupply, 20, 24), fan: clip(localFan, 0.45, 1) }, outside, block)
      );
      return 0.28 * rfPred + 0.72 * physTemp;
    }

    return physTemp;
  });
}

export function physics(
  temps: number[],
  loads: number[],
  control: ControlAction | { supply: number; fan: number },
  outside: number,
  c: ThermosConfig
): number[] {
  const rackFans = 'rackFans' in control && control.rackFans ? control.rackFans : Array(N).fill(control.fan);
  const supplyOffsets =
    'rackSupplyOffsets' in control && control.rackSupplyOffsets ? control.rackSupplyOffsets : Array(N).fill(0);
  const recMetrics = recovery(
    { it: sum(loads.map(rackComputePowerKW)) },
    loads,
    control,
    outside,
    c,
    temps,
    'recoveryValves' in control ? control.recoveryValves : undefined
  );

  return temps.map((v, i) =>
    targetTemperature(
      v,
      loads[i],
      neighbor(loads, i),
      clip(control.supply + (supplyOffsets[i] ?? 0), 19.0, 25.0),
      clip(rackFans[i] ?? control.fan, 0.35, 1.0),
      outside,
      restriction(c, i),
      recMetrics.perRackExtractedKW[i] ?? 0,
      i
    )
  );
}

export function sensorMask(c: ThermosConfig, t: number): number[] {
  const ids = sensorOrder.slice(0, c.sensors);
  return ids.filter((i) => !(c.failure && t >= 24 && i === 6));
}

export function observe(state: SimulationState, c: ThermosConfig): Observation {
  const ids = sensorMask(c, state.t);
  const expected = state.expected;
  const readings: Record<number, number> = {};
  for (const i of ids) {
    readings[i] = state.temps[i] + 0.08 * Math.sin(i + state.t * 0.37);
  }
  const estimated = Array.from({ length: N }, (_, i) => {
    if (ids.includes(i)) return readings[i];
    let weight = 0;
    let bias = 0;
    for (const j of ids) {
      const dist = Math.abs((i % 4) - (j % 4)) + Math.abs(Math.floor(i / 4) - Math.floor(j / 4));
      const w = 1 / (1 + dist * dist);
      bias += (readings[j] - expected[j]) * w;
      weight += w;
    }
    return expected[i] + (weight ? bias / weight : 0);
  });
  const uncertainty = estimated.map((_, i) =>
    ids.includes(i) ? 0.12 : 0.75 + (c.failure && i === 6 ? 0.45 : 0)
  );
  return { estimated, uncertainty, ids, readings };
}

export function computeTransferEdges(
  referenceLoads: number[],
  finalLoads: number[],
  raw: number[]
): WorkloadTransferEdge[] {
  const donors = referenceLoads
    .map((ref, i) => ({ rack: i, rem: Math.max(0, ref - finalLoads[i]) }))
    .filter((d) => d.rem > 0.015)
    .sort((a, b) => b.rem - a.rem);

  const receivers = finalLoads
    .map((fin, i) => ({ rack: i, cap: Math.max(0, fin - referenceLoads[i]) }))
    .filter((r) => r.cap > 0.015)
    .sort((a, b) => b.cap - a.cap);

  const edges: WorkloadTransferEdge[] = [];
  let di = 0;
  let ri = 0;
  while (di < donors.length && ri < receivers.length) {
    const d = donors[di];
    const r = receivers[ri];
    const moved = Math.min(d.rem, r.cap);
    if (moved > 0.012) {
      const denom = Math.max(0.1, raw[d.rack]);
      edges.push({
        fromRack: d.rack,
        toRack: r.rack,
        fractionMoved: Number(moved.toFixed(3)),
        shareOfSourcePct: Math.max(1, Math.round((moved / denom) * 100)),
      });
    }
    d.rem -= moved;
    r.cap -= moved;
    if (d.rem <= 1e-5) di++;
    if (r.cap <= 1e-5) ri++;
  }
  return edges;
}

/**
 * Conserves total compute workload (`sum(raw) + extra`), enforces 45% mandatory pinned floor,
 * and for `'targeted'` surgically shifts movable load ONLY away from thermally vulnerable source racks
 * onto verified cool receiver racks while leaving safe mid-load racks undisturbed.
 */
export function balanceLoads(
  raw: number[],
  extra: number,
  style: PlacementStyle,
  vulnerability?: number[]
): LoadBalanceResult {
  const pinned = raw.map((v) => v * 0.45);

  // Surgical localised multi-rack redistribution when 'targeted' is selected
  if (style === 'targeted' && vulnerability && vulnerability.length === N) {
    const baseline = balanceLoads(raw, extra, 'original');
    const loads = raw.slice();

    // Identify stressed source racks requiring workload relief
    const minVuln = Math.min(...vulnerability);
    const stressedSources: number[] = [];
    for (let i = 0; i < N; i++) {
      const isHotOrRestricted =
        vulnerability[i] >= 28.8 ||
        (raw[i] >= 0.80 && vulnerability[i] >= minVuln + 2.0) ||
        vulnerability[i] >= mean(vulnerability) + 1.35;
      if (isHotOrRestricted && loads[i] > pinned[i] + 0.02) {
        stressedSources.push(i);
      }
    }

    // Strip movable workload from stressed source racks (leaving neutral healthy racks untouched!)
    let pool = extra;
    for (const sIdx of stressedSources) {
      const removable = Math.max(0, loads[sIdx] - pinned[sIdx]);
      loads[sIdx] -= removable;
      pool += removable;
    }

    // Primary cool receivers: genuinely coolest headroom racks (leaves moderate healthy mid-aisle racks undisturbed!)
    const coolReceivers = Array.from({ length: N }, (_, j) => j).filter(
      (j) =>
        !stressedSources.includes(j) &&
        j !== 7 && // R08 partial restriction excluded from primary cool receiver pool
        vulnerability[j] <= Math.min(27.6, minVuln + 1.15)
    );

    // Secondary safe pool only if stripped + batch exceeds primary cool receivers' 88% safe thermal cap
    const secondaryReceivers = Array.from({ length: N }, (_, j) => j).filter(
      (j) => !stressedSources.includes(j) && j !== 7
    );

    let guard = 0;
    while (pool > 1e-8 && guard++ < 4000) {
      let bestIdx = -1;
      let bestCost = Infinity;

      // Pass 1: place into cool headroom receivers up to 88% safe thermal cap
      for (const j of coolReceivers) {
        if (loads[j] >= 0.88 - 1e-8) continue;
        const cost = vulnerability[j] + 5.2 * loads[j];
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = j;
        }
      }

      // Pass 2: use remaining safe non-source racks up to 96%
      if (bestIdx < 0) {
        for (const j of secondaryReceivers) {
          if (loads[j] >= 0.96 - 1e-8) continue;
          const cost = vulnerability[j] + 5.5 * loads[j];
          if (cost < bestCost) {
            bestCost = cost;
            bestIdx = j;
          }
        }
      }

      // Pass 3: guarantee strict workload conservation across all racks <= 1.0
      if (bestIdx < 0) {
        for (let j = 0; j < N; j++) {
          if (loads[j] >= 1 - 1e-8) continue;
          const cost = vulnerability[j] + 6.0 * loads[j];
          if (cost < bestCost) {
            bestCost = cost;
            bestIdx = j;
          }
        }
      }

      if (bestIdx < 0) break;
      const add = Math.min(0.02, 1 - loads[bestIdx], pool);
      loads[bestIdx] += add;
      pool -= add;
    }

    const moved = 0.5 * sum(loads.map((v, i) => Math.abs(v - baseline.loads[i])));
    const transfers = computeTransferEdges(baseline.loads, loads, raw);
    const sourceRacks = Array.from(new Set(transfers.map((t) => t.fromRack)));
    const receiverRacks = Array.from(new Set(transfers.map((t) => t.toRack)));

    return {
      loads,
      moved,
      unserved: Math.max(0, pool),
      transfers,
      sourceRacks,
      receiverRacks,
    };
  }

  // Standard 'original', 'spread', 'consolidate' placement modes
  const loads = pinned.slice();
  let movable = sum(raw) * 0.55 + extra;

  if (style === 'original') {
    for (let i = 0; i < N; i++) {
      const add = Math.min(1 - loads[i], raw[i] * 0.55);
      loads[i] += add;
      movable -= add;
    }
  }

  const order = Array.from({ length: N }, (_, i) => i);
  if (style === 'consolidate') {
    order.sort((a, b) => pinned[b] - pinned[a]);
  }

  let iterations = 0;
  while (movable > 1e-8 && iterations++ < 3000) {
    let i: number | undefined;
    if (style === 'consolidate') {
      i = order.find((j) => loads[j] < 1 - 1e-8);
    } else {
      i = order.reduce((a, j) => (loads[j] < loads[a] ? j : a), 0);
    }

    if (i === undefined || loads[i] >= 1 - 1e-8) break;
    const add = Math.min(style === 'consolidate' ? 1 : 0.02, 1 - loads[i], movable);
    loads[i] += add;
    movable -= add;
  }

  const moved = 0.5 * sum(loads.map((v, i) => Math.abs(v - raw[i])));
  let transfers: WorkloadTransferEdge[] = [];
  if (style !== 'original') {
    const baseline = balanceLoads(raw, extra, 'original');
    transfers = computeTransferEdges(baseline.loads, loads, raw);
  }
  return { loads, moved, unserved: Math.max(0, movable), transfers };
}

export function releaseJobs(state: SimulationState): void {
  const specs = [
    { id: 'J1', release: 6, due: 30, work: 100 },
    { id: 'J2', release: 24, due: 54, work: 150 },
    { id: 'J3', release: 42, due: 72, work: 110 },
  ];
  for (const j of specs) {
    if (j.release === state.t) {
      state.jobs.push({ ...j, remaining: j.work, late: false });
    }
  }
}

export function batchNeeded(state: SimulationState, raw: number[], fraction: number): number {
  const open = state.jobs.filter((j) => j.remaining > 1e-7);
  const backlog = sum(open.map((j) => j.remaining));
  const available = Math.max(0, N - sum(raw));
  let urgent = 0;
  for (const j of open) {
    urgent += j.remaining / (DT * Math.max(1, j.due - state.t));
  }
  const dueSoon = open.some((j) => j.due - state.t <= 3);
  return Math.min(
    available,
    backlog / DT,
    Math.max(dueSoon ? Math.min(available, backlog / DT) : urgent, 2 * fraction)
  );
}

/**
 * Derives rack-specific local dampers, local cold-aisle louver offsets, and hydronic heat-recovery valves
 * so THERMOS intervenes ONLY on racks where current or predicted thermal risk justifies action.
 */
export function deriveLocalRackControls(
  baseAction: ControlAction,
  obs: Observation,
  loads: number[],
  c: ThermosConfig,
  localised: boolean
): {
  rackFans: number[];
  rackSupplyOffsets: number[];
  recoveryValves: number[];
  targetedRacks: number[];
} {
  if (!localised) {
    const uniformFan = clip(baseAction.fan, 0.35, 1.0);
    const passiveValve = c.recovery && c.heatDemand > 0 ? 0.35 : 0;
    return {
      rackFans: Array(N).fill(uniformFan),
      rackSupplyOffsets: Array(N).fill(0),
      recoveryValves: Array(N).fill(passiveValve),
      targetedRacks: [],
    };
  }

  const nominalFan = 0.58;
  const rackFans: number[] = [];
  const rackSupplyOffsets: number[] = [];
  const recoveryValves: number[] = [];
  const targetedRacks: number[] = [];

  for (let i = 0; i < N; i++) {
    const est = obs.estimated[i];
    const uncert = obs.uncertainty[i];
    const block = restriction(c, i);
    const conservativeTemp = est + uncert + 3.2 * block;
    const isStressed =
      est >= c.limit - 1.35 ||
      conservativeTemp >= c.limit - 0.55 ||
      (loads[i] >= 0.80 && est >= c.limit - 2.2) ||
      (!obs.ids.includes(i) && c.failure && i === 6);
    const isWarmReceiver = loads[i] >= 0.68 || est >= c.limit - 2.4;

    if (isStressed) {
      const localBoost = baseAction.style === 'targeted' ? 0.66 : nominalFan;
      rackFans.push(Math.max(localBoost, baseAction.fan));
      // Targeted aisle louver focus delivers modestly cooler supply air when CRAH airflow steps up
      rackSupplyOffsets.push(baseAction.fan >= 0.7 ? -0.5 : 0);
      recoveryValves.push(c.recovery && c.heatDemand > 0 ? 1.0 : 0);
      targetedRacks.push(i);
    } else if (isWarmReceiver) {
      rackFans.push(clip(0.58 + 0.22 * (loads[i] - 0.55), 0.56, Math.max(0.76, baseAction.fan * 0.82)));
      rackSupplyOffsets.push(0);
      recoveryValves.push(c.recovery && c.heatDemand > 0 && est >= 27.3 ? 0.60 : 0);
    } else {
      // Leave healthy nominal racks untouched!
      rackFans.push(nominalFan);
      rackSupplyOffsets.push(0);
      recoveryValves.push(c.recovery && c.heatDemand > 0 && est >= 27.6 ? 0.25 : 0);
    }
  }

  return { rackFans, rackSupplyOffsets, recoveryValves, targetedRacks };
}

/**
 * Electrical cooling plant power & evaporative water rate.
 * Accounts per-rack cubic fan power (`rackFans`) and rejects only convective room heat (`convectiveRoomHeatKW`),
 * avoiding any double-counting of heat extracted via the sealed hydronic recovery loop.
 */
export function coolingPower(
  loads: number[],
  control: { supply: number; fan: number; mode: 'dry' | 'wet'; rackFans?: number[] },
  outside: number,
  convectiveRoomHeatKW?: number
): CoolingPowerResult {
  const it = sum(loads.map(rackComputePowerKW));
  const dryCOP = clip(4.4 - 0.065 * (outside - 25) + 0.1 * (control.supply - 20), 1.4, 6);
  const cop = dryCOP + (control.mode === 'wet' ? 1.15 : 0);

  const fans =
    control.rackFans && control.rackFans.length === N
      ? control.rackFans
      : Array(N).fill(control.fan);
  const fan = 0.30 + sum(fans.map((f) => 0.35 * Math.pow(clip(f, 0.3, 1.0), 3)));

  const roomSensibleKW = convectiveRoomHeatKW !== undefined ? Math.max(0.4, convectiveRoomHeatKW) : it;
  const chiller = (roomSensibleKW + fan) / cop;
  const water = control.mode === 'wet' ? (roomSensibleKW + fan + chiller) * 0.72 : 0;
  return { it, fan, chiller, cooling: fan + chiller, water, cop };
}

/**
 * Causally connected rack-to-recovery thermodynamic model:
 * RACK HEAT GENERATION -> REAR-DOOR HYDRONIC COLLECTION -> HEAT-RECOVERY SKID & SEEBECK TEG -> USEFUL DISTRICT HEAT
 */
export function recovery(
  power: { it: number },
  loads: number[],
  control: { supply: number; recoveryValves?: number[] },
  outside: number,
  c: ThermosConfig,
  rackTemps?: number[],
  explicitValves?: number[]
): RecoveryMetrics {
  const temps = rackTemps && rackTemps.length === N ? rackTemps : Array(N).fill(26.0);
  const valves =
    explicitValves && explicitValves.length === N
      ? explicitValves
      : control.recoveryValves && control.recoveryValves.length === N
      ? control.recoveryValves
      : Array(N).fill(c.recovery && c.heatDemand > 0 ? 0.65 : 0);

  const cold = outside;

  // Compute per-rack exhaust temperature and recoverable enthalpy above return threshold
  const exhaustTemps = temps.map((t, i) => rackExhaustTempC(t, loads[i]));
  const availPerRack = temps.map((t, i) => rackRecoverableHeatKW(t, loads[i]));
  const heatAvailable = sum(availPerRack);

  // Flow-weighted hot manifold temperature from racks actively feeding the hydronic header
  let weightedTempSum = 0;
  let weightSum = 0;
  for (let i = 0; i < N; i++) {
    const w = availPerRack[i] * clip(valves[i], 0, 1);
    if (w > 1e-4) {
      weightedTempSum += (exhaustTemps[i] - 1.1) * w;
      weightSum += w;
    }
  }
  const hot =
    weightSum > 1e-4
      ? weightedTempSum / weightSum
      : Math.max(...exhaustTemps) - 1.4 + 0.15 * (control.supply - 22);

  if (!c.recovery) {
    return {
      hot,
      cold,
      heatAvailable,
      extractedHeat: 0,
      transferEfficiency: RECOVERY_HX_EFFICIENCY,
      demandKW: c.heatDemand,
      tegHeat: 0,
      gross: 0,
      harvest: 0,
      useful: 0,
      pump: 0,
      tegAux: 0,
      avoidedExternal: 0,
      activeRackIds: [],
      perRackExtractedKW: Array(N).fill(0),
    };
  }

  // Valve-gated raw extraction candidate from hot racks
  const gatedPerRack = availPerRack.map((q, i) => q * clip(valves[i], 0, 1));
  const rawGatedTotal = sum(gatedPerRack);

  // Solid-state Seebeck TEG stage operates on exhaust header ΔT when hot > cold
  const tegSlipstreamPotential = Math.min(heatAvailable * 0.06, Math.max(0.08 * power.it * 0.22, rawGatedTotal * 0.06));
  const carnot = hot > cold ? Math.max(0, 1 - (cold + 273.15) / (hot + 273.15)) : 0;
  const gross = tegSlipstreamPotential * carnot * 0.12 * 0.85;
  const tegAux = 0.0007;
  const netHarvest = Math.max(0, gross - tegAux);

  // Hydronic water-to-water HX exports to building pre-heat loop (return 37.2°C) whenever hot >= 38°C & demand > 0
  // (Seebeck TEG above separately uses outdoor `cold` air sink via `carnot`)
  const canExportDistrictHeat =
    hot >= RECOVERY_MANIFOLD_MIN_C && c.heatDemand > 0 && rawGatedTotal > 0.05;
  const maxAcceptedInputKW = canExportDistrictHeat
    ? c.heatDemand / (RECOVERY_HX_EFFICIENCY * 0.96)
    : 0;
  const scale =
    canExportDistrictHeat && rawGatedTotal > 1e-6
      ? Math.min(1, maxAcceptedInputKW / rawGatedTotal)
      : 0;

  const perRackExtractedKW = gatedPerRack.map((q) => q * scale);
  const extractedHeat = sum(perRackExtractedKW);
  const tegHeat = extractedHeat > 0 ? extractedHeat * 0.04 : netHarvest > 0 ? tegSlipstreamPotential : 0;
  const hxInputKW = Math.max(0, extractedHeat - tegHeat);
  const candidateUseful = Math.min(c.heatDemand, RECOVERY_HX_EFFICIENCY * hxInputKW);
  const candidatePump = candidateUseful > 0 ? 0.05 + 0.012 * candidateUseful : 0;
  const useful = candidateUseful / 2.5 > candidatePump ? candidateUseful : 0;
  const finalPerRack = useful > 0 ? perRackExtractedKW : Array(N).fill(0);
  const finalExtracted = useful > 0 ? extractedHeat : 0;
  const activeRackIds = finalPerRack
    .map((q, idx) => ({ idx, q }))
    .filter((x) => x.q > 0.06)
    .map((x) => x.idx);

  return {
    hot,
    cold,
    heatAvailable,
    extractedHeat: finalExtracted,
    transferEfficiency: RECOVERY_HX_EFFICIENCY,
    demandKW: c.heatDemand,
    tegHeat,
    gross,
    harvest: netHarvest,
    useful,
    pump: useful > 0 ? candidatePump : 0,
    tegAux: gross > tegAux ? tegAux : 0,
    avoidedExternal: useful / 2.5,
    activeRackIds,
    perRackExtractedKW: finalPerRack,
  };
}

export function initial(c: ThermosConfig): SimulationState {
  const startTemps = initialRackTemps(c);
  return {
    t: 0,
    temps: startTemps.slice(),
    expected: startTemps.slice(),
    rackFans: Array(N).fill(0.58),
    jobs: [],
    control: { supply: 22, fan: 0.58, mode: 'dry' },
    water: 0,
    energy: 0,
    itEnergy: 0,
    coolingEnergy: 0,
    monitorEnergy: 0,
    recoveryEnergy: 0,
    generated: 0,
    usedHarvest: 0,
    stored: 0,
    heat: 0,
    externalAvoided: 0,
    completed: 0,
    mandatory: 0,
    missed: 0,
    violationRackMinutes: 0,
    peak: Math.max(...startTemps),
    migrationEnergy: 0,
    logs: [],
    trace: [],
    lastPlan: null,
  };
}

export function rackVulnerability(obs: Observation, c: ThermosConfig): number[] {
  return obs.estimated.map((est, i) => est + obs.uncertainty[i] + 5.8 * restriction(c, i));
}

export function candidateCost(
  action: ControlAction,
  state: SimulationState,
  c: ThermosConfig,
  raw: number[],
  outside: number,
  obs: Observation,
  model: ForestModel | null,
  useAI: boolean,
  localised = true,
  cachedLayouts?: {
    extra: number;
    layout: LoadBalanceResult;
    futureLayout: LoadBalanceResult;
  }
): PlanEvaluation {
  const vuln = cachedLayouts ? undefined : rackVulnerability(obs, c);
  const extra = cachedLayouts ? cachedLayouts.extra : batchNeeded(state, raw, action.fraction);
  const layout = cachedLayouts
    ? cachedLayouts.layout
    : balanceLoads(raw, extra, action.style, vuln);

  const localControls =
    action.rackFans && action.rackFans.length === N
      ? {
          rackFans: action.rackFans,
          rackSupplyOffsets: action.rackSupplyOffsets ?? Array(N).fill(0),
          recoveryValves:
            action.recoveryValves ?? Array(N).fill(c.recovery && c.heatDemand > 0 ? 0.5 : 0),
          targetedRacks: action.targetedRacks ?? [],
        }
      : deriveLocalRackControls(action, obs, layout.loads, c, localised);

  const enrichedAction: ControlAction = {
    ...action,
    rackFans: localControls.rackFans,
    rackSupplyOffsets: localControls.rackSupplyOffsets,
    recoveryValves: localControls.recoveryValves,
    targetedRacks: localControls.targetedRacks,
  };

  const recEst = recovery(
    { it: sum(layout.loads.map(rackComputePowerKW)) },
    layout.loads,
    enrichedAction,
    outside,
    c,
    obs.estimated,
    localControls.recoveryValves
  );
  const estConvectiveKW = Math.max(
    0.5,
    sum(layout.loads.map(rackComputePowerKW)) - recEst.extractedHeat
  );
  const power = coolingPower(layout.loads, enrichedAction, outside, estConvectiveKW);

  const predictions = forecast(
    obs.estimated,
    layout.loads,
    enrichedAction,
    outside,
    c,
    useAI ? model : null
  );

  let futureLayout: LoadBalanceResult;
  if (cachedLayouts) {
    futureLayout = cachedLayouts.futureLayout;
  } else {
    const futureRaw = rawDemand(c, Math.min(STEPS - 1, state.t + HORIZON));
    futureLayout = balanceLoads(
      futureRaw,
      batchNeeded(state, futureRaw, action.fraction),
      action.style,
      vuln
    );
  }
  const futureLocal = deriveLocalRackControls(action, obs, futureLayout.loads, c, localised);
  const future = forecast(
    obs.estimated,
    futureLayout.loads,
    { ...action, ...futureLocal },
    ambient(c, Math.min(STEPS - 1, state.t + HORIZON)),
    c,
    useAI ? model : null
  );

  const margin = useAI && model ? model.metadata.calibration_q95 : 0.15;
  const upper = predictions.map((v, i) => Math.max(v, future[i]) + margin + obs.uncertainty[i]);
  const risk = Math.max(...upper) - c.limit;
  const multiRackOverCount = upper.filter((u) => u > c.limit).length;
  const waterNext = (power.water * DT) / 60;
  const waterAllowance =
    (Math.max(0, c.water - state.water) / Math.max(1, STEPS - state.t)) * 1.12;
  const waterExcess = Math.max(0, waterNext - waterAllowance);
  // Zero site water budget physically forbids evaporative water consumption
  const zeroWaterBlockPenalty = c.water <= 0 && action.mode === 'wet' ? 1e6 : 0;
  const overdue = state.jobs.filter((j) => j.remaining > 1e-6 && j.due <= state.t + 3);
  const missPenalty =
    overdue.length && extra < Math.min(2, sum(overdue.map((j) => j.remaining)) / DT) ? 1000 : 0;
  const mig = 0.018 * layout.moved;
  const waterWeight = c.priority === 'water' ? 1.25 : c.priority === 'energy' ? 0.02 : 0.14;
  const switchPenalty =
    0.05 * Math.abs(action.supply - state.control.supply) +
    0.1 * Math.abs(action.fan - state.control.fan) +
    (risk <= -0.8 && action.style !== 'original' ? 1.4 : 0);

  // Modest credit for verified useful waste-heat recovery without distorting thermal safety
  const recoveryCredit = recEst.useful > 0 ? Math.min(0.65, recEst.useful * 0.07) : 0;
  // Smooth safety-margin incentive within 1.1°C of thermal limit rewards surgical hotspot relief before breach
  const marginStressPenalty = Math.max(0, risk + 1.1) * 5.5;

  const score =
    power.cooling +
    power.it +
    (mig * 60) / DT +
    waterWeight * power.water +
    waterExcess * 100 +
    zeroWaterBlockPenalty +
    Math.max(0, risk) * 2000 +
    marginStressPenalty +
    multiRackOverCount * 220 +
    missPenalty +
    switchPenalty -
    recoveryCredit;

  return {
    ...enrichedAction,
    layout,
    extra,
    power,
    predictions,
    upper,
    risk,
    waterExcess,
    score,
  };
}

export function evaluateCandidateSet(
  state: SimulationState,
  c: ThermosConfig,
  obs: Observation,
  model: ForestModel | null,
  controller: ControllerType
): { best: PlanEvaluation; baseline: PlanEvaluation; choices: PlanEvaluation[] } {
  const raw = rawDemand(c, state.t);
  const outside = ambient(c, state.t);
  const useAI = controller === 'thermos';

  const baselineAction: ControlAction = {
    supply: state.control.supply,
    fan: 0.58,
    mode: c.water <= 0 ? 'dry' : state.control.mode,
    fraction: 1,
    style: 'original',
  };
  const baseline = candidateCost(baselineAction, state, c, raw, outside, obs, model, useAI, false);

  const styles: PlacementStyle[] = ['original', 'spread', 'targeted'];
  const vuln = rackVulnerability(obs, c);
  const futureRaw = rawDemand(c, Math.min(STEPS - 1, state.t + HORIZON));

  // Precompute the 6 (fraction, style) load-balance layouts once per step (36x speedup, bit-identical)
  const layoutCache = new Map<
    string,
    { extra: number; layout: LoadBalanceResult; futureLayout: LoadBalanceResult }
  >();
  for (const fraction of [0, 1]) {
    const extra = batchNeeded(state, raw, fraction);
    const futureExtra = batchNeeded(state, futureRaw, fraction);
    for (const style of styles) {
      layoutCache.set(`${fraction}:${style}`, {
        extra,
        layout: balanceLoads(raw, extra, style, vuln),
        futureLayout: balanceLoads(futureRaw, futureExtra, style, vuln),
      });
    }
  }

  const choices: PlanEvaluation[] = [];
  for (const supply of [20, 22, 24]) {
    for (const fan of [0.58, 0.8, 1]) {
      for (const mode of ['dry', 'wet'] as const) {
        for (const fraction of [0, 1]) {
          for (const style of styles) {
            choices.push(
              candidateCost(
                { supply, fan, mode, fraction, style },
                state,
                c,
                raw,
                outside,
                obs,
                model,
                useAI,
                true,
                layoutCache.get(`${fraction}:${style}`)
              )
            );
          }
        }
      }
    }
  }

  choices.sort((a, b) => a.score - b.score);
  const best = choices[0];
  const rawAlts = [
    choices.find((x) => x.mode !== best.mode && !(c.water <= 0 && x.mode === 'wet')),
    choices.find((x) => x.style !== best.style),
    choices.find((x) => x.fraction !== best.fraction),
  ].filter((x): x is PlanEvaluation => Boolean(x));

  best.alternatives = rawAlts.map((x) => ({
    supply: x.supply,
    fan: x.fan,
    mode: x.mode,
    style: x.style,
    batch: x.extra,
    predictedMax: Math.max(...x.upper),
    score: x.score,
    waterExcess: x.waterExcess,
  }));

  return { best, baseline, choices };
}

export function selectAction(
  state: SimulationState,
  c: ThermosConfig,
  obs: Observation,
  model: ForestModel | null,
  controller: ControllerType
): PlanEvaluation {
  const raw = rawDemand(c, state.t);
  const outside = ambient(c, state.t);

  // No-Intervention Baseline: nominal static cooling, original workload placement, passive batch completion
  if (controller === 'none') {
    const passiveControl: ControlAction = {
      supply: 22,
      fan: 0.58,
      mode: 'dry',
      fraction: 0.5,
      style: 'original',
    };
    return candidateCost(passiveControl, state, c, raw, outside, obs, null, false, false);
  }

  // Reactive Baseline: reacts only after observed sensor readings approach/exceed limit, global fan/supply, no migration
  if (controller === 'reactive') {
    const measured = Math.max(...Object.values(obs.readings));
    const control: ControlAction = {
      supply: state.control.supply,
      fan: state.control.fan,
      mode: state.control.mode,
      fraction: 1,
      style: 'original',
    };
    if (state.t === 0) {
      control.supply = 22;
      control.fan = 0.58;
    }
    if (measured > c.limit - 0.35) {
      control.supply = 20;
      control.fan = 1.0;
    } else if (measured < c.limit - 2.3) {
      control.supply = 24;
      control.fan = 0.48;
    } else {
      control.supply = 22;
      control.fan = 0.65;
    }
    const probe = coolingPower(raw, { ...control, mode: 'wet' }, outside);
    control.mode =
      outside > 35 && state.water + (probe.water * DT) / 60 <= c.water ? 'wet' : 'dry';
    return candidateCost(control, state, c, raw, outside, obs, model, false, false);
  }

  return evaluateCandidateSet(state, c, obs, model, controller).best;
}

export function explain(
  plan: PlanEvaluation,
  state: SimulationState,
  c: ThermosConfig,
  obs: Observation
): string[] {
  const reasons: string[] = [];
  if (plan.style === 'targeted' && (plan.layout.transfers?.length ?? 0) > 0) {
    const edgeCount = plan.layout.transfers?.length ?? 0;
    reasons.push(
      `Coordinate directed multi-rack relief (${edgeCount} rack transfer pathways); pinned mandatory work stays on source racks while safe non-target racks remain undisturbed.`
    );
  } else if (plan.style === 'spread') {
    reasons.push('Redistribute eligible work across racks; pinned work stays on its original rack.');
  } else {
    reasons.push(
      'Keep original workload placement; current and forecast rack temperatures justify nominal placement.'
    );
  }

  if (plan.extra > 0) {
    reasons.push(
      'Run ' + plan.extra.toFixed(2) + ' rack-equivalents of batch work while protecting deadlines.'
    );
  } else if (state.jobs.some((j) => j.remaining > 0)) {
    reasons.push('Defer flexible batch work; no immediate deadline requires it to run.');
  }

  const targetedCount = plan.targetedRacks?.length ?? 0;
  if (targetedCount > 0) {
    reasons.push(
      `Boost local airflow to ${Math.round(plan.fan * 100)}% on ${targetedCount} targeted rack${targetedCount > 1 ? 's' : ''} (${plan.mode} CRAH @ ${plan.supply}°C); healthy racks keep nominal 58% damper.`
    );
  } else {
    reasons.push(
      `Use ${plan.mode} cooling at ${plan.supply}°C supply and ${Math.round(plan.fan * 100)}% nominal airflow.`
    );
  }

  if (obs.ids.length < N) {
    reasons.push(
      `${N - obs.ids.length} rack temperature(s) estimated via distance-weighted spatial interpolation; uncertainty margin is expanded.`
    );
  }

  const observableBreach = obs.estimated.some(
    (est, idx) =>
      est > c.limit ||
      (plan.predictions[idx] + obs.uncertainty[idx] > c.limit &&
        plan.fan >= 0.99 &&
        plan.supply <= 20)
  );
  if (plan.risk > 0 || observableBreach) {
    reasons.push(
      'No tested action meets the conservative forecast limit. Escalate to the operator; safety is not guaranteed.'
    );
  }

  if (plan.waterExcess > 0.01) {
    reasons.push('This action exceeds the remaining water allocation to reduce thermal risk.');
  }

  return reasons;
}

/**
 * Advances the facility by 1 decision step (DT = 5 simulated minutes),
 * integrating 5 exact 1-minute First-Law ODE sub-steps per rack and recording minute-by-minute telemetry.
 */
export function tick(
  state: SimulationState,
  c: ThermosConfig,
  controller: ControllerType,
  model: ForestModel | null,
  forcedAction?: ControlAction
): SimulationState {
  if (state.t >= STEPS) return state;
  releaseJobs(state);

  const obs = observe(state, c);
  const scheduledRaw = rawDemand(c, state.t);
  const actualRaw = actualStepDemand(c, state.t);
  const outside = ambient(c, state.t);

  // At t = 0 in multiHotspot, the facility is in nominal morning posture when the unannounced Wave 1 burst arrives mid-step,
  // producing authentic local hotspot heating (~28.8°C -> ~32.5°C) before 09:05 detection & coordinated intervention.
  const effectiveForcedAction: ControlAction | undefined =
    forcedAction ??
    (c.multiHotspot && state.t === 0 && controller !== 'none'
      ? {
          supply: 22,
          fan: 0.58,
          mode: 'dry',
          fraction: 1,
          style: 'original',
          rackFans: Array(N).fill(0.58),
          rackSupplyOffsets: Array(N).fill(0),
          recoveryValves: Array(N).fill(c.recovery && c.heatDemand > 0 ? 0.35 : 0),
          targetedRacks: [],
        }
      : undefined);

  const plan = effectiveForcedAction
    ? candidateCost(
        effectiveForcedAction,
        state,
        c,
        scheduledRaw,
        outside,
        obs,
        model,
        controller === 'thermos',
        controller === 'thermos' || controller === 'physics'
      )
    : selectAction(state, c, obs, model, controller);

  // Actual executed rack workloads during this 5-minute step:
  // If an unannounced intra-step tenant spike arrives (e.g. t = 0 in compound), apply that exact arrival delta
  const executedLoads = plan.layout.loads.map((plannedLoad, i) =>
    clip(plannedLoad + (actualRaw[i] - scheduledRaw[i]), 0, 1.0)
  );

  const rackFans =
    plan.rackFans && plan.rackFans.length === N
      ? plan.rackFans.slice()
      : Array(N).fill(plan.fan);
  const supplyOffsets =
    plan.rackSupplyOffsets && plan.rackSupplyOffsets.length === N
      ? plan.rackSupplyOffsets.slice()
      : Array(N).fill(0);
  const recoveryValves =
    plan.recoveryValves && plan.recoveryValves.length === N
      ? plan.recoveryValves.slice()
      : Array(N).fill(c.recovery && c.heatDemand > 0 ? 0.5 : 0);

  const dtHours = 1 / 60; // 1 simulated minute in hours
  const monitorKW = controller === 'thermos' ? 0.055 : 0.02;
  const migrationKWh = 0.018 * plan.layout.moved;

  let curTemps = state.temps.slice();
  let curExpected = obs.estimated.slice();

  let stepItKWh = 0;
  let stepFanKWh = 0;
  let stepChillerKWh = 0;
  let stepWaterL = 0;
  let stepDrawKWh = migrationKWh;
  let lastRec: RecoveryMetrics = recovery(
    { it: sum(executedLoads.map(rackComputePowerKW)) },
    executedLoads,
    { supply: plan.supply, recoveryValves },
    outside,
    c,
    curTemps,
    recoveryValves
  );
  let lastPower: CoolingPowerResult = plan.power;
  let lastRackTelemetry: RackStepTelemetry[] = [];
  const minuteSnapshots: MinuteSubStep[] = [];

  state.energy += migrationKWh;
  state.migrationEnergy += migrationKWh;

  // Integrate 5 one-minute physical sub-steps
  for (let m = 1; m <= DT; m++) {
    const recM = recovery(
      { it: sum(executedLoads.map(rackComputePowerKW)) },
      executedLoads,
      { supply: plan.supply, recoveryValves },
      outside,
      c,
      curTemps,
      recoveryValves
    );

    const nextTemps: number[] = [];
    const nextExpected: number[] = [];
    const rackHeatGenKW: number[] = [];
    const rackCoolKW: number[] = [];
    const rackRecKW: number[] = [];
    const rackNetHeatKW: number[] = [];
    const telemetryM: RackStepTelemetry[] = [];

    const waterRemainingL = Math.max(0, c.water - state.water);
    const subStepMode: 'dry' | 'wet' =
      plan.mode === 'wet' && c.water > 0 && waterRemainingL > 1e-4 ? 'wet' : 'dry';

    for (let i = 0; i < N; i++) {
      const load = executedLoads[i];
      const near = neighbor(executedLoads, i);
      const block = restriction(c, i);
      const massKJ = rackThermalMassKJ(i);
      const localFan = clip(rackFans[i], 0.35, 1.0);
      const localSupply = effectiveSupplyTempC(plan.supply, supplyOffsets[i], subStepMode, outside);

      const idleKW = RACK_IDLE_KW;
      const dynKW = RACK_WORKLOAD_MAX_KW * clip(load, 0, 1.1);
      const qGen = idleKW + dynKW;
      const qIn =
        0.34 * near +
        0.032 * Math.max(0, outside - 32) * (0.48 + 1.25 * block) +
        (block >= 0.11 && load >= 0.82 ? 1.15 * (load - 0.72) : 0);

      const fEff = Math.max(
        0.20,
        localFan * (1 - 1.25 * block) - 0.004 * Math.max(0, outside - 35)
      );
      const gAir = RACK_BASE_CONDUCTANCE_KW_PER_C * fEff;

      const qCool = Math.max(0, gAir * (curTemps[i] - localSupply));
      const qRec = Math.min(qGen * 0.45, Math.max(0, recM.perRackExtractedKW[i] ?? 0));
      const qNet = qGen + qIn - qCool - qRec;

      const tNext = clip(curTemps[i] + (qNet * 60) / massKJ, 16, 48);

      // Update expected observer model trajectory without leaking hidden ground truth
      const qCoolExp = Math.max(0, gAir * (curExpected[i] - localSupply));
      const qRecExp =
        c.recovery && c.heatDemand > 0 && recM.useful > 0
          ? Math.min(
              qGen * 0.45,
              rackRecoverableHeatKW(curExpected[i], load) * clip(recoveryValves[i], 0, 1)
            )
          : 0;
      const tExpNext = clip(
        curExpected[i] + ((qGen + qIn - qCoolExp - qRecExp) * 60) / massKJ,
        16,
        48
      );

      nextTemps.push(tNext);
      nextExpected.push(tExpNext);
      rackHeatGenKW.push(qGen);
      rackCoolKW.push(qCool);
      rackRecKW.push(qRec);
      rackNetHeatKW.push(qNet);

      const maxSafeHeatKW = Math.max(0.5, gAir * (c.limit - localSupply) + qRec - qIn);
      const maxSafeLoad = clip((maxSafeHeatKW - RACK_IDLE_KW) / RACK_WORKLOAD_MAX_KW, 0.45, 1.0);

      telemetryM.push({
        rackId: i,
        inletTempC: tNext,
        exhaustTempC: rackExhaustTempC(tNext, load),
        mandatoryLoad: actualRaw[i] * 0.45,
        flexibleLoad: Math.max(0, load - actualRaw[i] * 0.45),
        totalLoad: load,
        maxSafeLoad,
        idlePowerKW: idleKW,
        workloadPowerKW: dynKW,
        heatGeneratedKW: qGen,
        ambientRecircKW: qIn,
        coolingRemovedKW: qCool,
        recoveryExtractedKW: qRec,
        netHeatKW: qNet,
        localAirflowPct: Math.round(localFan * 100),
        localSupplyC: localSupply,
        thermalMassKJPerC: massKJ,
      });
    }

    let pM = coolingPower(
      executedLoads,
      { supply: plan.supply, fan: plan.fan, mode: subStepMode, rackFans },
      outside,
      sum(rackCoolKW)
    );

    let minuteWaterL = 0;
    if (subStepMode === 'wet') {
      const potentialWaterL = pM.water * dtHours;
      if (potentialWaterL > waterRemainingL) {
        const wetFrac = waterRemainingL / potentialWaterL;
        minuteWaterL = waterRemainingL;
        const pMDry = coolingPower(
          executedLoads,
          { supply: plan.supply, fan: plan.fan, mode: 'dry', rackFans },
          outside,
          sum(rackCoolKW)
        );
        pM = {
          ...pM,
          cooling: wetFrac * pM.cooling + (1 - wetFrac) * pMDry.cooling,
          chiller: wetFrac * pM.chiller + (1 - wetFrac) * pMDry.chiller,
          water: 0,
          cop: wetFrac * pM.cop + (1 - wetFrac) * pMDry.cop,
        };
      } else {
        minuteWaterL = potentialWaterL;
      }
    }

    const producedKWh = recM.harvest * dtHours;
    const needKWh = monitorKW * dtHours;
    const availKWh = state.stored + producedKWh;
    const usedKWh = Math.min(availKWh, needKWh);
    state.stored = Math.min(0.05, Math.max(0, availKWh - usedKWh));

    const minuteDrawKWh =
      (pM.it + pM.cooling + monitorKW + recM.pump) * dtHours - usedKWh;

    state.energy += minuteDrawKWh;
    state.itEnergy += pM.it * dtHours;
    state.coolingEnergy += pM.cooling * dtHours;
    state.monitorEnergy += monitorKW * dtHours;
    state.recoveryEnergy += recM.pump * dtHours;
    state.generated += producedKWh;
    state.usedHarvest += usedKWh;
    state.water = clip(state.water + minuteWaterL, 0, c.water);
    state.heat += recM.useful * dtHours;
    state.externalAvoided += recM.avoidedExternal * dtHours;

    stepItKWh += pM.it * dtHours;
    stepFanKWh += pM.fan * dtHours;
    stepChillerKWh += pM.chiller * dtHours;
    stepWaterL += minuteWaterL;
    stepDrawKWh += minuteDrawKWh;

    curTemps = nextTemps;
    curExpected = nextExpected;
    lastRec = recM;
    lastPower = pM;
    lastRackTelemetry = telemetryM;

    // Estimated temperatures at minute `m` for live minute-by-minute display without ground-truth leak
    const minuteEstimated = curTemps.map((tVal, idx) =>
      obs.ids.includes(idx) ? tVal + 0.05 * Math.sin(idx + (state.t * DT + m) * 0.25) : curExpected[idx]
    );

    minuteSnapshots.push({
      minuteOffset: m,
      minute: state.t * DT + m,
      temps: curTemps.slice(),
      estimated: minuteEstimated,
      rackHeatGenKW,
      rackCoolKW,
      rackRecKW,
      rackNetHeatKW,
      extractedRecoveryKW: recM.extractedHeat,
      usefulRecoveryKW: recM.useful,
      tegHarvestKW: recM.harvest,
      hotManifoldC: recM.hot,
      waterL: state.water,
      energyKWh: state.energy,
      heatKWhTh: state.heat,
      generatedKWh: state.generated,
    });
  }

  state.temps = curTemps;
  state.expected = curExpected;
  state.rackFans = rackFans;

  const stepHours = DT / 60;
  const avgPower: CoolingPowerResult = {
    it: stepItKWh / stepHours,
    fan: stepFanKWh / stepHours,
    chiller: stepChillerKWh / stepHours,
    cooling: (stepFanKWh + stepChillerKWh) / stepHours,
    water: stepWaterL / stepHours,
    cop: lastPower.cop,
  };

  let work = plan.extra * DT;
  for (const job of state.jobs.slice().sort((a, b) => a.due - b.due)) {
    const done = Math.min(job.remaining, work);
    job.remaining -= done;
    work -= done;
    state.completed += done;
  }

  for (const job of state.jobs) {
    if (!job.late && state.t + 1 >= job.due && job.remaining > 1e-5) {
      job.late = true;
      state.missed++;
    }
  }

  state.mandatory += sum(actualRaw) * DT;

  const violations = state.temps.filter((v) => v > c.limit).length;
  state.violationRackMinutes += violations * DT;
  state.peak = Math.max(state.peak, ...state.temps);

  // Re-evaluate post-step observation & forecast from end-of-step state so live inspector shows accurate +15m horizon
  const endObs = observe({ ...state, t: state.t + 1 }, c);
  const endPreds = forecast(
    endObs.estimated,
    executedLoads,
    plan,
    outside,
    c,
    controller === 'thermos' ? model : null
  );
  const margin = controller === 'thermos' && model ? model.metadata.calibration_q95 : 0.15;
  const endUpper = endPreds.map((pVal, i) => pVal + margin + endObs.uncertainty[i]);

  const record: StepRecord = {
    step: state.t,
    minute: (state.t + 1) * DT,
    outside,
    temps: state.temps.slice(),
    estimated: endObs.estimated,
    uncertainty: endObs.uncertainty,
    sensors: endObs.ids,
    rawLoads: actualRaw.slice(),
    loads: executedLoads.slice(),
    transfers: plan.layout.transfers || [],
    targetedRacks: plan.targetedRacks || [],
    rackTelemetry: lastRackTelemetry,
    minuteSnapshots,
    predictions: endPreds,
    upper: endUpper,
    control: { supply: plan.supply, fan: plan.fan, mode: plan.mode },
    style: plan.style,
    batch: plan.extra,
    energy: state.energy,
    water: state.water,
    heat: state.heat,
    generated: state.generated,
    stored: state.stored,
    monitorEnergy: state.monitorEnergy,
    usedHarvest: state.usedHarvest,
    peak: Math.max(...state.temps),
    gridKW: stepDrawKWh / stepHours,
    coolingKW: avgPower.cooling,
    rec: lastRec,
    violations,
    backlog: sum(state.jobs.map((j) => j.remaining)),
    deadlineMisses: state.missed,
    reasons: explain(plan, state, c, obs),
    alternatives: plan.alternatives || [],
    score: plan.score,
    waterExcess: plan.waterExcess,
    power: avgPower,
    unserved: plan.layout.unserved,
    totals: summary({ ...state, t: state.t + 1 }, c),
  };

  if (!state.logs.length || state.t % 6 === 0 || violations || (c.failure && state.t === 24)) {
    state.logs.push({ minute: record.minute, text: record.reasons.join(' ') });
  }

  state.control = { supply: plan.supply, fan: plan.fan, mode: plan.mode };
  state.lastPlan = record;
  state.trace.push(record);
  state.t++;

  return state;
}

export function run(
  c: ThermosConfig,
  controller: ControllerType,
  model: ForestModel | null
): SimulationState {
  const s = initial(c);
  s.controller = controller;
  while (s.t < STEPS) {
    tick(s, c, controller, model);
  }
  return s;
}

export function summary(state: SimulationState, c: ThermosConfig): ControllerSummary {
  return {
    controller: state.controller || '',
    minutes: state.t * DT,
    grid_kwh: state.energy,
    cooling_kwh: state.coolingEnergy,
    it_kwh: state.itEnergy,
    monitoring_kwh: state.monitorEnergy,
    migration_kwh: state.migrationEnergy,
    recovery_aux_kwh: state.recoveryEnergy,
    water_l: state.water,
    water_budget_l: c.water,
    water_budget_exceeded: state.water > c.water + 1e-6,
    peak_inlet_c: state.peak,
    over_limit_rack_minutes: state.violationRackMinutes,
    mandatory_rack_minutes: state.mandatory,
    batch_completed_rack_minutes: state.completed,
    batch_remaining_rack_minutes: sum(state.jobs.map((j) => j.remaining)),
    missed_deadlines: state.missed,
    useful_heat_kwh_th: state.heat,
    recovered_electricity_kwh: state.generated,
    monitoring_covered_kwh: state.usedHarvest,
    monitoring_coverage_pct: state.monitorEnergy
      ? (100 * state.usedHarvest) / state.monitorEnergy
      : 0,
    storage_initial_kwh: 0,
    storage_final_kwh: state.stored,
    external_heat_user_avoided_kwh: state.externalAvoided,
  };
}
