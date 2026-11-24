import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMetro, communityActions } from '../src/local.js';
import { rankSwaps } from '../src/swaps.js';
import { buildOfflinePlan } from '../src/engine.js';
import { buildEnvironment } from '../src/environment.js';
import { smogSeries, demoMembers, openHome } from './fixtures.js';

const env = buildEnvironment(smogSeries(), new Date(2026, 10, 24, 0, 30));

test('metro detection is case and accent tolerant', () => {
  assert.ok(hasMetro({ name: 'New Delhi' }));
  assert.ok(hasMetro({ name: 'LUCKNOW' }));
  assert.ok(!hasMetro({ name: 'Varanasi' }));
  assert.ok(!hasMetro(null));
});

test('Delhi gets the Green Delhi channel; other Indian cities get CPCB', () => {
  const delhi = communityActions({ name: 'New Delhi', admin1: 'Delhi', country: 'India' })
    .map((a) => a.title)
    .join('|');
  assert.match(delhi, /Green Delhi/);
  assert.match(delhi, /Sameer/);
  const varanasi = communityActions({ name: 'Varanasi', country: 'India' })
    .map((a) => a.title)
    .join('|');
  assert.doesNotMatch(varanasi, /Green Delhi/);
  assert.match(varanasi, /carpool/i);
  assert.doesNotMatch(varanasi, /metro/i);
});

test('outside India, no Indian complaint channels', () => {
  const titles = communityActions({ name: 'Lahore', country: 'Pakistan' })
    .map((a) => a.title)
    .join('|');
  assert.doesNotMatch(titles, /Sameer|Green Delhi/);
});

test('commute swap targets metro or bus depending on the city', () => {
  const base = { members: demoMembers(), home: openHome() };
  const withMetro = rankSwaps({ ...base, place: { name: 'Delhi' } }, env).find((s) => s.id === 'metro');
  const noMetro = rankSwaps({ ...base, place: { name: 'Varanasi' } }, env).find((s) => s.id === 'metro');
  assert.match(withMetro.title, /metro/);
  assert.match(noMetro.title, /bus or carpool/);
  assert.ok(withMetro.deltaUg > noMetro.deltaUg, 'metro cabins are cleaner than buses');
});

test('offline plan includes community actions for the place', () => {
  const state = { members: demoMembers(), home: openHome(), place: { name: 'Delhi', country: 'India' } };
  const plan = buildOfflinePlan(state, env, rankSwaps(state, env));
  assert.ok(plan.community.length >= 3);
});
