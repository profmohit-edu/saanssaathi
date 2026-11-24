/**
 * Shared JSDoc type definitions (no runtime code). Checked by `npm run typecheck`.
 * @module types
 */

/**
 * @typedef {'infant'|'child'|'teen'|'adult'|'senior'} AgeGroup
 * @typedef {'asthma'|'heart'|'pregnant'} Condition
 * @typedef {'morning'|'midday'|'evening'|'best'} OutdoorTime
 * @typedef {'light'|'moderate'|'vigorous'} Activity
 */

/**
 * @typedef {object} Member
 * @property {string} id
 * @property {string} name
 * @property {AgeGroup | string} age
 * @property {Array<Condition | string>} conditions
 * @property {string} commuteMode key of COMMUTE_MODES
 * @property {number} commuteHours
 * @property {number} outdoorHours
 * @property {OutdoorTime | string} outdoorTime
 * @property {Activity | string} outdoorActivity
 * @property {string} mask key of MASKS
 */

/**
 * @typedef {object} Home
 * @property {'open'|'closed'} windows
 * @property {boolean} purifier
 * @property {string[]} sources keys of INDOOR_SOURCES
 */

/**
 * @typedef {object} Place
 * @property {string} name
 * @property {string} [admin1]
 * @property {string} [country]
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * @typedef {object} Household
 * @property {Member[]} members
 * @property {Home} home
 * @property {Place} [place]
 */

/**
 * @typedef {object} HourPoint
 * @property {Date} time
 * @property {number} pm25 µg/m³
 */

/**
 * @typedef {object} TimeWindow
 * @property {Date} start
 * @property {Date} end
 * @property {number} mean µg/m³
 */

/**
 * @typedef {object} Environment
 * @property {HourPoint[]} hours
 * @property {number} current
 * @property {number} dailyMean
 * @property {number} commuteMean
 * @property {Record<string, number>} slots
 * @property {TimeWindow | null} peak
 * @property {(hours: number) => TimeWindow | null} bestFor
 * @property {(m: Pick<Member, 'outdoorTime'|'outdoorHours'>) => number} outdoorMeanFor
 */

/**
 * @typedef {object} Prefs
 * @property {string} lang
 * @property {string} model
 */

/**
 * @typedef {{role: 'user'|'model', text: string}} ChatTurn
 */

/**
 * @typedef {object} Plan
 * @property {'offline'|'gemini'|'gemini-nano'} source
 * @property {string} headline
 * @property {Array<{time: string, title: string, detail: string}>} schedule
 * @property {Array<{who: string, level: string, text: string}>} [alerts]
 * @property {Array<{name: string, advice: string}>} [perMember]
 * @property {string} [impactStory]
 * @property {string} [lang]
 */

/**
 * Mutable UI state shared by the view modules.
 * @typedef {object} AppState
 * @property {Household & {place: Place}} state
 * @property {Prefs} prefs
 * @property {Environment | null} env
 * @property {ReturnType<typeof import('./swaps.js').rankSwaps>} swaps
 * @property {Set<string>} selected
 * @property {ChatTurn[]} chat
 * @property {Plan | null} aiPlan
 * @property {Plan | null} lastPlan the plan currently on screen
 * @property {boolean} busy
 */

/**
 * Actions the views can trigger on the controller.
 * @typedef {object} AppActions
 * @property {(structural?: boolean) => void} changed household edited
 * @property {() => void} recompute re-run the model and re-render results
 * @property {() => void} persist save the household
 * @property {() => Promise<void>} loadAir fetch the forecast for the current place
 * @property {() => void} renderMembers rebuild the member cards
 * @property {() => void} openSettings show the Gemini settings dialog
 */

/** @typedef {{app: AppState, actions: AppActions}} AppContext */

export {};
