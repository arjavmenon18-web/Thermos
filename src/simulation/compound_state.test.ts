import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine';
import { FacilityStateManager } from './facilityManager';
import modelData from '../data/model.json';
import type { ForestModel } from './types';

const M = modelData as unknown as ForestModel;

test('Compound Stress Test preset is registered with multi-hotspot and multi-vector stressors', () => {
  assert.ok(E.presets.compound, 'Compound preset must exist in engine presets');
  const c = E.config(E.presets.compound);
  assert.equal(c.heatwave, true, 'Heatwave enabled');
  assert.equal(c.failure, true, 'Sensor failure enabled');
  assert.equal(c.multiHotspot, true, 'Multi-rack hotspot profile enabled');
  assert.equal(c.restriction, 0.30, 'Airflow restriction on R07 is 0.30');
  assert.equal(c.water, 35, 'Water budget is strictly constrained to 35 L');
  assert.equal(c.heatDemand, 10, 'District heat demand is 10 kW');
});

test('Targeted multi-rack load balancing conserves workload, respects pinned floor, and generates real transfer edges', () => {
  const c = E.config(E.presets.compound);
  let s = E.initial(c);
  for (let i = 0; i < 10; i++) {
    s = E.tick(s, c, 'reactive', M);
  }
  const obs = E.observe(s, c);
  const raw = E.rawDemand(c, s.t);
  const extra = E.batchNeeded(s, raw, 1);
  const vuln = E.rackVulnerability(obs, c);

  const res = E.balanceLoads(raw, extra, 'targeted', vuln);
  assert.ok(Math.abs(E.sum(res.loads) - (E.sum(raw) + extra)) < 1e-5, 'Total workload conserved');
  assert.ok(res.unserved < 1e-6, 'Zero unserved work');
  res.loads.forEach((l, idx) => {
    assert.ok(l <= 1 + 1e-7, `Rack ${idx} within 100% capacity`);
    assert.ok(l >= raw[idx] * 0.45 - 1e-7, `Rack ${idx} preserves 45% mandatory pinned load`);
  });
  assert.ok((res.transfers?.length ?? 0) >= 2, 'Generates multiple directed transfer edges');
  // Restricted R07 (index 6) should be relieved relative to cool unrestricted R01 (index 0)
  assert.ok(res.loads[6] < res.loads[0], 'Restricted R07 holds lower total load than cool receiver R01');
});

test('FacilityStateManager initializes single source of truth and IDLE state across all 12 racks', () => {
  const c = E.config(E.presets.compound);
  const manager = new FacilityStateManager(c, 'compound', M, 'interactive');
  const state = E.initial(c);
  const facility = manager.evaluateFacilityState(null, state);

  assert.equal(facility.racks.length, 12, 'Tracks R01 through R12 individually');
  assert.equal(facility.thermos.visualState, 'IDLE', 'Initial state is IDLE before steps');
  assert.equal(facility.waterBudgetL, 35);
  assert.equal(facility.waterRemainingL, 35);
  assert.equal(facility.racks[6].airflowRestriction, 0.30);
  assert.ok(Math.abs(facility.racks[7].airflowRestriction - 0.165) < 0.02);
});

test('Compound Stress Test activates multiple simultaneous rack & facility incidents and evaluates 108 candidates', () => {
  const c = E.config(E.presets.compound);
  const manager = new FacilityStateManager(c, 'compound', M, 'interactive');
  let state = E.initial(c);

  for (let step = 0; step < 25; step++) {
    const override = manager.getControlOverrideForNextTick(state);
    state = E.tick(state, c, 'thermos', M, override);
  }

  const currentRecord = state.trace[state.trace.length - 1];
  const facility = manager.evaluateFacilityState(currentRecord, state);

  assert.ok(
    facility.activeIncidents.length >= 3,
    `Expected at least 3 concurrent incidents, got ${facility.activeIncidents.length}`
  );
  assert.ok(facility.thermos.affectedRackCount >= 2, 'Multiple racks affected concurrently');

  const types = facility.activeIncidents.map((i) => i.type);
  assert.ok(types.includes('RESTRICTED_AIRFLOW'), 'Airflow bottleneck active');
  assert.ok(types.includes('SENSOR_FAILURE'), 'Sensor outage on R07 active at t>=24');
  assert.ok(types.includes('WATER_BUDGET_PRESSURE'), 'Water budget pressure active');

  // R07 sensor offline with expanded synthetic uncertainty
  const r07 = facility.racks[6];
  assert.equal(r07.sensorAvailable, false);
  assert.equal(r07.sensorStatus, 'OFFLINE_SYNTHETIC');
  assert.ok(r07.uncertaintyMarginC > 1.0);

  // Pending coordinated plan formulated with 108 evaluated candidates and multiple rack assignments
  assert.ok(facility.pendingPlan !== null, 'Coordinated multi-rack plan formulated');
  const plan = facility.pendingPlan!;
  assert.equal(plan.evaluatedCandidatesCount, 108, 'Evaluates all 108 engine candidates');
  assert.ok(plan.targetRacks.length >= 3, `Targets >=3 racks simultaneously, got ${plan.targetRacks.length}`);
  assert.ok(plan.rackAssignments.length >= 3, 'Assigns explicit roles to multiple racks');
  assert.ok(!plan.receiverRacks.includes(7), 'Excludes partially restricted R08 from cool receiver pool');
  assert.equal(facility.thermos.visualState, 'COORDINATING');
});

