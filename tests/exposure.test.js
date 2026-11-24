import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDose, householdDose, normaliseMember, infiltrationRatio, UG_PER_CIGARETTE } from '../src/exposure.js';

const adult = { age: 'adult', commuteMode: 'none', commuteHours: 0, outdoorHours: 0, outdoorActivity: 'light', mask: 'none' };
const home = { windows: 'open', purifier: false, sources: [] };

test('an adult at home breathes about 12–15 m³/day', () => {
  const d = computeDose(adult, home, { dailyMean: 100 });
  assert.ok(d.volume > 10 && d.volume < 16, `volume ${d.volume}`);
});

test('dose scales linearly with concentration', () => {
  const a = computeDose(adult, home, { dailyMean: 50 }).total;
  const b = computeDose(adult, home, { dailyMean: 100 }).total;
  assert.ok(Math.abs(b - 2 * a) < 1e-6);
});

test('cigarette equivalence: an adult at 22 µg/m³ outdoors all day ≈ 1', () => {
  // Fully outdoor-equivalent: windows open with infiltration 0.9, so a bit under 1.
  const d = computeDose(adult, home, { dailyMean: 22 });
  assert.ok(d.cigarettes > 0.6 && d.cigarettes < 1.1, String(d.cigarettes));
  assert.equal(UG_PER_CIGARETTE, 330);
});

test('N95 cuts outdoor dose', () => {
  const out = { ...adult, outdoorHours: 3, outdoorActivity: 'moderate' };
  const none = computeDose(out, home, { dailyMean: 200 }).parts.outdoors;
  const n95 = computeDose({ ...out, mask: 'n95' }, home, { dailyMean: 200 }).parts.outdoors;
  assert.ok(n95 < none * 0.3);
});

test('purifier with closed windows lowers indoor dose', () => {
  assert.ok(infiltrationRatio({ windows: 'closed', purifier: true }) < infiltrationRatio(home));
  const open = computeDose(adult, home, { dailyMean: 150 }).total;
  const sealed = computeDose(adult, { windows: 'closed', purifier: true, sources: [] }, { dailyMean: 150 }).total;
  assert.ok(sealed < open * 0.5);
});

test('indoor sources add exposure', () => {
  const clean = computeDose(adult, home, { dailyMean: 50 }).total;
  const smoky = computeDose(adult, { ...home, sources: ['biomass'] }, { dailyMean: 50 }).total;
  assert.ok(smoky > clean * 2);
});

test('children breathe less volume than adults', () => {
  const kid = computeDose({ ...adult, age: 'child' }, home, { dailyMean: 100 });
  const grown = computeDose(adult, home, { dailyMean: 100 });
  assert.ok(kid.volume < grown.volume);
});

test('hours are clamped so a day never exceeds 24h', () => {
  const m = normaliseMember({ ...adult, commuteMode: 'bus', commuteHours: 30, outdoorHours: 30 });
  assert.ok(m.commuteHours + m.outdoorHours <= 16);
  assert.equal(normaliseMember({ ...adult, commuteMode: 'none', commuteHours: 3 }).commuteHours, 0);
});

test('outdoorMeanFor overrides outdoor concentration', () => {
  const m = { ...adult, outdoorHours: 2, outdoorActivity: 'moderate' };
  const dirty = computeDose(m, home, { dailyMean: 200, outdoorMeanFor: () => 250 }).parts.outdoors;
  const clean = computeDose(m, home, { dailyMean: 200, outdoorMeanFor: () => 80 }).parts.outdoors;
  assert.ok(clean < dirty / 3);
});

test('householdDose sums members', () => {
  const h = householdDose([{ id: '1', name: 'A', ...adult }, { id: '2', name: 'B', ...adult }], home, { dailyMean: 100 });
  assert.equal(h.perMember.length, 2);
  assert.ok(Math.abs(h.total - 2 * h.perMember[0].total) < 1e-6);
});
