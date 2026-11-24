/**
 * Personal exposure model ("Breath Budget").
 *
 * Inhaled dose (µg) = Σ concentration(µg/m³) × breathing rate(m³/h) × hours
 * across micro-environments: sleep, indoors, commute and outdoors.
 *
 * Coefficients are rounded, literature-informed estimates (US EPA Exposure
 * Factors Handbook breathing rates; published in-vehicle and infiltration
 * ratios; real-world respirator fit). They are meant to rank choices, not to
 * diagnose anyone.
 * @module exposure
 */

/** Adult breathing rate by activity, m³/hour. */
export const BREATHING = Object.freeze({
  sleep: 0.4,
  rest: 0.5,
  light: 0.8,
  moderate: 1.6,
  vigorous: 3.0,
});

/** Breathing-rate scale vs an adult. */
export const AGE_GROUPS = Object.freeze({
  infant: { label: 'Infant (0–1)', factor: 0.3, sensitive: true },
  child: { label: 'Child (2–12)', factor: 0.6, sensitive: true },
  teen: { label: 'Teen (13–17)', factor: 0.95, sensitive: false },
  adult: { label: 'Adult (18–64)', factor: 1.0, sensitive: false },
  senior: { label: 'Senior (65+)', factor: 0.85, sensitive: true },
});

/**
 * Commute modes: in-vehicle / ambient PM2.5 ratio, activity while commuting,
 * and tail-pipe CO₂ in kg per passenger-km.
 */
export const COMMUTE_MODES = Object.freeze({
  none: { label: 'No commute / WFH', ratio: 0, activity: 'rest', co2PerKm: 0 },
  car_recirc: { label: 'Car (AC on recirculate)', ratio: 0.5, activity: 'rest', co2PerKm: 0.17 },
  car_open: { label: 'Car (windows open / fresh air)', ratio: 1.0, activity: 'rest', co2PerKm: 0.17 },
  two_wheeler: { label: 'Two-wheeler', ratio: 1.4, activity: 'light', co2PerKm: 0.05 },
  auto: { label: 'Auto-rickshaw', ratio: 1.4, activity: 'rest', co2PerKm: 0.06 },
  bus: { label: 'Bus', ratio: 1.2, activity: 'rest', co2PerKm: 0.03 },
  metro: { label: 'Metro', ratio: 0.6, activity: 'rest', co2PerKm: 0.02 },
  walk: { label: 'Walk', ratio: 1.1, activity: 'moderate', co2PerKm: 0 },
  cycle: { label: 'Cycle', ratio: 1.1, activity: 'vigorous', co2PerKm: 0 },
});

/** Fraction of PM2.5 that gets through, real-world fit. */
export const MASKS = Object.freeze({
  none: { label: 'No mask', penetration: 1.0 },
  cloth: { label: 'Cloth mask', penetration: 0.85 },
  surgical: { label: 'Surgical mask', penetration: 0.7 },
  n95: { label: 'N95 / FFP2 (well fitted)', penetration: 0.25 },
});

/** Outdoor activity intensity options. */
export const OUTDOOR_ACTIVITY = Object.freeze({
  light: 'Light (stroll, errands)',
  moderate: 'Moderate (brisk walk, play)',
  vigorous: 'Vigorous (run, sport)',
});

/** Indoor-to-outdoor infiltration ratio. */
export function infiltrationRatio(home) {
  const closed = home.windows === 'closed';
  if (home.purifier) return closed ? 0.3 : 0.75;
  return closed ? 0.6 : 0.9;
}

/** Indoor sources that add PM2.5 on top of infiltration (daily mean µg/m³). */
export const INDOOR_SOURCES = Object.freeze({
  biomass: { label: 'Wood / dung / coal cooking or heating', add: 60 },
  kerosene: { label: 'Kerosene heater or lamp', add: 20 },
  smoking: { label: 'Smoking indoors', add: 25 },
  incense: { label: 'Incense / agarbatti / dhoop', add: 12 },
  coil: { label: 'Mosquito coil', add: 15 },
  gas_no_exhaust: { label: 'Gas stove without exhaust fan', add: 6 },
});

