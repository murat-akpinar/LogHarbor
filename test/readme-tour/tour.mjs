#!/usr/bin/env node
// Records the gif at the top of the README.
//
// It exists because the alternative is a screen recording nobody can redo. The UI moves
// every week; a hero image that cannot be regenerated is out of date the moment it lands,
// and then it stays wrong because re-shooting it by hand is an afternoon.
//
// Usage (from this directory):
//   node tour.mjs                                          throwaway server, seeded
//   node tour.mjs --url http://192.168.1.131:5000 --pass '...'
//   node tour.mjs --keep-video                             leave the webm for inspection
//
// Playwright comes from ../perf-check (installed there), as does the seeder. Encoding
// needs ffmpeg on PATH and npx for gifsicle; without them the webm is kept and the two
// commands are printed instead.
//
// Two things here are deliberate and look like cheating until you have watched the
// unedited take:
//   * a drawn cursor. Playwright's recording has no pointer, so a click looks like the
//     page changing on its own -- the whole thing reads as a slideshow of screenshots.
//   * a warm-up page whose video is thrown away. The first load pays for the bundle, the
//     fonts and every cold query, which is six seconds of empty frames at the front.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const HARNESS = path.join(REPO, 'test/perf-check');
const require = createRequire(path.join(HARNESS, path.sep));
const { chromium } = require('playwright');
const { seed } = await import(new URL('../perf-check/seed.mjs', import.meta.url));

const WORK = path.join(HERE, '.work');
const GIF = path.join(REPO, 'images/logharbor-tour.gif');
const PORT = 5299;
const VIEWPORT = { width: 1440, height: 900 };

// 860 wide is what GitHub gives a README image; anything larger is scaled down in the
// browser and paid for on every page view. 10fps and 128 colours is where a dark UI stops
// banding, and gifsicle's lossy pass then takes it from ~6 MB to under 4 without smearing
// the mono type -- checked on the Requests table, which is the densest text in the tour.
const GIF_WIDTH = 860;
const GIF_FPS = 10;
const GIF_COLORS = 128;
const GIF_LOSSY = 45;

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const LIVE_URL = arg('--url');
const LIVE_PASS = arg('--pass');
const KEEP_VIDEO = args.includes('--keep-video');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

function run(command, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output)
      : reject(new Error(`${command} exited ${code}\n${output.slice(-2000)}`))));
  });
}

async function waitForHealth(baseUrl, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return;
    } catch { /* not listening yet */ }
    await sleep(300);
  }
  throw new Error(`${baseUrl}/healthz never answered`);
}

