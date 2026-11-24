/**
 * Air-quality index helpers.
 * Converts PM2.5 concentrations (µg/m³) to India's NAQI PM2.5 sub-index and
 * the US EPA AQI (2024 breakpoints), and maps them to human-readable bands.
 * @module aqi
 */

/** India NAQI PM2.5 (24-h) breakpoints: [concLow, concHigh, idxLow, idxHigh]. */
const NAQI_PM25 = [
  [0, 30, 0, 50],
  [30, 60, 51, 100],
  [60, 90, 101, 200],
  [90, 120, 201, 300],
  [120, 250, 301, 400],
  [250, 380, 401, 500],
];

/** US EPA PM2.5 breakpoints (2024 revision). */
const US_PM25 = [
  [0, 9.0, 0, 50],
  [9.0, 35.4, 51, 100],
  [35.4, 55.4, 101, 150],
  [55.4, 125.4, 151, 200],
  [125.4, 225.4, 201, 300],
  [225.4, 325.4, 301, 500],
];

/** NAQI bands with colours chosen for ≥3:1 contrast against white text or dark text. */
export const BANDS = Object.freeze([
  {
    key: 'good',
    label: 'Good',
    max: 50,
    color: '#2e9d4e',
    text: '#ffffff',
    advice: 'Air is clean. A great time to be outdoors and air out your home.',
  },
  {
    key: 'satisfactory',
    label: 'Satisfactory',
    max: 100,
    color: '#8cc63f',
    text: '#10240a',
    advice: 'Acceptable air. Very sensitive people should watch for symptoms.',
  },
  {
    key: 'moderate',
    label: 'Moderate',
    max: 200,
    color: '#f2c200',
    text: '#241c00',
    advice: 'Breathing discomfort for people with asthma, heart or lung disease. Cut long outdoor exertion.',
  },
  {
    key: 'poor',
    label: 'Poor',
    max: 300,
    color: '#f08a24',
    text: '#2a1400',
    advice: 'Breathing discomfort for most people on prolonged exposure. Keep windows shut at peak hours.',
  },
  {
    key: 'very_poor',
    label: 'Very Poor',
    max: 400,
    color: '#d7263d',
    text: '#ffffff',
    advice: 'Respiratory illness on prolonged exposure. Move exercise indoors; wear an N95 outside.',
  },
  {
    key: 'severe',
    label: 'Severe',
    max: Infinity,
    color: '#7b1e3b',
    text: '#ffffff',
    advice: 'Affects healthy people and seriously impacts those with disease. Stay indoors with filtered air.',
  },
]);

/**
 * Linear interpolation over a breakpoint table.
 * @param {number} c concentration in µg/m³
 * @param {number[][]} table breakpoint table
 * @returns {number} index value, rounded
 */
function interpolate(c, table) {
  if (!Number.isFinite(c) || c < 0) {
    return NaN;
  }
  for (const [cLo, cHi, iLo, iHi] of table) {
    if (c <= cHi) {
      return Math.round(((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo);
    }
  }
  return table[table.length - 1][3];
}

/**
 * India NAQI sub-index for PM2.5.
 * @param {number} pm25 µg/m³
 * @returns {number}
 */
export function naqiFromPm25(pm25) {
  return interpolate(pm25, NAQI_PM25);
}

/**
 * US EPA AQI for PM2.5.
 * @param {number} pm25 µg/m³
 * @returns {number}
 */
export function usAqiFromPm25(pm25) {
  return interpolate(pm25, US_PM25);
}

/**
 * Band for an NAQI value.
 * @param {number} index NAQI value
 * @returns {typeof BANDS[number]}
 */
export function bandForIndex(index) {
  if (!Number.isFinite(index)) {
    return BANDS[0];
  }
  return BANDS.find((b) => index <= b.max) ?? BANDS[BANDS.length - 1];
}

/**
 * Band for a PM2.5 concentration (via NAQI).
 * @param {number} pm25 µg/m³
 */
export function bandForPm25(pm25) {
  return bandForIndex(naqiFromPm25(pm25));
}

/** WHO 2021 24-hour PM2.5 guideline, µg/m³. */
export const WHO_24H_PM25 = 15;
