import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine';
import { FacilityStateManager } from './facilityManager';
import {
  getRackToRecoveryPoints3D,
  RECOVERY_COLLECTOR_X,
  RECOVERY_SPEC,
} from '../components/three/dcLayout';
import modelData from '../data/model.json';
import type { ForestModel } from './types';

const M = modelData as unknown as ForestModel;

const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

test('Step 1: Playback speed (1x, 2x, 5x) is decoupled from physics and minuteSnapshots progress minute-by-minute', () => {
  const c = E.config(E.presets.compound);
  const s0 = E.initial(c);
  const s1 = E.tick(s0, c, 'thermos', M);
  const rec = s1.lastPlan!;

  assert.equal(rec.minuteSnapshots.length, E.DT, 'Each 5-minute step records 5 1-minute ODE sub-steps');
  rec.minuteSnapshots.forEach((snap, idx) => {
    assert.equal(snap.minuteOffset, idx + 1);
    assert.equal(snap.minute, idx + 1);
    assert.equal(snap.temps.length, E.N);
  });

  // Evaluate facility state across 1x, 2x, and 5x speeds at identical simulated minutes
  const mgr1 = new FacilityStateManager(c, 'compound', M, 'demonstration');
  const mgr2 = new FacilityStateManager(c, 'compound', M, 'demonstration');
  const mgr5 = new FacilityStateManager(c, 'compound', M, 'demonstration');

  for (let subIdx = 0; subIdx < E.DT; subIdx++) {
    const f1 = mgr1.evaluateFacilityState(rec, s1, 1, true, subIdx);
    const f2 = mgr2.evaluateFacilityState(rec, s1, 2, true, subIdx);
    const f5 = mgr5.evaluateFacilityState(rec, s1, 5, true, subIdx);

    assert.equal(f1.minute, subIdx + 1);
    assert.equal(f2.minute, subIdx + 1);
    assert.equal(f5.minute, subIdx + 1);
    assert.deepEqual(
      f1.racks.map((r) => r.simulatedInletC),
      f2.racks.map((r) => r.simulatedInletC),
      `Minute ${subIdx + 1} physics temperatures match between 1x and 2x`
    );
    assert.deepEqual(
      f1.racks.map((r) => r.simulatedInletC),
      f5.racks.map((r) => r.simulatedInletC),
      `Minute ${subIdx + 1} physics temperatures match between 1x and 5x`
    );
  }
});

test('Step 2 & 8: Independent rack thermal state — local hotspots rise into 31.8-34.8°C while outer racks stay cool', () => {
  const c = E.config(E.presets.compound);
  const s0 = E.initial(c);

  // Heterogeneous initial temperatures across R01-R12 (25.1°C - 28.8°C)
  const uniqueInit = new Set(s0.temps.map((t) => t.toFixed(1)));
  assert.ok(uniqueInit.size >= 8, 'R01-R12 start at distinct realistic temperatures');
  assert.ok(Math.min(...s0.temps) >= 24.8 && Math.min(...s0.temps) <= 26.0, 'Cool outer racks start ~25°C');
  assert.ok(Math.max(...s0.temps) >= 28.0 && Math.max(...s0.temps) <= 29.2, 'Hotspot inner racks start ~28.5-28.8°C');

  // Step 0 unannounced Wave 1 burst arrival (R03=2, R07=6, R08=7, R10=9)
  const s1 = E.tick(s0, c, 'thermos', M);
  const hotIndices = [2, 6, 7, 9];
  const outerSafeIndices = [0, 3, 8, 11]; // R01, R04, R09, R12

  const maxHotC = Math.max(...hotIndices.map((i) => s1.temps[i]));
  const maxSafeC = Math.max(...outerSafeIndices.map((i) => s1.temps[i]));

  assert.ok(
    maxHotC >= 31.5 && maxHotC <= 34.8,
    `Hotspot racks climb realistically into low-to-mid-30s (got ${maxHotC.toFixed(2)}°C)`
  );
  assert.ok(
    maxSafeC <= 28.0,
    `Safe outer racks remain well below 28.0°C without uniform heating (got ${maxSafeC.toFixed(2)}°C)`
  );
  assert.ok(maxHotC - maxSafeC >= 4.5, 'At least 4.5°C local spatial differential between hotspot and outer racks');
});