/** Berkeley Earth rule of thumb: 22 µg/m³ for a day ≈ 1 cigarette for an adult (~15 m³/day). */
export const UG_PER_CIGARETTE = 22 * 15;

const SLEEP_HOURS = 8;
const clampHours = (h) => Math.min(24, Math.max(0, Number(h) || 0));

/**
 * Normalises a member's routine so hours never exceed 24.
 * @param {object} m member
 */
export function normaliseMember(m) {
  const commuteHours = m.commuteMode === 'none' ? 0 : Math.min(24 - SLEEP_HOURS, clampHours(m.commuteHours));
  const outdoorHours = Math.min(clampHours(m.outdoorHours), 24 - SLEEP_HOURS - commuteHours);
  return { ...m, commuteHours, outdoorHours: Math.max(0, outdoorHours) };
}

/**
 * Computes a member's daily inhaled PM2.5 dose.
 * @param {object} member {age, commuteMode, commuteHours, outdoorHours, outdoorActivity, mask}
 * @param {object} home {windows, purifier, sources: string[]}
 * @param {{dailyMean:number, outdoorMean?:number, commuteMean?:number,
 *   outdoorMeanFor?:(m:object)=>number}} env µg/m³; outdoorMeanFor resolves when a member is outside
 * @returns {{total:number, volume:number, parts:Record<string,number>, cigarettes:number, whoMultiple:number, avgConc:number}}
 */
export function computeDose(member, home, env) {
  const m = normaliseMember(member);
  const age = AGE_GROUPS[m.age] ?? AGE_GROUPS.adult;
  const mode = COMMUTE_MODES[m.commuteMode] ?? COMMUTE_MODES.none;
  const mask = MASKS[m.mask] ?? MASKS.none;
  const f = age.factor;

  const daily = Math.max(0, env.dailyMean);
  const outdoorRaw = typeof env.outdoorMeanFor === 'function' ? env.outdoorMeanFor(m) : env.outdoorMean;
  const outdoorC = Math.max(0, Number.isFinite(outdoorRaw) ? outdoorRaw : daily);
  const commuteC = Math.max(0, env.commuteMean ?? daily);
  const sourceAdd = (home.sources ?? []).reduce((s, k) => s + (INDOOR_SOURCES[k]?.add ?? 0), 0);
  // A purifier also scrubs part of what is generated indoors.
  const indoorC = daily * infiltrationRatio(home) + sourceAdd * (home.purifier ? 0.5 : 1);

  const indoorAwakeHours = Math.max(0, 24 - SLEEP_HOURS - m.commuteHours - m.outdoorHours);
  const maskedCommute = mode.ratio > 0.8 ? mask.penetration : 1; // masks rarely worn in closed cabins
  const outdoorRate = BREATHING[m.outdoorActivity] ?? BREATHING.light;

  const parts = {
    sleep: indoorC * BREATHING.sleep * f * SLEEP_HOURS,
    indoors: indoorC * BREATHING.rest * f * indoorAwakeHours,
    commute: commuteC * mode.ratio * maskedCommute * BREATHING[mode.activity] * f * m.commuteHours,
    outdoors: outdoorC * mask.penetration * outdoorRate * f * m.outdoorHours,
  };
  const volume = f * (BREATHING.sleep * SLEEP_HOURS + BREATHING.rest * indoorAwakeHours
    + BREATHING[mode.activity] * m.commuteHours + outdoorRate * m.outdoorHours);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const whoDose = 15 * volume;
  return {
    total,
    volume,
    parts,
    avgConc: volume > 0 ? total / volume : 0,
    cigarettes: total / UG_PER_CIGARETTE,
    whoMultiple: whoDose > 0 ? total / whoDose : 0,
  };
}

/**
 * Household totals.
 * @param {object[]} members
 * @param {object} home
 * @param {object} env
 */
export function householdDose(members, home, env) {
  const perMember = members.map((m) => ({ id: m.id, name: m.name, ...computeDose(m, home, env) }));
  const total = perMember.reduce((s, d) => s + d.total, 0);
  return { perMember, total, cigarettes: total / UG_PER_CIGARETTE };
}
