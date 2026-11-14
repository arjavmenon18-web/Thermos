import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RACK_COUNT,
  RACK_W,
  RACK_D,
  PLINTH_MIN_X,
  PLINTH_MAX_X,
  PLINTH_MIN_Z,
  PLINTH_MAX_Z,
  CORE_POS,
  getRackPlacement3D,
  getCoreToRackPoints3D,
  getRackToRackPoints3D,
  samplePolyline3D,
  clampCameraTarget,
} from './dcLayout';

test('3x4 rack formation places all 12 cabinets inside plinth with physical spacing and zero overlap', () => {
  const placements = Array.from({ length: RACK_COUNT }, (_, i) => getRackPlacement3D(i));
  assert.equal(placements.length, 12);

  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    assert.ok(a.x - RACK_W / 2 > PLINTH_MIN_X, `Rack ${i} left bound inside plinth`);
    assert.ok(a.x + RACK_W / 2 < PLINTH_MAX_X, `Rack ${i} right bound inside plinth`);
    assert.ok(a.z - RACK_D / 2 > PLINTH_MIN_Z, `Rack ${i} rear bound inside plinth`);
    assert.ok(a.z + RACK_D / 2 < PLINTH_MAX_Z, `Rack ${i} front bound inside plinth`);

    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      const sepX = Math.abs(a.x - b.x) - RACK_W;
      const sepZ = Math.abs(a.z - b.z) - RACK_D;
      assert.ok(sepX > 0.25 || sepZ > 0.5, `Racks ${i} and ${j} have clean physical separation`);
    }
  }
});

test('orthogonal 3D floor pathways connect THERMOS CORE to each rack tap and rack-to-rack transfers', () => {
  for (let i = 0; i < RACK_COUNT; i++) {
    const pts = getCoreToRackPoints3D(i);
    assert.equal(pts.length, 4);
    assert.equal(pts[0].x, CORE_POS.x);
    assert.equal(pts[0].z, CORE_POS.z);

    // Every segment is strictly orthogonal along X or Z on the floor plane
    for (let s = 0; s < pts.length - 1; s++) {
      const dx = Math.abs(pts[s + 1].x - pts[s].x);
      const dz = Math.abs(pts[s + 1].z - pts[s].z);
      assert.ok(dx < 1e-5 || dz < 1e-5, `Segment ${s} of rack ${i} is orthogonal`);
    }
  }

  // Same-row transfer uses 4 waypoints; cross-row transfer uses spine with 6 waypoints
  assert.equal(getRackToRackPoints3D(0, 3).length, 4);
  assert.equal(getRackToRackPoints3D(6, 0).length, 6);
});

test('samplePolyline3D interpolates smoothly and clampCameraTarget prevents out-of-bounds panning', () => {
  const path = getRackToRackPoints3D(6, 0); // R07 -> R01
  const start = samplePolyline3D(path, 0);
  const mid = samplePolyline3D(path, 0.5);
  const end = samplePolyline3D(path, 1);

  assert.equal(start.pos.x, path[0].x);
  assert.equal(end.pos.z, path[path.length - 1].z);
  assert.ok(Number.isFinite(mid.pos.x) && Number.isFinite(mid.pos.z));

  const clamped = clampCameraTarget({ x: 99, y: -10, z: -50 });
  assert.equal(clamped.x, 4.6);
  assert.equal(clamped.y, 0.1);
  assert.equal(clamped.z, -3.0);
});
