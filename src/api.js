/**
 * Open-Meteo clients (free, no key, CORS-enabled) with in-memory caching,
 * request timeouts and input validation.
 * @module api
 */

import { AIR_CACHE_TTL_MS, AIR_TIMEOUT_MS } from './config.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const cache = new Map();

/**
 * fetch with timeout and a small TTL cache.
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 */
async function getJson(url, fetchImpl = fetch) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < AIR_CACHE_TTL_MS) {
    return hit.data;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AIR_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer' });
    if (!res.ok) {
      throw new Error(`Air-quality service error (HTTP ${res.status})`);
    }
    const data = await res.json();
    cache.set(url, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (/** @type {Error} */ (e).name === 'AbortError') {
      throw new Error('The air-quality service timed out. Check your connection and retry.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates latitude/longitude.
 * @param {number} lat
 * @param {number} lon
 */
export function validCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/**
 * Searches places by name.
 * @param {string} query
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Array<{name:string, admin1?:string, country?:string, latitude:number, longitude:number}>>}
 */
export async function searchPlaces(query, fetchImpl) {
  const q = String(query ?? '')
    .trim()
    .slice(0, 80);
  if (q.length < 2) {
    return [];
  }
  const url = `${GEO_URL}?${new URLSearchParams({ name: q, count: '5', language: 'en', format: 'json' })}`;
  const data = await getJson(url, fetchImpl);
  return (data.results ?? []).filter((r) => validCoords(r.latitude, r.longitude));
}

/**
 * Hourly PM2.5 forecast for the next 2 days, plus current readings.
 * @param {number} lat
 * @param {number} lon
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchAirQuality(lat, lon, fetchImpl) {
  if (!validCoords(lat, lon)) {
    throw new Error('Invalid coordinates');
  }
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: 'pm2_5',
    current: 'pm2_5,pm10,nitrogen_dioxide,us_aqi',
    forecast_days: '2',
    past_days: '0',
    timeformat: 'unixtime',
    timezone: 'auto',
  });
  return getJson(`${AQ_URL}?${params}`, fetchImpl);
}

/** Clears the cache (used in tests). */
export function clearCache() {
  cache.clear();
}