test('Rejected plans in Interactive mode are never recorded as applied and hold baseline placement', () => {
  const c = E.config(E.presets.compound);
  const manager = new FacilityStateManager(c, 'compound', M, 'interactive');
  let state = E.initial(c);

  for (let step = 0; step < 6; step++) {
    state = E.tick(state, c, 'reactive', M);
  }
  const rec = state.trace[state.trace.length - 1];
  const f1 = manager.evaluateFacilityState(rec, state);
  assert.ok(f1.pendingPlan !== null, 'Plan proposed under rising compound stress');
  const rejectedId = f1.pendingPlan!.id;

  manager.rejectPendingPlan();
  const f2 = manager.evaluateFacilityState(rec, state);
  assert.equal(f2.pendingPlan, null);
  assert.equal(f2.activePlan, null);
  assert.ok(f2.rejectedPlanIds.includes(rejectedId), 'Recorded in rejectedPlanIds');
  assert.equal(f2.appliedPlans.length, 0, 'Rejected plan must NEVER be in appliedPlans');
  f2.activeIncidents.forEach((inc) => {
    assert.ok(!inc.appliedActions.includes(rejectedId), 'Rejected plan never recorded on incident appliedActions');
  });

  const override = manager.getControlOverrideForNextTick(state);
  assert.equal(override?.style, 'original', 'Declining plan holds unmitigated original placement');
});

test('Approved multi-rack plan transitions INTERVENING -> MONITORING -> Verified Outcome from real engine steps', () => {
  const c = E.config(E.presets.compound);
  const manager = new FacilityStateManager(c, 'compound', M, 'interactive');
  let state = E.initial(c);

  for (let step = 0; step < 8; step++) {
    state = E.tick(state, c, 'reactive', M);
  }
  let rec = state.trace[state.trace.length - 1];
  let facility = manager.evaluateFacilityState(rec, state);
  assert.ok(facility.pendingPlan !== null);

  // Operator approves plan -> immediate INTERVENING visual state
  const approved = manager.authorisePendingPlan(false);
  assert.ok(approved !== null);
  facility = manager.evaluateFacilityState(rec, state);
  assert.equal(facility.thermos.visualState, 'INTERVENING');

  // Next engine tick commits approved multi-rack engineAction -> enters MONITORING
  const override1 = manager.getControlOverrideForNextTick(state);
  assert.deepEqual(override1, approved!.engineAction);
  state = E.tick(state, c, 'thermos', M, override1);
  rec = state.trace[state.trace.length - 1];
  facility = manager.evaluateFacilityState(rec, state);
  assert.equal(facility.thermos.visualState, 'MONITORING');

  // Second engine tick completes verification using actual simulated temperatures
  const override2 = manager.getControlOverrideForNextTick(state);
  state = E.tick(state, c, 'thermos', M, override2);
  rec = state.trace[state.trace.length - 1];
  facility = manager.evaluateFacilityState(rec, state);

  assert.ok(facility.lastVerifiedOutcome !== null, 'Produces verified intervention outcome');
  assert.equal(facility.lastVerifiedOutcome?.planId, approved!.id);
  assert.equal(
    facility.lastVerifiedOutcome?.peakAfterC,
    Number(Math.max(...rec.temps).toFixed(2)),
    'Verified outcome peakAfterC matches exact simulated engine temperature'
  );
});

