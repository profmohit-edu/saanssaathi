/**
 * Household state: defaults, demo data, validation and persistence.
 * Only the household profile lives in localStorage. The API key goes to
 * sessionStorage unless the user opts in to remember it.
 * @module store
 */
import { AGE_GROUPS, COMMUTE_MODES, MASKS, OUTDOOR_ACTIVITY, INDOOR_SOURCES } from './exposure.js';
import { OUTDOOR_SLOTS } from './environment.js';
import { CONDITIONS } from './format.js';
import { MAX_MEMBERS, MAX_NAME_LENGTH, MAX_COMMUTE_HOURS, MAX_OUTDOOR_HOURS } from './config.js';

const KEY = 'saans.household.v1';
const KEY_API = 'saans.gemini.key';
const KEY_PREFS = 'saans.prefs.v1';
const KEY_FORECAST = 'saans.forecast.v1';
/** How long a saved forecast may be shown offline (ms). */
const FORECAST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let seq = 0;
/** Unique-enough id. */
export const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A blank member. */
export function newMember(name = 'Me') {
  return {
    id: uid(),
    name,
    age: 'adult',
    conditions: [],
    commuteMode: 'none',
    commuteHours: 0,
    outdoorHours: 1,
    outdoorTime: 'morning',
    outdoorActivity: 'light',
    mask: 'none',
  };
}

/** Demo household: a Delhi joint family. */
/**
 * @returns {import('./types.js').Household & {place: import('./types.js').Place}}
 */
export function demoState() {
  return {
    place: { name: 'New Delhi', admin1: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.209 },
    home: { windows: 'open', purifier: false, sources: ['incense', 'coil'] },
    members: [
      {
        ...newMember('Rahul'),
        commuteMode: 'two_wheeler',
        commuteHours: 1.5,
        outdoorHours: 1,
        outdoorTime: 'morning',
        outdoorActivity: 'vigorous',
        mask: 'cloth',
      },
      { ...newMember('Priya'), commuteMode: 'none', outdoorHours: 0.5, outdoorTime: 'evening' },
      {
        ...newMember('Aarav'),
        age: 'child',
        commuteMode: 'bus',
        commuteHours: 1,
        outdoorHours: 2,
        outdoorTime: 'evening',
        outdoorActivity: 'moderate',
      },
      {
        ...newMember('Dadi'),
        age: 'senior',
        conditions: ['asthma'],
        outdoorHours: 1,
        outdoorTime: 'morning',
        outdoorActivity: 'light',
      },
    ],
  };
}

/**
 * Returns `value` if it is a key of `allowed`, else `fallback`.
 * @param {unknown} value
 * @param {object} allowed
 * @param {string} fallback
 * @returns {string}
 */
const pick = (value, allowed, fallback) =>
  typeof value === 'string' && Object.hasOwn(allowed, value) ? value : fallback;

/**
 * Clamps a numeric value, falling back when it is not a number.
 * @param {unknown} value
 * @param {number} lo
 * @param {number} hi
 * @param {number} fallback
 */
const clamp = (value, lo, hi, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Keeps only array items that are keys of `allowed`, without duplicates.
 * @param {unknown} list
 * @param {object} allowed
 * @returns {string[]}
 */
const keysOf = (list, allowed) =>
  Array.isArray(list) ? [...new Set(list.filter((k) => typeof k === 'string' && Object.hasOwn(allowed, k)))] : [];

const MAX_PLACE_TEXT = 80;
const ID_PATTERN = /^[\w-]{1,40}$/;
const CONTROL_CHARS = /[\u0000-\u001f]/g;

/**
 * @param {any} raw
 * @param {import('./types.js').Place} fallback
 * @returns {import('./types.js').Place}
 */
function sanitizePlace(raw, fallback) {
  if (!raw || !Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude)) {
    return fallback;
  }
  const text = (/** @type {unknown} */ v) => String(v ?? '').slice(0, MAX_PLACE_TEXT);
  return {
    name: text(raw.name),
    admin1: text(raw.admin1),
    country: text(raw.country),
    latitude: clamp(raw.latitude, -90, 90, fallback.latitude),
    longitude: clamp(raw.longitude, -180, 180, fallback.longitude),
  };
}

/**
 * @param {any} raw
 * @returns {import('./types.js').Home}
 */
function sanitizeHome(raw) {
  return {
    windows: raw?.windows === 'closed' ? 'closed' : 'open',
    purifier: Boolean(raw?.purifier),
    sources: keysOf(raw?.sources, INDOOR_SOURCES),
  };
}

/**
 * @param {any} m
 * @returns {import('./types.js').Member}
 */