/** Builds and runs the API against a throwaway database, with a password nothing else sees. */
async function startServer() {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'logharbor-tour-'));
  const password = `tour-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  log('building the API (Release)...');
  await run('dotnet', ['build', path.join(REPO, 'backend/LogHarbor.Api'), '-c', 'Release', '--nologo'],
    { cwd: REPO });

  log(`starting it on ${baseUrl}...`);
  // No shell: a cmd.exe wrapper takes the kill signal and leaves dotnet holding the port.
  const child = spawn('dotnet', ['bin/Release/net8.0/LogHarbor.Api.dll'], {
    cwd: path.join(REPO, 'backend/LogHarbor.Api'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ASPNETCORE_URLS: baseUrl,
      ASPNETCORE_ENVIRONMENT: 'Production',
      LogHarbor__DatabasePath: path.join(dataDir, 'tour.db'),
      LogHarbor__AllowInsecureCookie: 'true',
      LOGHARBOR_ADMIN_PASSWORD: password,
    },
  });
  let serverLog = '';
  let stopping = false;
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });
  child.on('close', (code) => {
    if (!stopping) console.error(`\nserver exited early with ${code}:\n${serverLog.slice(-2000)}`);
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${serverLog.slice(-2000)}`);
  }

  return {
    baseUrl,
    password,
    stop: async () => {
      stopping = true;
      if (process.platform === 'win32') {
        await run('taskkill', ['/pid', String(child.pid), '/T', '/F']).catch(() => {});
      }
      child.kill();
      await sleep(500);
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function login(baseUrl, password) {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('logharbor_session='));
  if (!cookie) throw new Error('login succeeded but returned no session cookie');
  return cookie.split(';')[0].split('=').slice(1).join('=');
}

async function createApiKey(baseUrl, sessionCookie) {
  const r = await fetch(`${baseUrl}/api/apikeys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `logharbor_session=${sessionCookie}` },
    body: JSON.stringify({ title: 'readme-tour' }),
  });
  if (!r.ok) throw new Error(`could not create an API key: ${r.status}`);
  const body = await r.json();
  const token = body.token ?? body.key ?? body.apiKey;
  if (!token) throw new Error(`no token in the API key response: ${JSON.stringify(body)}`);
  return token;
}

/** A pointer the recording can see, drawn in the page because the video has none. */
const CURSOR = `
  (() => {
    const draw = () => {
      if (document.getElementById('__tour_cursor')) return;
      const dot = document.createElement('div');
      dot.id = '__tour_cursor';
      dot.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:22px', 'height:22px',
        'margin:-11px 0 0 -11px', 'border-radius:50%', 'pointer-events:none',
        'z-index:2147483647', 'transition:transform 60ms linear',
        'background:radial-gradient(circle at 50% 50%, rgba(255,255,255,.95) 0 3px, rgba(255,255,255,.28) 4px 7px, transparent 8px)',
        'box-shadow:0 0 0 1.5px rgba(255,255,255,.55), 0 0 14px 4px rgba(120,220,190,.45)',
        'opacity:0',
      ].join(';');
      document.body.appendChild(dot);
      window.__tourMove = (x, y) => {
        dot.style.opacity = '1';
        dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      };
      window.__tourPress = () => {
        dot.animate(
          [{ boxShadow: '0 0 0 1.5px rgba(255,255,255,.55), 0 0 14px 4px rgba(120,220,190,.45)' },
           { boxShadow: '0 0 0 10px rgba(120,220,190,0)' }],
          { duration: 420, easing: 'ease-out' },
        );
      };
    };
    if (document.body) draw();
    else document.addEventListener('DOMContentLoaded', draw);
  })();
`;

let cursor = { x: VIEWPORT.width / 2, y: 120 };

async function glide(page, x, y, steps = 16) {
  const from = { ...cursor };
  for (let i = 1; i <= steps; i++) {
    // ease-in-out, so the pointer starts and lands softly instead of tracking like a robot
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    const px = from.x + (x - from.x) * eased;
    const py = from.y + (y - from.y) * eased;
    await page.mouse.move(px, py);
    await page.evaluate(([a, b]) => window.__tourMove?.(a, b), [px, py]).catch(() => {});
    await sleep(14);
  }
  cursor = { x, y };
}

async function clickNav(page, route, label) {
  const link = page.locator(`a[href="${route}"]`).first();
  const box = await link.boundingBox();
  if (!box) throw new Error(`no nav link for ${label} (${route})`);
  await glide(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(140);
  await page.evaluate(() => window.__tourPress?.());
  await link.click();
  await page.waitForFunction((p) => location.pathname === p, route, { timeout: 15000 });
}

/**
 * Waits for the page's own placeholders to go, not for the network to fall idle: the live
 * tail holds a websocket open, so networkidle never arrives and every dwell would be spent
 * filming skeletons.
 */
async function settled(page, timeout = 15000) {
  await page.waitForFunction(() => document.querySelectorAll('[data-skeleton]').length === 0,
    null, { timeout }).catch(() => {});
}

async function record(server, live) {
  const session = await login(server.baseUrl, server.password);

  if (!live) {
    const apiKey = await createApiKey(server.baseUrl, session);
    log('seeding 16000 events over 6h...');
    const sent = await seed({ baseUrl: server.baseUrl, apiKey, count: 16000, hours: 6, seed: 20260801 });
    const health = await (await fetch(`${server.baseUrl}/healthz`)).json();
    log(`  stored ${health.eventCount} of ${sent}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: WORK, size: VIEWPORT },
    });
    await context.addCookies([{ name: 'logharbor_session', value: session, url: server.baseUrl }]);
    // The UI opens in Turkish; every English selector below would silently time out.
    await context.addInitScript(() => localStorage.setItem('logharbor-lang', 'en'));
    // The rejection banner reopens for anything newer than what has been read. Marking it read
    // is what an operator does anyway, and a stale week-old warning is not what the gif is for.
    await context.addInitScript(() => localStorage.setItem('logharbor-rejections-dismissed',
      JSON.stringify(new Date(Date.now() + 864e5).toISOString())));
    // The browser paints its own white canvas until the stylesheet lands. On a dark UI that is
    // a full-frame flash, and it would be the first thing the gif shows.
    await context.addInitScript(() => { document.documentElement.style.background = '#0a0d11'; });
    await context.addInitScript(CURSOR);

    const warm = await context.newPage();
    await warm.goto(`${server.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await settled(warm);
    await sleep(1200);
    const warmVideo = await warm.video()?.path();
    await warm.close();
    log('warm-up done');

    const page = await context.newPage();
    await page.goto(`${server.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await settled(page);
    await sleep(1900); // the entrance animation, which is the one bit of motion worth filming

    // Park on the activity chart: one hover, one crosshair, all three lanes reading the
    // same instant. That is the dashboard's whole argument and a still cannot show it.
    await glide(page, 900, 430, 22);
    await sleep(800);

    for (const [route, label, dwell, scroll] of [
      ['/events', 'Events', 3000, 0],
      ['/requests', 'Requests', 2200, 300],
      ['/exceptions', 'Exceptions', 2400, 0],
      ['/analysis', 'Analysis', 2400, 260],
    ]) {
      await clickNav(page, route, label);
      await settled(page);
      log(`  ${label}`);
      await sleep(dwell);
      if (scroll) {
        for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, scroll / 5); await sleep(80); }
        await sleep(800);
        await page.mouse.wheel(0, -scroll);
        await sleep(350);
      }
    }

    await clickNav(page, '/', 'Dashboard');
    await settled(page);
    await sleep(2000);

    const video = await page.video()?.path();
    await context.close(); // this is what flushes the file
    if (warmVideo) await rm(warmVideo, { force: true }).catch(() => {});
    return video;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function encode(video) {
  const filters = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];`
    + `[s0]palettegen=max_colors=${GIF_COLORS}:stats_mode=diff[p];`
    + '[s1][p]paletteuse=dither=none:diff_mode=rectangle';
  const raw = path.join(WORK, 'tour-raw.gif');

  log('encoding...');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', filters, '-loop', '0', raw]);

  // Node refuses to spawn a .cmd without a shell (EINVAL since 20.x), and npx on Windows is
  // a .cmd -- without the shell the optimiser silently never runs and the gif ships at 6 MB.
  // One command string rather than an args array: with shell:true an array is only
  // concatenated anyway, and Node deprecation-warns about it on every run.
  const command = `npx --yes gifsicle -O3 --lossy=${GIF_LOSSY} "${raw}" -o "${GIF}"`;
  try {
    await run(command, [], { shell: true });
  } catch (error) {
    log(`gifsicle unavailable (${error.message.split('\n')[0]}); shipping the unoptimised gif`);
    await copyFile(raw, GIF);
  }
}

async function main() {
  await rm(WORK, { recursive: true, force: true }).catch(() => {});
  await mkdir(WORK, { recursive: true });

  const live = Boolean(LIVE_URL);
  if (live && !LIVE_PASS) throw new Error('--url needs --pass');
  const server = live
    ? { baseUrl: LIVE_URL.replace(/\/$/, ''), password: LIVE_PASS, stop: async () => {} }
    : await startServer();

  let video;
  try {
    video = await record(server, live);
  } finally {
    await server.stop();
  }

  try {
    await encode(video);
  } catch (error) {
    log(`\ncould not encode (${error.message.split('\n')[0]})`);
    log(`the recording is at ${video}`);
    return;
  }

  if (!KEEP_VIDEO) await rm(WORK, { recursive: true, force: true }).catch(() => {});
  else log(`kept ${(await readdir(WORK)).join(', ')} in ${WORK}`);
  log(`\nwrote ${path.relative(REPO, GIF)}`);
}

await main();
