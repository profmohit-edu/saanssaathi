/**
 * Finds "clean-air windows" in an hourly PM2.5 forecast.
 * Winter smog over North India follows a daily cycle: it builds after
 * sunset when the boundary layer collapses and thins out in the afternoon.
 * Timing activities can cut exposure without any cost.
 * @module windows
 */
import { MS_PER_HOUR } from './config.js';

/**
 * @typedef {{time: Date, pm25: number}} HourPoint
 */

/**
 * Keeps the next `hours` points starting at `now`.
 * @param {HourPoint[]} series
 * @param {Date} now
 * @param {number} [hours=24]
 * @returns {HourPoint[]}
 */
export function nextHours(series, now, hours = 24) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  return series.filter((p) => p.time >= start && Number.isFinite(p.pm25)).slice(0, hours);
}

/**
 * Mean of pm25 over points.
 * @param {HourPoint[]} pts
 */
export function mean(pts) {
  if (!pts.length) {
    return NaN;
  }
  return pts.reduce((s, p) => s + p.pm25, 0) / pts.length;
}

/**
 * True when every hour is inside [fromHour, toHour) and the hours are consecutive.
 * @param {HourPoint[]} slice
 * @param {number} fromHour
 * @param {number} toHour
 */
function isUsableSlice(slice, fromHour, toHour) {
  const inHours = slice.every((p) => p.time.getHours() >= fromHour && p.time.getHours() < toHour);
  const contiguous = slice.every((p, j) => j === 0 || p.time.getTime() - slice[j - 1].time.getTime() === MS_PER_HOUR);
  return inHours && contiguous;
}

/**
 * Best contiguous window of `length` hours between `fromHour` and `toHour` (local hours).
 * @param {HourPoint[]} pts
 * @param {number} length
 * @param {{fromHour?:number, toHour?:number}} [opts]
 * @returns {{start: Date, end: Date, mean: number} | null}
 */
export function bestWindow(pts, length, { fromHour = 6, toHour = 22 } = {}) {
  /** @type {{start: Date, end: Date, mean: number} | null} */
  let best = null;
  for (let i = 0; i + length <= pts.length; i++) {
    const slice = pts.slice(i, i + length);
    if (!isUsableSlice(slice, fromHour, toHour)) {
      continue;
    }
    const m = mean(slice);
    if (!best || m < best.mean) {
      best = { start: slice[0].time, end: new Date(slice[length - 1].time.getTime() + MS_PER_HOUR), mean: m };
    }
  }
  return best;
}

/**
 * Worst contiguous window (the peak to avoid).
 * @param {HourPoint[]} pts
 * @param {number} length
 */
export function worstWindow(pts, length) {
  /** @type {{start: Date, end: Date, mean: number} | null} */
  let worst = null;
  for (let i = 0; i + length <= pts.length; i++) {
    const slice = pts.slice(i, i + length);
    const m = mean(slice);
    if (!worst || m > worst.mean) {
      worst = { start: slice[0].time, end: new Date(slice[length - 1].time.getTime() + MS_PER_HOUR), mean: m };
    }
  }
  return worst;
}

/**
 * Mean PM2.5 during typical rush hours (8–10 and 18–20).
 * @param {HourPoint[]} pts
 */
export function rushHourMean(pts) {
  const rush = pts.filter((p) => {
    const h = p.time.getHours();
    return (h >= 8 && h < 10) || (h >= 18 && h < 20);
  });
  return rush.length ? mean(rush) : mean(pts);
}

/**
 * Hours where opening windows makes sense: outdoor air cleaner than the
 * estimated indoor level and below a cap.
 * @param {HourPoint[]} pts
 * @param {number} indoorEstimate µg/m³
 * @param {number} [cap=60]
 */
export function ventilationHours(pts, indoorEstimate, cap = 60) {
  return pts.filter((p) => p.pm25 < Math.min(indoorEstimate, cap));
}

/**
 * Formats an hour range like "2 pm – 4 pm".
 * @param {Date} start
 * @param {Date} end
 * @param {string} [locale='en-IN']
 */
export function formatRange(start, end, locale = 'en-IN') {
  const fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}