function sanitizeMember(m) {
  const src = m && typeof m === 'object' ? m : {};
  const name = String(src.name ?? '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return {
    id: typeof src.id === 'string' && ID_PATTERN.test(src.id) ? src.id : uid(),
    name: name || 'Member',
    age: pick(src.age, AGE_GROUPS, 'adult'),
    conditions: keysOf(src.conditions, CONDITIONS),
    commuteMode: pick(src.commuteMode, COMMUTE_MODES, 'none'),
    commuteHours: clamp(src.commuteHours, 0, MAX_COMMUTE_HOURS, 0),
    outdoorHours: clamp(src.outdoorHours, 0, MAX_OUTDOOR_HOURS, 0),
    outdoorTime: pick(src.outdoorTime, OUTDOOR_SLOTS, 'morning'),
    outdoorActivity: pick(src.outdoorActivity, OUTDOOR_ACTIVITY, 'light'),
    mask: pick(src.mask, MASKS, 'none'),
  };
}

/**
 * Validates untrusted state (from storage or URL): whitelists every enum,
 * clamps numbers, strips control characters and caps list sizes.
 * @param {any} raw
 * @returns {import('./types.js').Household & {place: import('./types.js').Place}}
 */
export function sanitizeState(raw) {
  const base = demoState();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const members = Array.isArray(raw.members) ? raw.members.slice(0, MAX_MEMBERS) : base.members;
  return {
    place: sanitizePlace(raw.place, base.place),
    home: sanitizeHome(raw.home),
    members: members.map(sanitizeMember),
  };
}

/**
 * Returns a working Web Storage area, or null when storage is blocked (private mode, quota).
 * @param {'localStorage' | 'sessionStorage'} kind
 * @returns {Storage | null}
 */
function safeStorage(kind) {
  try {
    const s = globalThis[kind];
    const probe = '__saans__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * Loads the household (or the demo).
 * @returns {import('./types.js').Household & {place: import('./types.js').Place}}
 */
export function loadState() {
  const s = safeStorage('localStorage');
  try {
    return sanitizeState(JSON.parse(s?.getItem(KEY) ?? 'null'));
  } catch {
    return demoState();
  }
}

/** Persists the household. */
export function saveState(state) {
  safeStorage('localStorage')?.setItem(KEY, JSON.stringify(state));
}

/** Preferences (language, model). */
export function loadPrefs() {
  try {
    const p = JSON.parse(safeStorage('localStorage')?.getItem(KEY_PREFS) ?? '{}');
    return { lang: typeof p.lang === 'string' ? p.lang : 'en', model: typeof p.model === 'string' ? p.model : '' };
  } catch {
    return { lang: 'en', model: '' };
  }
}

/** @param {{lang:string, model:string}} p */
export function savePrefs(p) {
  safeStorage('localStorage')?.setItem(KEY_PREFS, JSON.stringify(p));
}

/** API key: session by default, local only if remembered. */
export function loadApiKey() {
  return safeStorage('sessionStorage')?.getItem(KEY_API) || safeStorage('localStorage')?.getItem(KEY_API) || '';
}

/**
 * @param {string} key
 * @param {boolean} remember
 */
export function saveApiKey(key, remember) {
  const clean = String(key ?? '').trim();
  const ss = safeStorage('sessionStorage');
  const ls = safeStorage('localStorage');
  ss?.removeItem(KEY_API);
  ls?.removeItem(KEY_API);
  if (!clean) {
    return;
  }
  (remember ? ls : ss)?.setItem(KEY_API, clean);
}

/**
 * Remembers the last forecast so the app still works if the air-quality
 * service is unreachable.
 * @param {{latitude: number, longitude: number}} place
 * @param {object} json raw Open-Meteo response
 * @param {number} [now]
 */
export function saveForecast(place, json, now = Date.now()) {
  try {
    safeStorage('localStorage')?.setItem(
      KEY_FORECAST,
      JSON.stringify({ lat: place.latitude, lon: place.longitude, at: now, json }),
    );
  } catch {
    // Storage full or blocked: offline fallback is best-effort.
  }
}

/**
 * Returns a saved forecast for the same place if it is less than a day old.
 * @param {{latitude: number, longitude: number}} place
 * @param {number} [now]
 * @returns {{json: any, at: number} | null}
 */
export function loadForecast(place, now = Date.now()) {
  try {
    const saved = JSON.parse(safeStorage('localStorage')?.getItem(KEY_FORECAST) ?? 'null');
    return isUsableForecast(saved, place, now) ? { json: saved.json, at: saved.at } : null;
  } catch {
    return null;
  }
}

/** Places closer than this (degrees) share a saved forecast. */
const SAME_PLACE_DEGREES = 0.01;

/**
 * True when a saved forecast is for the same place and fresh enough to show.
 * @param {any} saved
 * @param {{latitude: number, longitude: number}} place
 * @param {number} now
 */
function isUsableForecast(saved, place, now) {
  if (!saved) {
    return false;
  }
  const samePlace =
    Math.abs(saved.lat - place.latitude) < SAME_PLACE_DEGREES &&
    Math.abs(saved.lon - place.longitude) < SAME_PLACE_DEGREES;
  return samePlace && now - saved.at < FORECAST_MAX_AGE_MS;
}
