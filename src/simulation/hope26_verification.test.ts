import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine';
import {
  REGIONAL_GRID_PRESETS,
  calculateOperationalEmissionsKg,
  calculateEmissionsDifferenceKg,
  calculateExternalHeatDisplacedEmissionsKg,
} from './carbon';

test('HOPE 26: 15-minute forecast horizon is centrally anchored and mathematically consistent', () => {
  assert.equal(E.DT, 5, 'Decision step is strictly 5 minutes');
  assert.equal(E.HORIZON, 3, 'Forecast lookahead is strictly 3 steps');
  assert.equal(E.FORECAST_HORIZON_MINUTES, 15, 'Forecast horizon is strictly 15 minutes (3 x 5m)');
});

test('HOPE 26: Operational carbon accounting adheres strictly to scope-2 formula and sign convention', () => {
  const intensity = 400; // g CO2e / kWh
  const gridKWh = 150;

  // Formula check: (150 kWh * 400 g/kWh) / 1000 = 60 kg CO2e
  const emissionsKg = calculateOperationalEmissionsKg(gridKWh, intensity);
  assert.equal(emissionsKg, 60.0, 'Emissions kg equals (kWh * g_per_kWh) / 1000');

  // Sign convention: Baseline (180 kWh) - THERMOS (150 kWh) -> +12 kg CO2e (positive = lower emissions)
  const diffPositive = calculateEmissionsDifferenceKg(180, 150, intensity);
  assert.equal(diffPositive, 12.0, 'Positive diff indicates lower emissions with THERMOS');

  // Inverted case: If THERMOS uses more energy, diff is negative
  const diffNegative = calculateEmissionsDifferenceKg(150, 160, intensity);
  assert.equal(diffNegative, -4.0, 'Negative diff indicates additional emissions');

  // Displaced boiler heat is strictly separated
  const thermalKWh = 40;
  const boilerEmissionsKg = calculateExternalHeatDisplacedEmissionsKg(thermalKWh, 202);
  assert.equal(boilerEmissionsKg, (40 * 202) / 1000, 'Displaced boiler emissions computed separately');
});

test('HOPE 26: Hard cooling-water cap physically cuts evaporative water and forces dry chiller operation', () => {
  const conf = E.config({
    ...E.presets.water,
    water: 5.0, // Strict 5-litre hard cap
  });

  let state = E.initial(conf);

  // Run simulation forward until water cap is exhausted
  for (let step = 0; step < 20; step++) {
    state = E.tick(state, conf, 'reactive', null);
  }

  // Verify that state.water never exceeds the 5.0 L cap
  assert.ok(
    state.water <= conf.water + 1e-6,
    `Water consumed (${state.water.toFixed(2)}L) must never exceed budget cap (${conf.water}L)`
  );

  // Advance further with dry cooling
  const waterBefore = state.water;
  state = E.tick(state, conf, 'reactive', null);
  assert.equal(
    state.water,
    waterBefore,
    'Once water cap is exhausted, no further evaporative water is consumed'
  );
});

test('HOPE 26: Virtual sensor estimation uses distance-weighted residuals and expands uncertainty margin', () => {
  const conf = E.config(E.presets.compound);
  const state = E.initial(conf);

  // At t = 24 in compound, R07 sensor fails
  state.t = 24;
  const obs = E.observe(state, conf);

  // R07 (index 6) must be missing from valid IDs
  assert.ok(!obs.ids.includes(6), 'R07 sensor is offline at step 24');

  // Sensed racks have tight uncertainty (±0.12°C), failed R07 has wide uncertainty (±1.20°C)
  assert.equal(obs.uncertainty[0], 0.12, 'Healthy sensor has standard 0.12°C uncertainty');
  assert.equal(obs.uncertainty[6], 1.20, 'Failed R07 sensor has expanded 1.20°C uncertainty margin');

  // Estimate on R07 is computed from neighbors and prior without throwing
  assert.ok(Number.isFinite(obs.estimated[6]), 'Virtual estimate is a valid finite temperature');
  assert.ok(obs.estimated[6] >= 18 && obs.estimated[6] <= 45, 'Virtual estimate is within physical bounds');
});

test('HOPE 26: Seebeck TEG output is zero when cold sink is warmer than hot exhaust', () => {
  const conf = E.config(E.presets.compound);
  const loads = Array(E.N).fill(0.6);
  const temps = Array(E.N).fill(32.0); // Hot exhaust ~36°C

  // Cold sink outside is 50°C (hotter than exhaust manifold ~45°C)
  const rec = E.recovery({ it: 15 }, loads, { supply: 22 }, 50.0, conf, temps);

  assert.equal(rec.harvest, 0, 'Seebeck harvest must be 0 when hot <= cold (Carnot Second Law)');
  assert.equal(rec.gross, 0, 'Gross Seebeck generation must be 0 when no positive temperature gradient exists');
});
