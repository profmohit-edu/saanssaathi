import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naqiFromPm25, usAqiFromPm25, bandForIndex, bandForPm25 } from '../src/aqi.js';

test('NAQI breakpoints map to the right index', () => {
  assert.equal(naqiFromPm25(0), 0);
  assert.equal(naqiFromPm25(30), 50);
  assert.equal(naqiFromPm25(60), 100);
  assert.equal(naqiFromPm25(90), 200);
  assert.equal(naqiFromPm25(250), 400);
  assert.equal(naqiFromPm25(1000), 500);
});

test('US AQI uses 2024 EPA breakpoints', () => {
  assert.equal(usAqiFromPm25(9), 50);
  assert.equal(usAqiFromPm25(35.4), 100);
  assert.equal(usAqiFromPm25(55.4), 150);
});

test('invalid input is handled', () => {
  assert.ok(Number.isNaN(naqiFromPm25(-1)));
  assert.ok(Number.isNaN(naqiFromPm25(NaN)));
  assert.equal(bandForIndex(NaN).key, 'good');
});

test('bands follow NAQI categories', () => {
  assert.equal(bandForPm25(20).key, 'good');
  assert.equal(bandForPm25(45).key, 'satisfactory');
  assert.equal(bandForPm25(75).key, 'moderate');
  assert.equal(bandForPm25(110).key, 'poor');
  assert.equal(bandForPm25(200).key, 'very_poor');
  assert.equal(bandForPm25(300).key, 'severe');
});
