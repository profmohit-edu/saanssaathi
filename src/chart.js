/**
 * Dependency-free SVG bar chart of the hourly PM2.5 forecast, plus an
 * accessible table version of the same data.
 * @module chart
 */
import { bandForPm25 } from './aqi.js';
import { h } from './dom.js';
import { MS_PER_HOUR } from './config.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
};

/** Chart geometry in SVG user units. */
const GEOMETRY = { width: 720, height: 220, padLeft: 36, padBottom: 26, padTop: 12 };
/** PM2.5 levels (µg/m³) drawn as gridlines: WHO guideline and NAQI band edges. */
const GRID_LEVELS = [15, 60, 120, 250];
const LABEL_EVERY_HOURS = 3;
const hourFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: true });

/**
 * @typedef {object} Scale
 * @property {number} barWidth
 * @property {number} max Top of the y axis in µg/m³.
 * @property {(v: number) => number} y Maps µg/m³ to an SVG y coordinate.
 */

/**
 * @param {import('./windows.js').HourPoint[]} pts
 * @returns {Scale}
 */
function makeScale(pts) {
  const { width, height, padLeft, padBottom, padTop } = GEOMETRY;
  const max = Math.max(60, ...pts.map((p) => p.pm25)) * 1.08;
  return {
    barWidth: (width - padLeft) / pts.length,
    max,
    y: (v) => padTop + (height - padTop - padBottom) * (1 - v / max),
  };
}

/**
 * @param {SVGElement} root
 * @param {Scale} scale
 */
function drawGrid(root, scale) {
  const { width, padLeft } = GEOMETRY;
  for (const level of GRID_LEVELS.filter((v) => v < scale.max)) {
    root.append(svg('line', { x1: padLeft, x2: width, y1: scale.y(level), y2: scale.y(level), class: 'grid' }));
    const label = svg('text', { x: padLeft - 6, y: scale.y(level) + 4, 'text-anchor': 'end', class: 'axis' });
    label.textContent = String(level);
    root.append(label);
  }
}

/**
 * Shades the cleanest window behind the bars.
 * @param {SVGElement} root
 * @param {import('./windows.js').HourPoint[]} pts
 * @param {Scale} scale
 * @param {{start:Date, end:Date}|null} best
 */
function drawBestWindow(root, pts, scale, best) {
  const i0 = best ? pts.findIndex((p) => p.time.getTime() === best.start.getTime()) : -1;
  if (!best || i0 < 0) {
    return;
  }
  const { height, padLeft, padBottom, padTop } = GEOMETRY;
  const hours = Math.round((best.end.getTime() - best.start.getTime()) / MS_PER_HOUR);
  const attrs = { x: padLeft + i0 * scale.barWidth + 1, y: padTop - 4, rx: 6, class: 'best-window' };
  root.append(svg('rect', { ...attrs, width: hours * scale.barWidth - 2, height: height - padTop - padBottom + 6 }));
}

/**
 * One coloured bar with a tooltip, plus an hour label every few hours.
 * @param {SVGElement} root
 * @param {import('./windows.js').HourPoint} p
 * @param {number} i
 * @param {Scale} scale
 */
function drawBar(root, p, i, scale) {
  const { height, padLeft, padBottom } = GEOMETRY;
  const band = bandForPm25(p.pm25);
  const x = padLeft + i * scale.barWidth;
  const top = scale.y(p.pm25);
  const bar = svg('rect', {
    x: x + scale.barWidth * 0.12,
    y: top,
    width: scale.barWidth * 0.76,
    height: Math.max(1, height - padBottom - top),
    rx: 2,
    fill: band.color,
  });
  const title = svg('title');
  title.textContent = `${hourFmt.format(p.time)}: ${Math.round(p.pm25)} µg/m³ (${band.label})`;
  bar.append(title);
  root.append(bar);
  if (i % LABEL_EVERY_HOURS === 0) {
    const label = svg('text', { x: x + scale.barWidth / 2, y: height - 8, 'text-anchor': 'middle', class: 'axis' });
    label.textContent = hourFmt.format(p.time).replace(' ', '');
    root.append(label);
  }
}

/**
 * @param {HTMLElement} host
 * @param {import('./windows.js').HourPoint[]} pts
 * @param {{start:Date, end:Date}|null} best
 */
export function renderChart(host, pts, best) {
  const { width, height } = GEOMETRY;
  const scale = makeScale(pts);
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    focusable: 'false',
    'aria-hidden': 'true',
  });
  drawGrid(root, scale);
  drawBestWindow(root, pts, scale, best);
  pts.forEach((p, i) => drawBar(root, p, i, scale));
  host.replaceChildren(root);
}

/**
 * Accessible table alternative.
 * @param {import('./windows.js').HourPoint[]} pts
 */
export function renderTable(pts) {
  const fmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', hour: 'numeric', hour12: true });
  return h(
    'table',
    {},
    h('caption', { class: 'sr-only' }, 'Hourly PM2.5 forecast'),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Hour'),
        h('th', { scope: 'col' }, 'PM2.5 (µg/m³)'),
        h('th', { scope: 'col' }, 'Band'),
      ),
    ),
    h(
      'tbody',
      {},
      pts.map((p) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, fmt.format(p.time)),
          h('td', {}, String(Math.round(p.pm25))),
          h('td', {}, bandForPm25(p.pm25).label),
        ),
      ),
    ),
  );
}