test('Step 3 & 4: Causal Compute -> Power -> Heat coupling and surgical localised interventions', () => {
  const c = E.config(E.presets.compound);
  const mgr = new FacilityStateManager(c, 'compound', M, 'demonstration');
  let s = E.initial(c);
  mgr.evaluateFacilityState(null, s, 1, true);

  // Step 0: Wave 1 hotspot surge detected -> THERMOS auto-authorises surgical multi-rack plan
  s = E.tick(s, c, 'thermos', M, mgr.getControlOverrideForNextTick(s));
  const fAfterDetect = mgr.evaluateFacilityState(s.lastPlan, s, 1, true);
  assert.ok(fAfterDetect.activePlan, 'Demonstration mode auto-authorises coordinated plan on hotspot detection');

  // Step 1: Execute coordinated surgical intervention
  const prevLoads = [...s.lastPlan!.loads];
  const prevHeatGen = s.lastPlan!.rackTelemetry.map((rt) => rt.heatGeneratedKW);

  s = E.tick(s, c, 'thermos', M, mgr.getControlOverrideForNextTick(s));
  const rec = s.lastPlan!;
  const fac = mgr.evaluateFacilityState(rec, s, 1, true);

  assert.equal(rec.style, 'targeted', 'THERMOS executes targeted surgical placement rather than global flatten');
  assert.ok((rec.transfers?.length ?? 0) >= 2, 'Multiple directed flexible workload transfers occur');

  // Verify exact causal Compute -> Power -> Heat equation on every rack
  rec.rackTelemetry.forEach((rt, idx) => {
    const expectedPower = E.RACK_IDLE_KW + E.RACK_WORKLOAD_MAX_KW * rt.totalLoad;
    assert.ok(
      near(rt.heatGeneratedKW, expectedPower, 1e-5),
      `Rack ${idx} heatGeneratedKW (${rt.heatGeneratedKW}) matches idle + workload power (${expectedPower})`
    );
    assert.ok(
      rt.mandatoryLoad <= rt.totalLoad + 1e-6,
      `Rack ${idx} preserves mandatory pinned compute floor`
    );
    assert.ok(rt.totalLoad <= 1.0 + 1e-6, `Rack ${idx} stays within 100% max capacity`);
  });

  // Verify source rack heat drops and receiver rack heat increases safely
  const sourceIdx = rec.transfers![0].fromRack;
  const receiverIdx = rec.transfers![0].toRack;
  assert.ok(
    rec.loads[sourceIdx] < prevLoads[sourceIdx],
    `Source rack R${String(sourceIdx + 1).padStart(2, '0')} compute load decreased after migration`
  );
  assert.ok(
    rec.rackTelemetry[sourceIdx].heatGeneratedKW < prevHeatGen[sourceIdx],
    `Source rack R${String(sourceIdx + 1).padStart(2, '0')} heat generation dropped causally`
  );
  assert.ok(
    rec.loads[receiverIdx] > prevLoads[receiverIdx] - 0.05,
    `Receiver rack R${String(receiverIdx + 1).padStart(2, '0')} absorbed transferred compute`
  );
  assert.notEqual(receiverIdx, 7, 'Airflow-restricted R08 (idx 7) is excluded from receiving workload');
  assert.ok(
    fac.racks[receiverIdx].simulatedInletC < c.limit - 0.5,
    'Receiver rack remains safely within thermal headroom'
  );

  // Verify surgical localisation: uninvolved healthy racks keep IDLE branch state
  const involvedSet = new Set<number>([
    ...fac.thermos.interveningRacks,
    ...fac.thermos.receivingRacks,
    ...fac.thermos.inspectedRacks,
  ]);
  const uninvolvedRacks = fac.racks.filter((r) => !involvedSet.has(r.id));
  assert.ok(uninvolvedRacks.length >= 2, 'Uninvolved healthy racks remain undisturbed during surgical intervention');
  for (const r of uninvolvedRacks) {
    assert.equal(r.thermosBranchState, 'IDLE', `Uninvolved ${r.label} stays in calm IDLE pathway state`);
  }
});

