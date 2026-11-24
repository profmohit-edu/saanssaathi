/**
 * "What-if" swap simulator. Each swap transforms the household, and the
 * exposure model re-scores it, so every suggestion carries a measured impact
 * instead of a generic tip.
 * @module swaps
 */
import { householdDose, COMMUTE_MODES, INDOOR_SOURCES, UG_PER_CIGARETTE } from './exposure.js';
import { hasMetro } from './local.js';
import { DAYS_PER_WEEK, MIN_CO2_DELTA_KG, MIN_DOSE_DELTA_UG } from './config.js';

const clone = (x) => structuredClone(x);
/** Typical one-way urban commute speed used to convert hours to km. */
const KM_PER_COMMUTE_HOUR = 18;
/** Commuting days per week. */
const WORKING_DAYS = 5;

/**
 * Swap definitions. `applies` decides relevance; `apply` mutates a clone.
 * @type {Array<{id:string, title:string|((s:State)=>string), category:'personal'|'home'|'community', cost:string,
 *   why:string, applies:(s:State)=>boolean, apply:(s:State)=>void}>}
 * @typedef {import('./types.js').Household} State
 */
export const SWAPS = [
  {
    id: 'n95',
    title: 'Wear a well-fitted N95 outdoors and on open commutes',
    category: 'personal',
    cost: '≈ ₹40–80 per mask',
    why: 'A sealed N95 filters most fine particles; cloth and loose surgical masks leak around the edges.',
    applies: (s) => s.members.some((m) => m.mask !== 'n95' && (m.outdoorHours > 0 || openCommute(m))),
    apply: (s) =>
      s.members.forEach((m) => {
        if (m.outdoorHours > 0 || openCommute(m)) {
          m.mask = 'n95';
        }
      }),
  },
  {
    id: 'timing',
    title: 'Move outdoor time into the cleanest hours of the day',
    category: 'personal',
    cost: 'Free',
    why: 'Winter smog peaks after sunset and early morning, when cold air traps pollution near the ground. Afternoons are usually cleaner.',
    applies: (s) => s.members.some((m) => m.outdoorHours > 0 && m.outdoorTime !== 'best'),
    apply: (s) =>
      s.members.forEach((m) => {
        if (m.outdoorHours > 0) {
          m.outdoorTime = 'best';
        }
      }),
  },
  {
    id: 'intensity',
    title: 'Swap vigorous outdoor exercise for an indoor workout on bad-air days',
    category: 'personal',
    cost: 'Free',
    why: 'A runner breathes 3–6× more air per minute than someone resting, so the same air gives a much bigger dose.',
    applies: (s) => s.members.some((m) => m.outdoorActivity === 'vigorous' && m.outdoorHours > 0),
    apply: (s) =>
      s.members.forEach((m) => {
        if (m.outdoorActivity === 'vigorous') {
          m.outdoorActivity = 'light';
        }
      }),
  },
  {
    id: 'metro',
    title: (s) =>
      metroFor(s)
        ? 'Switch two-wheeler/auto/car trips to the metro'
        : 'Switch two-wheeler/auto/car trips to an AC bus or carpool',
    category: 'community',
    cost: 'Often cheaper than fuel',
    why: 'Open vehicles sit in the exhaust of the traffic around them. Filtered metro and AC-bus cabins cut what you breathe, and every switch takes exhaust off your street.',
    applies: (s) => s.members.some((m) => SWITCHABLE.includes(m.commuteMode)),
    apply: (s) => {
      const target = metroFor(s) ? 'metro' : 'bus';
      s.members.forEach((m) => {
        if (SWITCHABLE.includes(m.commuteMode)) {
          m.commuteMode = target;
        }
      });
    },
  },
  {
    id: 'recirc',
    title: 'In the car, keep windows up with AC on recirculate',
    category: 'personal',
    cost: 'Free',
    why: 'Recirculation roughly halves in-cabin PM2.5 compared with fresh-air or open-window driving.',
    applies: (s) => s.members.some((m) => m.commuteMode === 'car_open'),
    apply: (s) =>
      s.members.forEach((m) => {
        if (m.commuteMode === 'car_open') {
          m.commuteMode = 'car_recirc';
        }
      }),
  },
  {
    id: 'seal',
    title: 'Keep windows shut during peaks; air the home only in clean windows',
    category: 'home',
    cost: 'Free (₹200 for draught tape)',
    why: 'Closed, taped windows cut how much outdoor smog gets in by roughly a third.',
    applies: (s) => s.home.windows !== 'closed',
    apply: (s) => {
      s.home.windows = 'closed';
    },
  },
  {
    id: 'purifier',
    title: 'Build a DIY “Corsi–Rosenthal” box-fan filter (or run a purifier) in the bedroom',
    category: 'home',
    cost: '≈ ₹3,000 DIY · ₹8,000+ purifier',
    why: 'A box fan taped to MERV-13 filters moves a lot of clean air for little money. Most of a day’s breathing happens in the bedroom.',
    applies: (s) => !s.home.purifier,
    apply: (s) => {
      s.home.purifier = true;
    },
  },
  ...Object.entries(INDOOR_SOURCES).map(([key, src]) => ({
    id: `source_${key}`,
    title: sourceTitle(key, src.label),
    category: /** @type {'community' | 'home'} */ (key === 'biomass' || key === 'kerosene' ? 'community' : 'home'),
    cost: sourceCost(key),
    why: sourceWhy(key),
    applies: (s) => (s.home.sources ?? []).includes(key),
    apply: (s) => {
      s.home.sources = s.home.sources.filter((k) => k !== key);
    },
  })),
];

