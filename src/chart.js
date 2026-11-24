/**
 * Dependency-free SVG bar chart of the hourly PM2.5 forecast, plus an
 * accessible table version of the same data.
 * @module chart
 */
import { bandForPm25 } from './aqi.js';
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/**
 * @param {HTMLElement} host
 * @param {import('./windows.js').HourPoint[]} pts
 * @param {{start:Date, end:Date}|null} best
 */
export function renderChart(host, pts, best) {
  const W = 720, H = 220, padL = 36, padB = 26, padT = 12;
  const max = Math.max(60, ...pts.map((p) => p.pm25)) * 1.08;
  const bw = (W - padL) / pts.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', focusable: 'false', 'aria-hidden': 'true' });

  // Gridlines at standard thresholds.
  for (const g of [15, 60, 120, 250].filter((v) => v < max)) {
    root.append(svg('line', { x1: padL, x2: W, y1: y(g), y2: y(g), class: 'grid' }));
    const t = svg('text', { x: padL - 6, y: y(g) + 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = String(g);
    root.append(t);
  }

  if (best) {
    const i0 = pts.findIndex((p) => p.time.getTime() === best.start.getTime());
    if (i0 >= 0) {
      const n = Math.round((best.end - best.start) / 3600000);
      root.append(svg('rect', { x: padL + i0 * bw + 1, y: padT - 4, width: n * bw - 2, height: H - padT - padB + 6,
        rx: 6, class: 'best-window' }));
    }
  }

  const hourFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: true });
  pts.forEach((p, i) => {
    const band = bandForPm25(p.pm25);
    const bar = svg('rect', { x: padL + i * bw + bw * 0.12, y: y(p.pm25), width: bw * 0.76,
      height: Math.max(1, H - padB - y(p.pm25)), rx: 2, fill: band.color });
    const title = svg('title');
    title.textContent = `${hourFmt.format(p.time)}: ${Math.round(p.pm25)} µg/m³ (${band.label})`;
    bar.append(title);
    root.append(bar);
    if (i % 3 === 0) {
      const t = svg('text', { x: padL + i * bw + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis' });
      t.textContent = hourFmt.format(p.time).replace(' ', '');
      root.append(t);
    }
  });
  host.replaceChildren(root);
}

/**
 * Accessible table alternative.
 * @param {import('./windows.js').HourPoint[]} pts
 */
export function renderTable(pts) {
  const fmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', hour: 'numeric', hour12: true });
  return h('table', {},
    h('caption', { class: 'sr-only' }, 'Hourly PM2.5 forecast'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Hour'), h('th', { scope: 'col' }, 'PM2.5 (µg/m³)'), h('th', { scope: 'col' }, 'Band'))),
    h('tbody', {}, pts.map((p) => h('tr', {},
      h('th', { scope: 'row' }, fmt.format(p.time)),
      h('td', {}, String(Math.round(p.pm25))),
      h('td', {}, bandForPm25(p.pm25).label)))));
}
