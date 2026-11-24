/**
 * Household state: defaults, demo data, validation and persistence.
 * Only the household profile lives in localStorage. The API key goes to
 * sessionStorage unless the user opts in to remember it.
 * @module store
 */
import { AGE_GROUPS, COMMUTE_MODES, MASKS, OUTDOOR_ACTIVITY, INDOOR_SOURCES } from './exposure.js';
import { OUTDOOR_SLOTS } from './environment.js';

const KEY = 'saans.household.v1';
const KEY_API = 'saans.gemini.key';
const KEY_PREFS = 'saans.prefs.v1';
export const CONDITIONS = Object.freeze({ asthma: 'Asthma / COPD', heart: 'Heart condition', pregnant: 'Pregnant' });
const MAX_MEMBERS = 10;

let seq = 0;
/** Unique-enough id. */
export const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A blank member. */
export function newMember(name = 'Me') {
  return { id: uid(), name, age: 'adult', conditions: [], commuteMode: 'none', commuteHours: 0,
    outdoorHours: 1, outdoorTime: 'morning', outdoorActivity: 'light', mask: 'none' };
}

/** Demo household: a Delhi joint family. */
export function demoState() {
  return {
    place: { name: 'New Delhi', admin1: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.209 },
    home: { windows: 'open', purifier: false, sources: ['incense', 'coil'] },
    members: [
      { ...newMember('Rahul'), commuteMode: 'two_wheeler', commuteHours: 1.5, outdoorHours: 1,
        outdoorTime: 'morning', outdoorActivity: 'vigorous', mask: 'cloth' },
      { ...newMember('Priya'), commuteMode: 'none', outdoorHours: 0.5, outdoorTime: 'evening' },
      { ...newMember('Aarav'), age: 'child', commuteMode: 'bus', commuteHours: 1, outdoorHours: 2,
        outdoorTime: 'evening', outdoorActivity: 'moderate' },
      { ...newMember('Dadi'), age: 'senior', conditions: ['asthma'], outdoorHours: 1,
        outdoorTime: 'morning', outdoorActivity: 'light' },
    ],
  };
}

const pick = (v, allowed, fallback) => (Object.hasOwn(allowed, v) ? v : fallback);
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/**
 * Validates untrusted state (from storage or URL).
 * @param {any} raw
 */
export function sanitizeState(raw) {
  const base = demoState();
  if (!raw || typeof raw !== 'object') return base;
  const home = raw.home ?? {};
  const members = Array.isArray(raw.members) ? raw.members.slice(0, MAX_MEMBERS) : base.members;
  const place = raw.place && Number.isFinite(raw.place.latitude) && Number.isFinite(raw.place.longitude)
    ? { name: String(raw.place.name ?? '').slice(0, 80), admin1: String(raw.place.admin1 ?? '').slice(0, 80),
      country: String(raw.place.country ?? '').slice(0, 80),
      latitude: num(raw.place.latitude, -90, 90, 28.6), longitude: num(raw.place.longitude, -180, 180, 77.2) }
    : base.place;
  return {
    place,
    home: {
      windows: home.windows === 'closed' ? 'closed' : 'open',
      purifier: Boolean(home.purifier),
      sources: Array.isArray(home.sources) ? [...new Set(home.sources.filter((s) => Object.hasOwn(INDOOR_SOURCES, s)))] : [],
    },
    members: members.map((m) => ({
      id: typeof m?.id === 'string' && /^[\w-]{1,40}$/.test(m.id) ? m.id : uid(),
      name: String(m?.name ?? 'Member').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30) || 'Member',
      age: pick(m?.age, AGE_GROUPS, 'adult'),
      conditions: Array.isArray(m?.conditions) ? m.conditions.filter((c) => Object.hasOwn(CONDITIONS, c)) : [],
      commuteMode: pick(m?.commuteMode, COMMUTE_MODES, 'none'),
      commuteHours: num(m?.commuteHours, 0, 6, 0),
      outdoorHours: num(m?.outdoorHours, 0, 12, 0),
      outdoorTime: pick(m?.outdoorTime, OUTDOOR_SLOTS, 'morning'),
      outdoorActivity: pick(m?.outdoorActivity, OUTDOOR_ACTIVITY, 'light'),
      mask: pick(m?.mask, MASKS, 'none'),
    })),
  };
}

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

/** Loads the household (or the demo). */
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
  if (!clean) return;
  (remember ? ls : ss)?.setItem(KEY_API, clean);
}