test('Demonstration mode auto-authorizes multi-rack plans andCompound scenario remains deterministic', () => {
  const c = E.config(E.presets.compound);
  const manager = new FacilityStateManager(c, 'compound', M, 'demonstration');
  let state = E.initial(c);

  let sawAuto = false;
  for (let step = 0; step < 15; step++) {
    const override = manager.getControlOverrideForNextTick(state);
    state = E.tick(state, c, 'thermos', M, override);
    const f = manager.evaluateFacilityState(state.trace[state.trace.length - 1], state);
    if (f.activePlan?.authorisationMode === 'demonstration') {
      sawAuto = true;
    }
  }
  assert.ok(sawAuto, 'Demonstration mode auto-authorises multi-rack plans');

  const run1 = E.run(c, 'thermos', M);
  const run2 = E.run(c, 'thermos', M);
  assert.deepEqual(run1.temps, run2.temps, 'Deterministic across full 72-step runs');
  assert.equal(run1.water, run2.water);
  assert.equal(run1.energy, run2.energy);
});

test('Pausing THERMOS stops all AI actions while the live data centre continues running on static BMS rules', () => {
  const c = E.config(E.presets.compound);
  const manager = new FacilityStateManager(c, 'compound', M, 'demonstration', true);
  let state = E.initial(c);

  // Advance 5 steps with THERMOS active
  for (let step = 0; step < 5; step++) {
    const override = manager.getControlOverrideForNextTick(state);
    state = E.tick(state, c, 'thermos', M, override);
  }
  const activeFacility = manager.evaluateFacilityState(state.trace[state.trace.length - 1], state);
  assert.equal(activeFacility.thermos.enabled, true);

  // Pause THERMOS practically: facility continues ticking, zero AI action from THERMOS
  manager.setThermosEnabled(false, state.t * E.DT, state.t);
  assert.equal(manager.isThermosEnabled(), false);

  const pausedOverride = manager.getControlOverrideForNextTick(state);
  assert.ok(pausedOverride !== undefined, 'Paused THERMOS enforces unmitigated static BMS baseline override');
  assert.equal(pausedOverride!.style, 'original', 'Zero AI workload shifting while paused');
  assert.equal(pausedOverride!.supply, 22, 'Fixed 22°C BMS supply');
  assert.equal(pausedOverride!.fan, 0.58, 'Uniform 58% static fan speed');
  assert.equal(pausedOverride!.mode, 'dry', 'Fixed dry BMS mode');
  assert.deepEqual(pausedOverride!.recoveryValves, new Array(12).fill(0), 'Zero active heat recovery valves');

  const tempBeforePausedTick = state.temps[6];
  state = E.tick(state, c, 'thermos', M, pausedOverride);
  const recPaused = state.trace[state.trace.length - 1];
  const pausedFacility = manager.evaluateFacilityState(recPaused, state);

  assert.equal(pausedFacility.thermos.enabled, false);
  assert.equal(pausedFacility.pendingPlan, null, 'No pending plans proposed while paused');
  assert.equal(pausedFacility.activePlan, null, 'No active AI plan while paused');
  assert.equal(pausedFacility.thermos.activeTransfers.length, 0, 'Zero workload transfers while paused');
  assert.equal(pausedFacility.heatRecovery.extractedHeatKW, 0, 'Zero active heat extraction while paused');
  assert.notEqual(
    recPaused.temps[6],
    tempBeforePausedTick,
    'Physical server rack temperatures continue evolving live while THERMOS is paused'
  );
  pausedFacility.racks.forEach((r) => {
    assert.equal(r.thermosBranchState, 'IDLE', `Rack ${r.label} branch conduit is dormant while paused`);
  });

  // Re-engage THERMOS -> immediately resumes sensing and autonomous thermal mitigation
  manager.setThermosEnabled(true, state.t * E.DT, state.t);
  const resumedOverride = manager.getControlOverrideForNextTick(state);
  state = E.tick(state, c, 'thermos', M, resumedOverride);
  const resumedFacility = manager.evaluateFacilityState(state.trace[state.trace.length - 1], state);
  assert.equal(resumedFacility.thermos.enabled, true);
  assert.notEqual(resumedOverride?.style, 'original', 'THERMOS resumes targeted workload routing once re-engaged');
});

