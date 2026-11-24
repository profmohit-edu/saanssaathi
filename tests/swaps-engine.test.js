import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSwaps, combine, weeklyCommuteCo2 } from '../src/swaps.js';
import { buildOfflinePlan, healthAlerts } from '../src/engine.js';
import { buildEnvironment } from '../src/environment.js';
import { smogSeries, demoMembers, openHome } from './fixtures.js';

const env = buildEnvironment(smogSeries(), new Date(2026, 10, 24, 0, 30));
const state = () => ({ members: demoMembers(), home: openHome() });

test('swaps are ranked by dose avoided, largest first', () => {
  const ranked = rankSwaps(state(), env);
  assert.ok(ranked.length >= 5);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].deltaUg >= ranked[i].deltaUg);
  assert.ok(ranked.every((r) => r.pct >= 0 && r.pct <= 100));
});

test('only relevant swaps are suggested', () => {
  const s = state();
  s.home = { windows: 'closed', purifier: true, sources: [] };
  s.members.forEach((m) => { m.mask = 'n95'; m.outdoorTime = 'best'; m.outdoorActivity = 'light'; m.commuteMode = 'none'; });
  const ids = rankSwaps(s, env).map((r) => r.id);
  for (const id of ['seal', 'purifier', 'n95', 'timing', 'metro', 'source_incense']) assert.ok(!ids.includes(id), id);
});

test('ranking does not mutate input state', () => {
  const s = state();
  const before = JSON.stringify(s);
  rankSwaps(s, env);
  assert.equal(JSON.stringify(s), before);
});

test('switching to metro saves CO₂', () => {
  const metro = rankSwaps(state(), env).find((r) => r.id === 'metro');
  assert.ok(metro.co2KgPerWeek > 0);
  assert.ok(weeklyCommuteCo2(demoMembers()) > 0);
});

test('combining swaps compounds the reduction', () => {
  const ranked = rankSwaps(state(), env);
  const one = combine(state(), env, [ranked[0].id]);
  const three = combine(state(), env, ranked.slice(0, 3).map((r) => r.id));
  assert.ok(three.pct > one.pct);
  assert.ok(three.after.total < three.before.total);
});

test('offline plan has schedule, alerts and hacks', () => {
  const s = state();
  const plan = buildOfflinePlan(s, env, rankSwaps(s, env));
  assert.equal(plan.source, 'offline');
  assert.ok(plan.schedule.length >= 4);
  assert.ok(plan.hacks.length >= 4);
  assert.ok(plan.alerts.some((a) => a.who === 'Dadi'));
  assert.match(plan.headline, /µg\/m³/);
});

test('health alerts escalate for heart conditions on bad days', () => {
  const alerts = healthAlerts([{ name: 'X', age: 'adult', conditions: ['heart'] }], 200);
  assert.equal(alerts[0].level, 'high');
  assert.equal(healthAlerts([{ name: 'X', age: 'adult', conditions: ['heart'] }], 10).length, 0);
});