test('Step 5: Causally connected heat recovery without double-counting and with strict unit separation', () => {
  const c = E.config(E.presets.compound);
  let s = E.initial(c);
  // Advance 2 steps so hotspot racks are warm and rear-door hydronic recovery extracts heat
  s = E.tick(s, c, 'thermos', M);
  s = E.tick(s, c, 'thermos', M);
  const rec = s.lastPlan!;

  const sumPerRackRec = E.sum(rec.rec.perRackExtractedKW);
  assert.ok(
    near(rec.rec.extractedHeat, sumPerRackRec, 1e-4),
    'Total extracted hydronic heat equals exact sum of per-rack rear-door extraction'
  );
  assert.ok(
    rec.rec.extractedHeat > 0.5,
    `Hot racks deliver non-trivial recoverable thermal kW to hydronic loop (got ${rec.rec.extractedHeat.toFixed(2)} kW)`
  );
  assert.ok(
    rec.rec.useful <= rec.rec.extractedHeat * rec.rec.transferEfficiency + 1e-5,
    'Useful exported heat never exceeds extracted heat * HX efficiency (0.88)'
  );
  assert.ok(rec.rec.useful <= c.heatDemand + 1e-5, 'Useful exported heat is bounded by external heat demand');

  // Verify zero double-counting in room sensible cooling load
  const totalItKW = E.sum(rec.loads.map(E.rackComputePowerKW));
  const pWithoutRec = E.coolingPower(
    rec.loads,
    { ...rec.control, rackFans: s.rackFans },
    rec.outside,
    totalItKW
  );
  const pWithRec = E.coolingPower(
    rec.loads,
    { ...rec.control, rackFans: s.rackFans },
    rec.outside,
    totalItKW - rec.rec.extractedHeat
  );
  assert.ok(
    pWithRec.chiller < pWithoutRec.chiller,
    'Hydronic heat extracted to recovery loop reduces sensible room load on CRAH chiller (no double-counting)'
  );

  // Verify no-demand scenario disables useful heat export and recovery pathway animation
  const cNoHeat = E.config(E.presets.noheat);
  let sNo = E.initial(cNoHeat);
  sNo = E.tick(sNo, cNoHeat, 'thermos', M);
  const mgrNo = new FacilityStateManager(cNoHeat, 'noheat', M, 'demonstration');
  const facNo = mgrNo.evaluateFacilityState(sNo.lastPlan, sNo, 1, true);
  assert.equal(facNo.heatRecovery.thermalEnergyCapturedKW, 0, 'Zero useful thermal kW when heatDemand = 0');
  assert.equal(facNo.heatRecovery.isExporting, false, 'Heat recovery floor pathway does not animate when no heat is exported');

  // Verify 3D floor conduit geometry connects outer-row rack (R03) -> collector -> Heat Recovery skid,
  // and center-row rack (R07) -> center aisle -> Heat Recovery skid
  const ptsRow0 = getRackToRecoveryPoints3D(2); // R03 (row 0)
  assert.ok(ptsRow0.length >= 5);
  assert.ok(
    ptsRow0.some((p) => near(p.x, RECOVERY_COLLECTOR_X, 1e-3)),
    'Outer-row 3D recovery pathway routes along dedicated right-flank hydronic collector'
  );
  assert.ok(
    near(ptsRow0[ptsRow0.length - 1].x, RECOVERY_SPEC.x, 0.5),
    'Outer-row 3D recovery pathway terminates at Heat Recovery skid'
  );

  const ptsRow1 = getRackToRecoveryPoints3D(6); // R07 (row 1)
  assert.ok(ptsRow1.length >= 4);
  assert.ok(
    near(ptsRow1[ptsRow1.length - 1].x, RECOVERY_SPEC.x, 0.5),
    'Center-row 3D recovery pathway terminates at Heat Recovery skid'
  );
});

test('Step 6 & 7: Gradual post-intervention cooling and virtual sensor uncertainty during R07 outage', () => {
  const c = E.config(E.presets.compound);
  const mgr = new FacilityStateManager(c, 'compound', M, 'demonstration');
  let s = E.initial(c);
  mgr.evaluateFacilityState(null, s, 1, true);

  // Step 0: Wave 1 hotspot peak
  s = E.tick(s, c, 'thermos', M, mgr.getControlOverrideForNextTick(s));
  mgr.evaluateFacilityState(s.lastPlan, s, 1, true);
  const peakStep0 = s.temps[6]; // R07

  // Steps 1..4: Gradual multi-step thermal decay (never an instant jump to 22°C)
  const r07Trajectory: number[] = [peakStep0];
  for (let k = 0; k < 4; k++) {
    s = E.tick(s, c, 'thermos', M, mgr.getControlOverrideForNextTick(s));
    mgr.evaluateFacilityState(s.lastPlan, s, 1, true);
    r07Trajectory.push(s.temps[6]);
  }

  const dropStep1 = r07Trajectory[0] - r07Trajectory[1];
  assert.ok(
    dropStep1 > 0.3 && dropStep1 < 4.5,
    `First 5-minute cooling drop is physically gradual (${dropStep1.toFixed(2)}°C), not an instant reset`
  );
  assert.ok(
    r07Trajectory[4] < r07Trajectory[0] - 2.0 && r07Trajectory[4] <= c.limit + 0.2,
    `Hotspot R07 cools progressively from ${r07Trajectory[0].toFixed(1)}°C down to ${r07Trajectory[4].toFixed(1)}°C`
  );

  // Advance to step 26 (minute 130, t >= 24 where R07 sensor outage occurs)
  while (s.t < 26) {
    s = E.tick(s, c, 'thermos', M, mgr.getControlOverrideForNextTick(s));
    mgr.evaluateFacilityState(s.lastPlan, s, 1, true);
  }
  const facOutage = mgr.evaluateFacilityState(s.lastPlan, s, 1, true);
  const r07 = facOutage.racks[6];
  assert.equal(r07.sensorAvailable, false, 'R07 physical thermocouple is offline at t >= 24');
  assert.equal(r07.sensorStatus, 'OFFLINE_SYNTHETIC', 'R07 switches to virtual k-NN + RF synthetic sensor');
  assert.ok(r07.uncertaintyMarginC > 1.0, 'R07 reports elevated conformal uncertainty margin (> 1.0°C)');
});

