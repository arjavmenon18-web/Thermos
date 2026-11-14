import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as E from './engine';
import modelData from '../data/model.json';
import type { ForestModel } from './types';

const M = modelData as unknown as ForestModel;
const near = (a: number, b: number, tol = 1e-5) =>
  assert.ok(Math.abs(a - b) < tol, `${a} vs ${b} (diff: ${Math.abs(a - b)})`);

test('Browser forest matches scikit-learn reference predictions', () => {
  const refPath = path.join(process.cwd(), 'src/data/inference_reference.json');
  const refs = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  for (const r of refs) {
    near(E.forestPredict(M, r.x), r.prediction, 1e-5);
  }
});

test('Movable workload is conserved and rack capacity is respected', () => {
  const rand = E.rng(8);
  for (let n = 0; n < 50; n++) {
    const raw = Array.from({ length: 12 }, () => 0.15 + rand() * 0.8);
    const extra = Math.min(2, 12 - E.sum(raw));
    for (const style of ['original', 'spread', 'consolidate'] as const) {
      const q = E.balanceLoads(raw, extra, style);
      near(E.sum(q.loads), E.sum(raw) + extra);
      q.loads.forEach((v, i) => {
        assert.ok(v <= 1 + 1e-7, `Rack ${i} load ${v} exceeds 1`);
        assert.ok(v >= raw[i] * 0.45 - 1e-7, `Rack ${i} load below pinned`);
      });
      near(q.unserved, 0);
    }
  }
});

test('Hidden truth does not leak into the observation estimator', () => {
  const c = E.config({ sensors: 4 });
  const a = E.initial(c);
  const b = E.initial(c);
  const hidden = Array.from({ length: 12 }, (_, i) => i).filter(
    (i) => !E.sensorMask(c, 0).includes(i)
  );
  hidden.forEach((i) => (b.temps[i] += 20));
  assert.deepEqual(E.observe(a, c), E.observe(b, c));
});

test('Sensor failure removes the reading and raises uncertainty', () => {
  const c = E.config({ ...E.presets.sensor });
  const s = E.initial(c);
  s.t = 23;
  assert.ok(E.observe(s, c).ids.includes(6));
  s.t = 24;
  const obs = E.observe(s, c);
  assert.ok(!obs.ids.includes(6));
  assert.ok(obs.uncertainty[6] > 1);
});

test('A cold-side temperature above the heat source cannot generate electricity', () => {
  const c = E.config({ outside: 47 });
  const control = { supply: 22, fan: 0.7, mode: 'dry' as const };
  const loads = Array(12).fill(0.6);
  const p = E.coolingPower(loads, control, 47);
  const r = E.recovery(p, loads, control, 47, c);
  assert.ok(r.hot < r.cold);
  near(r.harvest, 0);
});

test('No heat consumer means no delivered heat or recovery pump consumption', () => {
  const c = E.config({ heatDemand: 0 });
  const control = { supply: 22, fan: 0.7, mode: 'dry' as const };
  const loads = Array(12).fill(0.8);
  const p = E.coolingPower(loads, control, 30);
  const r = E.recovery(p, loads, control, 30, c);
  near(r.useful, 0);
  near(r.pump, 0);
});

test('Every default scenario completes work and updates ledgers consistently', () => {
  for (const [key, preset] of Object.entries(E.presets)) {
    const c = E.config(preset);
    for (const ctrl of ['reactive', 'physics', 'thermos'] as const) {
      const s = E.run(c, ctrl, M);
      const q = E.summary(s, c);
      assert.equal(s.t, 72);
      assert.equal(s.trace.length, 72);
      near(q.batch_completed_rack_minutes, 360, 1e-4);
      near(q.batch_remaining_rack_minutes, 0, 1e-4);
      assert.equal(q.missed_deadlines, 0, `Scenario ${key} / ${ctrl} missed deadlines`);

      // Ledger check: Grid energy = IT + cooling + monitoring + migration + recovery aux - used harvest
      near(
        q.grid_kwh,
        q.it_kwh +
          q.cooling_kwh +
          q.monitoring_kwh +
          q.migration_kwh +
          q.recovery_aux_kwh -
          q.monitoring_covered_kwh,
        1e-5
      );
      near(q.recovered_electricity_kwh, q.monitoring_covered_kwh + q.storage_final_kwh, 1e-5);
      assert.ok(q.monitoring_covered_kwh <= q.monitoring_kwh + 1e-7);
    }
  }
});

test('Stressed custom inputs disclose violations instead of hiding them', () => {
  const c = E.config({
    outside: 47,
    demand: 90,
    restriction: 0.4,
    sensors: 4,
    water: 0,
    limit: 28,
  });
  const s = E.run(c, 'thermos', M);
  assert.ok(s.violationRackMinutes > 0);
  assert.ok(s.trace.some((r) => r.reasons.some((x) => x.includes('Escalate'))));
  near(s.water, 0);
});
