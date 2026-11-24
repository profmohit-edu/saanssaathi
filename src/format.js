/**
 * Pure formatting helpers used across the UI.
 * @module format
 */
import { AGE_GROUPS, COMMUTE_MODES, MASKS } from './exposure.js';

/** Health conditions a member can have. */
export const CONDITIONS = Object.freeze({
  asthma: 'Asthma / COPD',
  heart: 'Heart condition',
  pregnant: 'Pregnant',
});

/**
 * Formats a number for Indian English with fixed decimals.
 * @param {number} n
 * @param {number} [digits=0]
 * @returns {string}
 */
export function fmt(n, digits = 0) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/**
 * "City, State, Country" without repeats or blanks.
 * @param {{name?: string, admin1?: string, country?: string}} place
 * @returns {string}
 */
export function placeLabel(place) {
  const parts = [place?.name, place?.admin1, place?.country].filter(Boolean);
  return [...new Set(parts)].join(', ');
}

/**
 * One-line description of a member for the collapsed card.
 * @param {import('./types.js').Member} m
 * @returns {string}
 */
export function memberSummary(m) {
  const parts = [
    AGE_GROUPS[/** @type {keyof typeof AGE_GROUPS} */ (m.age)]?.label,
    COMMUTE_MODES[/** @type {keyof typeof COMMUTE_MODES} */ (m.commuteMode)]?.label,
    `${m.outdoorHours} h outdoors`,
    MASKS[/** @type {keyof typeof MASKS} */ (m.mask)]?.label,
    ...m.conditions.map((c) => CONDITIONS[/** @type {keyof typeof CONDITIONS} */ (c)]),
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Accessible summary of a forecast for screen readers.
 * @param {import('./types.js').HourPoint[]} hours
 * @param {string} [cleanestLabel] formatted cleanest-window range
 * @returns {string}
 */
export function forecastSummary(hours, cleanestLabel) {
  if (!hours.length) {
    return 'No forecast data.';
  }
  const values = hours.map((p) => p.pm25);
  const range = `PM2.5 ranges from ${fmt(Math.min(...values))} to ${fmt(Math.max(...values))} µg/m³ over the next day.`;
  return cleanestLabel ? `${range} Cleanest window ${cleanestLabel}.` : range;
}

/**
 * Plain-text version of a plan for sharing (WhatsApp, SMS, email).
 * @param {import('./types.js').Plan} plan
 * @param {string} place
 * @param {string} [url] link back to the app
 * @returns {string}
 */
export function planToText(plan, place, url = '') {
  const lines = [`SaansSaathi clean-air plan for ${place}`, plan.headline, ''];
  for (const s of plan.schedule) {
    lines.push(`• ${s.time}: ${s.title}. ${s.detail}`);
  }
  for (const m of plan.perMember ?? []) {
    lines.push(`• ${m.name}: ${m.advice}`);
  }
  if (url) {
    lines.push('', `Plan yours: ${url}`);
  }
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}