const SWITCHABLE = ['two_wheeler', 'auto', 'car_open', 'car_recirc'];
/** Metro by default when the city is unknown (tests, demo). */
const metroFor = (s) => !s.place || hasMetro(s.place);

function openCommute(m) {
  return ['two_wheeler', 'auto', 'walk', 'cycle', 'bus', 'car_open'].includes(m.commuteMode) && m.commuteHours > 0;
}

function sourceTitle(key, label) {
  const map = {
    biomass: 'Switch wood/dung/coal cooking or heating to LPG or induction',
    kerosene: 'Replace kerosene heaters and lamps with electric ones',
    smoking: 'Make the home smoke-free (smoke outside, far from windows)',
    incense: 'Pause incense/dhoop, or light it near an open window outside peak hours',
    coil: 'Swap mosquito coils for nets or plug-in liquid vaporisers',
    gas_no_exhaust: 'Run a kitchen exhaust fan or chimney while cooking',
  };
  return map[key] ?? `Remove: ${label}`;
}

function sourceCost(key) {
  return (
    {
      biomass: 'PMUY LPG subsidy may apply',
      kerosene: '≈ ₹1,500 heater',
      smoking: 'Saves money',
      incense: 'Free',
      coil: '≈ ₹100 vaporiser',
      gas_no_exhaust: '≈ ₹1,500 exhaust fan',
    }[key] ?? 'Low'
  );
}

function sourceWhy(key) {
  return (
    {
      biomass:
        'Solid-fuel smoke is among the largest PM2.5 sources inside Indian homes and adds to neighbourhood winter smog.',
      kerosene: 'Kerosene burning releases fine particles and NO₂ right where you breathe.',
      smoking: 'Second-hand smoke lingers in closed winter rooms and hits children hardest.',
      incense: 'One stick can briefly push indoor PM2.5 far above outdoor levels in a closed room.',
      coil: 'One coil can emit as much fine particulate as dozens of cigarettes.',
      gas_no_exhaust: 'Cooking fumes build up when the windows are closed for smog.',
    }[key] ?? 'Removes an indoor emission source.'
  );
}

/**
 * Weekly commute CO₂ (kg) for the household.
 * @param {import('./types.js').Member[]} members
 */
export function weeklyCommuteCo2(members) {
  return members.reduce((s, m) => {
    const mode = COMMUTE_MODES[m.commuteMode] ?? COMMUTE_MODES.none;
    return s + mode.co2PerKm * KM_PER_COMMUTE_HOUR * (m.commuteHours || 0) * WORKING_DAYS;
  }, 0);
}

/**
 * Scores every applicable swap against the baseline.
 * @param {State} state
 * @param {import('./types.js').Environment} env from buildEnvironment
 * @returns {Array<{id:string,title:string,category:string,cost:string,why:string,
 *   deltaUg:number, pct:number, cigarettesPerWeek:number, co2KgPerWeek:number,
 *   perMember:Array<{name:string, pct:number}>}>}
 */
export function rankSwaps(state, env) {
  const base = householdDose(state.members, state.home, env);
  const baseCo2 = weeklyCommuteCo2(state.members);
  return SWAPS.filter((s) => s.applies(state))
    .map((swap) => {
      const next = clone(state);
      swap.apply(next);
      const after = householdDose(next.members, next.home, env);
      const deltaUg = base.total - after.total;
      return {
        id: swap.id,
        title: typeof swap.title === 'function' ? swap.title(state) : swap.title,
        category: swap.category,
        cost: swap.cost,
        why: swap.why,
        deltaUg,
        pct: base.total > 0 ? (deltaUg / base.total) * 100 : 0,
        cigarettesPerWeek: (deltaUg / UG_PER_CIGARETTE) * DAYS_PER_WEEK,
        co2KgPerWeek: baseCo2 - weeklyCommuteCo2(next.members),
        perMember: base.perMember.map((b, i) => ({
          name: b.name,
          pct: b.total > 0 ? ((b.total - after.perMember[i].total) / b.total) * 100 : 0,
        })),
      };
    })
    .filter((r) => r.deltaUg > MIN_DOSE_DELTA_UG || r.co2KgPerWeek > MIN_CO2_DELTA_KG)
    .sort((a, b) => b.deltaUg - a.deltaUg);
}

/**
 * Applies a set of swaps together and returns the combined result.
 * @param {State} state
 * @param {import('./types.js').Environment} env
 * @param {string[]} ids
 */
export function combine(state, env, ids) {
  const next = clone(state);
  ids.forEach((id) => SWAPS.find((s) => s.id === id)?.apply(next));
  const before = householdDose(state.members, state.home, env);
  const after = householdDose(next.members, next.home, env);
  return {
    before,
    after,
    pct: before.total > 0 ? ((before.total - after.total) / before.total) * 100 : 0,
    state: next,
  };
}
