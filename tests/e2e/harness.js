/**
 * Shared harness for the browser tests: a static file server for the repo,
 * one Chromium, and a page opener with the network stubbed.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE = await readFile(new URL('./fixture-delhi.json', import.meta.url), 'utf8');
/** Forecast "now": 20:35 IST on the fixture's day. */
export const NOW = new Date(1795442400_000 + 35 * 60_000);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const JSON_CORS = { contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } };

let server;
/** @type {import('playwright').Browser | undefined} */
export let browser;
let origin = '';

/** Starts the file server and the browser. */
export async function startHarness() {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, path || 'index.html'));
      res.writeHead(200, { 'content-type': TYPES[extname(path || '.html')] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
}

/** Stops the browser and the file server. */
export async function stopHarness() {
  await browser?.close();
  server?.close();
}

/** Fulfils a stubbed request with a JSON body. @param {import('playwright').Route} route @param {unknown} body */
export const fulfillJson = (route, body) =>
  route.fulfill({ ...JSON_CORS, body: typeof body === 'string' ? body : JSON.stringify(body) });

/**
 * Opens the app with the network stubbed.
 * @param {{airDown?: boolean, context?: import('playwright').BrowserContext, viewport?: {width: number, height: number}}} [opts]
 */
export async function openApp({ airDown = false, context, viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = context ?? (await browser.newContext({ timezoneId: 'Asia/Kolkata', viewport }));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://air-quality-api.open-meteo.com/**', (route) =>
    airDown ? route.abort() : fulfillJson(route, FIXTURE),
  );
  await page.goto(`${origin}/index.html`);
  return { page, ctx, errors };
}
