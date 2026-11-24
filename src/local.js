/**
 * Location-aware tailoring: which cities have metro rail, and where citizens
 * can report open burning and dust in their city.
 * @module local
 */

/** Indian cities with operational metro rail (normalised names). */
const METRO_CITIES = new Set([
  'delhi',
  'new delhi',
  'noida',
  'greater noida',
  'gurugram',
  'gurgaon',
  'faridabad',
  'ghaziabad',
  'mumbai',
  'navi mumbai',
  'thane',
  'kolkata',
  'howrah',
  'chennai',
  'bengaluru',
  'bangalore',
  'hyderabad',
  'secunderabad',
  'ahmedabad',
  'gandhinagar',
  'surat',
  'pune',
  'lucknow',
  'jaipur',
  'kochi',
  'nagpur',
  'kanpur',
  'agra',
  'bhopal',
  'indore',
  'patna',
  'meerut',
]);

/** Regions grouped for complaint channels. */
const DELHI_NCR = new Set([
  'delhi',
  'new delhi',
  'noida',
  'greater noida',
  'gurugram',
  'gurgaon',
  'faridabad',
  'ghaziabad',
]);

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\s]/gu, '')
    .trim();

/**
 * Whether a place has metro rail.
 * @param {{name?:string, admin1?:string} | null | undefined} place
 */
export function hasMetro(place) {
  return METRO_CITIES.has(norm(place?.name));
}

/**
 * Tailored community actions for the user's city.
 * @param {{name?:string, admin1?:string, country?:string} | undefined} place
 * @returns {Array<{title:string, text:string}>}
 */
export function communityActions(place) {
  const city = norm(place?.name);
  const inIndia = !place?.country || norm(place.country) === 'india';
  const actions = [];
  if (DELHI_NCR.has(city) || norm(place?.admin1) === 'delhi') {
    actions.push({
      title: 'Report burning and dust: Green Delhi app',
      text: 'Photograph garbage burning, construction dust or industrial smoke and report it in the Delhi Government’s Green Delhi app. Complaints go to the agency responsible and are tracked until they’re closed.',
    });
  }
  if (inIndia) {
    actions.push({
      title: 'Report to CPCB: Sameer app',
      text: 'The Central Pollution Control Board’s Sameer app shows live station AQI and takes complaints about open burning, dust and vehicle smoke anywhere in India.',
    });
    actions.push({
      title: 'Make your society a no-burn zone',
      text: 'Ask your RWA to ban leaf and garbage burning, give guards space-heater alternatives to bonfires, and set up a compost pit. One bonfire can affect a whole lane.',
    });
  }
  actions.push({
    title: hasMetro(place) ? 'Start a metro or carpool group' : 'Start a carpool group',
    text: hasMetro(place)
      ? 'Your city has metro rail. Pairing it with shared last-mile autos takes cars off the most polluted rush-hour roads.'
      : 'With no metro here, a 3–4 person office or school carpool cuts vehicles on the road, and the CO₂ and exhaust they produce, by up to 75%.',
  });
  return actions;
}
