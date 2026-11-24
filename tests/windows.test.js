import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHours, bestWindow, worstWindow, rushHourMean, ventilationHours, mean, formatRange } from '../src/windows.js';
import { buildEnvironment, parseOpenMeteo } from '../src/environment.js';
import { smogSeries } from './fixtures.js';

const series = smogSeries();
const now = new Date(2026, 10, 24, 0, 30);

test('nextHours returns 24 hourly points from now', () => {
  const pts = nextHours(series, now, 24);
  assert.equal(pts.length, 24);
  assert.equal(pts[0].time.getHours(), 0);
});

test('bestWindow finds the clean afternoon', () => {
  const best = bestWindow(nextHours(series, now), 2);
  assert.equal(best.start.getHours(), 14);
  assert.equal(best.mean, 82.5);
});

test('bestWindow respects waking hours', () => {
  const best = bestWindow(nextHours(series, now), 1, { fromHour: 18, toHour: 22 });
  assert.equal(best.start.getHours(), 18);
});

test('worstWindow finds the peak', () => {
  const worst = worstWindow(nextHours(series, now), 3);
  assert.ok(worst.mean >= 240);
});

test('rush-hour mean uses 8–10 and 18–20', () => {
  assert.equal(rushHourMean(nextHours(series, now)), mean([{ pm25: 220 }, { pm25: 190 }, { pm25: 190 }, { pm25: 220 }]));
});

test('ventilation hours only when outdoors cleaner than indoors', () => {
  const v = ventilationHours(nextHours(series, now), 100, 60);
  assert.equal(v.length, 0);
  const v2 = ventilationHours(nextHours(series, now), 100, 200);
  assert.ok(v2.every((p) => p.pm25 < 100));
  assert.ok(v2.length > 0);
});

test('formatRange renders hours', () => {
  const s = formatRange(new Date(2026, 0, 1, 14), new Date(2026, 0, 1, 16));
  assert.match(s, /2.*pm.*4.*pm/i);
});

test('buildEnvironment exposes slots, best window and peak', () => {
  const env = buildEnvironment(series, now);
  assert.ok(env.slots.midday < env.slots.morning);
  assert.equal(env.bestFor(2).start.getHours(), 14);
  assert.equal(env.outdoorMeanFor({ outdoorTime: 'best', outdoorHours: 2 }), 82.5);
  assert.equal(env.outdoorMeanFor({ outdoorTime: 'unknown' }), env.dailyMean);
});

test('buildEnvironment throws with no data', () => {
  assert.throws(() => buildEnvironment([], now));
});

test('parseOpenMeteo reads unixtime and skips nulls', () => {
  const pts = parseOpenMeteo({ hourly: { time: [1764000000, 1764003600], pm2_5: [120.5, null] } });
  assert.equal(pts.length, 1);
  assert.equal(pts[0].pm25, 120.5);
  assert.throws(() => parseOpenMeteo({}));
});