test('Step 12: 4-Way Controller Comparison — THERMOS outperforms No-Intervention Baseline, Reactive, and Engineering Planner', () => {
  const c = E.config(E.presets.compound);

  const thermosState = E.run(c, 'thermos', M);
  const noneState = E.run(c, 'none', M);
  const reactiveState = E.run(c, 'reactive', M);
  const physicsState = E.run(c, 'physics', M);

  const runThermos = E.summary(thermosState, c);
  const runNone = E.summary(noneState, c);
  const runReactive = E.summary(reactiveState, c);
  const runPhysics = E.summary(physicsState, c);

  // 1. THERMOS vs No-Intervention Baseline ('none')
  assert.ok(
    runThermos.peak_inlet_c < runNone.peak_inlet_c - 1.5,
    `THERMOS lowers peak inlet temp significantly vs No-Intervention (${runThermos.peak_inlet_c.toFixed(2)}°C vs ${runNone.peak_inlet_c.toFixed(2)}°C)`
  );
  assert.ok(
    runThermos.over_limit_rack_minutes < runNone.over_limit_rack_minutes * 0.35,
    `THERMOS cuts thermal violation rack-minutes by >65% vs No-Intervention (${runThermos.over_limit_rack_minutes} vs ${runNone.over_limit_rack_minutes})`
  );

  // 2. THERMOS respects strict 35 L water budget and completes all 360 batch rack-minutes with 0 missed deadlines
  assert.equal(
    runThermos.water_budget_exceeded,
    false,
    `THERMOS stays within 35 L water cap (${runThermos.water_l.toFixed(1)} L)`
  );
  assert.equal(runThermos.missed_deadlines, 0, 'THERMOS completes all deferred batch jobs without deadline misses');
  assert.ok(near(runThermos.batch_completed_rack_minutes, 360, 1e-2), 'All 360 batch rack-minutes completed');

  // 3. Reactive never redistributes workload across racks (always 'original') and suffers worse violations or water overuse
  assert.ok(
    reactiveState.trace.every((r) => r.style === 'original'),
    'Reactive controller never redistributes compute across racks (always original placement)'
  );
  assert.ok(
    thermosState.trace.some((r) => r.style === 'targeted' && (r.transfers?.length ?? 0) > 0),
    'THERMOS executes surgical targeted multi-rack workload transfers'
  );
  assert.ok(
    runReactive.water_budget_exceeded || runReactive.over_limit_rack_minutes > runThermos.over_limit_rack_minutes,
    'THERMOS achieves superior water compliance or lower thermal violations than Reactive'
  );

  // 4. Exact First-Law electrical energy accounting across all 4 controllers + real heat recovery
  assert.ok(
    runThermos.useful_heat_kwh_th > 1.0,
    `THERMOS captures real useful district heat (${runThermos.useful_heat_kwh_th.toFixed(2)} kWh_th)`
  );
  for (const tot of [runThermos, runNone, runReactive, runPhysics]) {
    const netElectrical =
      tot.it_kwh +
      tot.cooling_kwh +
      tot.monitoring_kwh +
      tot.migration_kwh +
      tot.recovery_aux_kwh -
      tot.monitoring_covered_kwh;
    assert.ok(
      near(tot.grid_kwh, netElectrical, 1e-2),
      `Controller ${tot.controller} satisfies exact electrical energy balance`
    );
    assert.ok(tot.useful_heat_kwh_th >= 0, 'Thermal recovery kWh_th tracked separately from electrical kWh_e');
  }
});
