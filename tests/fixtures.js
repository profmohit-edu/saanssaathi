/** Shared test fixtures. */

/**
 * Synthetic winter-smog day: high at night/morning, clean mid-afternoon.
 * Starts at local midnight of a fixed date so tests are deterministic.
 */
export function smogSeries(start = new Date(2026, 10, 24, 0, 0, 0)) {
  const shape = [210, 220, 230, 235, 240, 245, 250, 240, 220, 190, 160, 130,
    110, 90, 80, 85, 110, 150, 190, 220, 240, 250, 245, 230];
  const out = [];
  for (let d = 0; d < 2; d++) {
    shape.forEach((v, h) => out.push({ time: new Date(start.getTime() + (d * 24 + h) * 3600000), pm25: v }));
  }
  return out;
}

export function demoMembers() {
  return [
    { id: 'a', name: 'Rahul', age: 'adult', conditions: [], commuteMode: 'two_wheeler', commuteHours: 1.5,
      outdoorHours: 1, outdoorTime: 'morning', outdoorActivity: 'vigorous', mask: 'cloth' },
    { id: 'b', name: 'Dadi', age: 'senior', conditions: ['asthma'], commuteMode: 'none', commuteHours: 0,
      outdoorHours: 1, outdoorTime: 'morning', outdoorActivity: 'light', mask: 'none' },
  ];
}

export const openHome = () => ({ windows: 'open', purifier: false, sources: ['incense'] });
