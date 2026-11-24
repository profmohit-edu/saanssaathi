/**
 * Application-wide constants. Kept in one place so that tuning a timeout or
 * limit never means hunting through modules.
 * @module config
 */

/** Air-quality API response cache lifetime (ms). */
/** One hour in milliseconds. */
export const MS_PER_HOUR = 3_600_000;

export const AIR_CACHE_TTL_MS = 10 * 60 * 1000;
/** Air-quality / geocoding request timeout (ms). */
export const AIR_TIMEOUT_MS = 12_000;
/** Gemini request timeout (ms). */
export const GEMINI_TIMEOUT_MS = 30_000;

/** Default Gemini model; users can override it in Settings. */
export const DEFAULT_MODEL = 'gemini-3.6-flash';
/** Allowed model-name shape (prevents path injection into the API URL). */
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{2,60}$/i;

/** Household limits. */
export const MAX_MEMBERS = 10;
export const MAX_NAME_LENGTH = 30;
export const MAX_COMMUTE_HOURS = 6;
export const MAX_OUTDOOR_HOURS = 12;

/** Chat limits. */
export const MAX_QUESTION_LENGTH = 1000;
export const CHAT_HISTORY_TURNS = 8;

/** UI timings (ms). */
export const SEARCH_DEBOUNCE_MS = 350;
export const RECOMPUTE_DEBOUNCE_MS = 120;
export const PERSIST_DEBOUNCE_MS = 300;

/** Geolocation options. */
export const GEO_OPTIONS = Object.freeze({ maximumAge: 600_000, timeout: 10_000 });

/** Length of the "clean-air window" highlighted in the chart and plan (hours). */
export const CLEAN_WINDOW_HOURS = 2;
/** Length of the "peak" window to avoid (hours). */
export const PEAK_WINDOW_HOURS = 3;

/** Minimum effect for a swap to be worth showing. */
export const MIN_DOSE_DELTA_UG = 0.5;
export const MIN_CO2_DELTA_KG = 0.05;

/** Days per week, for weekly impact figures. */
export const DAYS_PER_WEEK = 7;

/**
 * Validates a Gemini model name.
 * @param {unknown} name
 * @returns {name is string}
 */
export function isValidModel(name) {
  return typeof name === 'string' && MODEL_PATTERN.test(name);
}
