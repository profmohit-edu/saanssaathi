/**
 * Builds the exposure environment from an hourly PM2.5 forecast.
 * @module environment
 */
import { nextHours, mean, bestWindow, worstWindow, rushHourMean } from './windows.js';

/** When members usually spend time outdoors. */
export const OUTDOOR_SLOTS = Object.freeze({
  morning: { label: 'Early morning (6–9 am)', from: 6, to: 9 },
  midday: { label: 'Midday (12–4 pm)', from: 12, to: 16 },
  evening: { label: 'Evening (5–9 pm)', from: 17, to: 21 },
  best: { label: 'Cleanest window (SaansSaathi picks)', from: null, to: null },
});

/**
 * Mean PM2.5 over a local hour slot, falling back to the overall mean.
 * @param {import('./windows.js').HourPoint[]} pts
 * @param {number} from
 * @param {number} to
 */
function slotMean(pts, from, to) {
  const inSlot = pts.filter((p) => {
    const h = p.time.getHours();
    return h >= from && h < to;
  });
  return inSlot.length ? mean(inSlot) : mean(pts);
}

/**
 * @param {import('./windows.js').HourPoint[]} series hourly forecast
 * @param {Date} now
 */
export function buildEnvironment(series, now = new Date()) {
  const day = nextHours(series, now, 24);
  if (!day.length) throw new Error('No forecast hours available');
  const dailyMean = mean(day);
  const slots = Object.fromEntries(
    Object.entries(OUTDOOR_SLOTS)
      .filter(([, s]) => s.from !== null)
      .map(([k, s]) => [k, slotMean(day, s.from, s.to)]),
  );
  const bestCache = new Map();
  const bestFor = (hours) => {
    const len = Math.min(6, Math.max(1, Math.ceil(hours)));
    if (!bestCache.has(len)) bestCache.set(len, bestWindow(day, len));
    return bestCache.get(len);
  };
  return {
    hours: day,
    current: day[0].pm25,
    dailyMean,
    commuteMean: rushHourMean(day),
    slots,
    peak: worstWindow(day, 3),
    bestFor,
    /** @param {{outdoorTime?:string, outdoorHours?:number}} m */
    outdoorMeanFor(m) {
      if (m.outdoorTime === 'best') return bestFor(m.outdoorHours || 1)?.mean ?? dailyMean;
      return slots[m.outdoorTime] ?? dailyMean;
    },
  };
}

/**
 * Parses an Open-Meteo air-quality response into hour points.
 * @param {{hourly?: {time: string[], pm2_5: (number|null)[]}, utc_offset_seconds?: number}} json
 * @returns {import('./windows.js').HourPoint[]}
 */
export function parseOpenMeteo(json) {
  const t = json?.hourly?.time;
  const v = json?.hourly?.pm2_5;
  if (!Array.isArray(t) || !Array.isArray(v)) throw new Error('Unexpected air-quality response');
  // timeformat=unixtime gives seconds since epoch, independent of the browser's zone.
  return t
    .map((ts, i) => ({ time: new Date(Number(ts) * 1000), pm25: v[i] }))
    .filter((p) => Number.isFinite(p.pm25) && !Number.isNaN(p.time.getTime()));
}
