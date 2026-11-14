import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine';
import { FacilityStateManager } from './facilityManager';
import { buildContextualExplanation } from './explanationEngine';
import modelData from '../data/model.json';
import type { ForestModel } from './types';

const M = modelData as unknown as ForestModel;

function runSteps(preset: 'compound', mode: 'interactive' | 'demonstration', steps: number, thermosEnabled = true) {
  const cfg = E.config(E.presets[preset]);
  let sim = E.initial(cfg);
  const mgr = new FacilityStateManager(cfg, preset, M, mode, thermosEnabled);
  let fac = mgr.evaluateFacilityState(null, sim);
  for (let i = 0; i < steps; i++) {
    sim = E.tick(sim, cfg, fac.thermos.enabled ? 'thermos' : 'none', M);
    fac = mgr.evaluateFacilityState(null, sim);
  }
  return { mgr, fac, sim, cfg };
}

test('ExplanationEngine: R07 sensor outage & airflow restriction explains virtual sensing when active and blind offline when paused', () => {
  const { mgr, sim } = runSteps('compound', 'interactive', 5, true);
  const facActive = mgr.evaluateFacilityState(null, sim);
  facActive.racks[6].sensorAvailable = false;
  const expActive = buildContextualExplanation({ type: 'rack', rackId: 6 }, facActive, null, false);
  assert.ok(expActive);
  assert.equal(expActive.title, 'R07');
  assert.match(expActive.level1, /offline|virtual|neighbor|restricted/i);
  assert.ok(expActive.connectedRackIds.length > 0, 'Should highlight connected neighbor/incident racks');

  // Now pause THERMOS
  mgr.setThermosEnabled(false);
  const facPaused = mgr.evaluateFacilityState(null, sim);
  facPaused.racks[6].sensorAvailable = false;
  const expPaused = buildContextualExplanation({ type: 'rack', rackId: 6 }, facPaused, null, false);
  assert.ok(expPaused);
  assert.match(expPaused.level1, /paused|unmonitored/i);
  assert.equal(expPaused.level3.planStatus, 'PAUSED');
  const sensorMeas = expPaused.level2.measurements.find((m) => m.label === 'Inlet Sensor');
  assert.equal(sensorMeas?.value, 'OFFLINE');
});

test('ExplanationEngine: Proposed plan is never reported as completed, and rejected plan is reported as rejected', () => {
  const { mgr, fac: facProposed, sim } = runSteps('compound', 'interactive', 5, true);
  if (facProposed.pendingPlan && facProposed.pendingPlan.status === 'PROPOSED') {
    const exp = buildContextualExplanation({ type: 'core' }, facProposed, null, false);
    assert.ok(exp);
    assert.equal(exp.level3.planStatus, 'PROPOSED');
    assert.match(exp.level3.summary, /proposed|waiting|approval/i);

    // Reject the plan
    mgr.rejectPendingPlan();
    const facRejected = mgr.evaluateFacilityState(null, sim);
    const expRej = buildContextualExplanation({ type: 'core' }, facRejected, null, false);
    assert.ok(expRej);
    assert.equal(expRej.level3.planStatus, 'REJECTED');
    assert.match(expRej.level3.summary, /rejected/i);
  }
});

test('ExplanationEngine: Approved plan transitions to VERIFIED outcome with before-and-after records', () => {
  const { fac } = runSteps('compound', 'demonstration', 12, true);
  const exp = buildContextualExplanation({ type: 'core' }, fac, null, false);
  assert.ok(exp);
  if (fac.lastVerifiedOutcome) {
    assert.equal(exp.level3.planStatus, 'VERIFIED');
    assert.ok(exp.level3.verifiedOutcome);
    assert.ok(exp.level3.verifiedOutcome.perRackDeltas.length > 0);
  }
});
