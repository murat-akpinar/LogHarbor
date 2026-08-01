#!/usr/bin/env node
// Drives the real pages of a real LogHarbor and prints what each one cost.
//
// It exists because every number behind the 2026-07-31 performance work came from
// throwaway scripts that no longer exist. None of it could be re-run, so none of it
// could be defended, and the next regression was going to be found the same way the
// last one was: by the owner noticing a page felt slow.
//
// Numbers on stdout, deliberately no assertions. A threshold that fails on a slow
// laptop gets deleted the second time it cries wolf, and then there is no check at all.
//
// Two of the columns are here because nothing else watches them:
//   repeat   an /api path called more than twice on one page. This is the per-row
//            request pattern -- 50 rows each fetching their own histogram -- which
//            has now been introduced and removed twice and never showed up in a test.
//   peak     how many elements were animating at the same moment. Duration is the
//            wrong lever; the count is the lever. Requests once had 1,262.
//
// Usage:
//   npm install && npx playwright install chromium
//   node perf-check.mjs                 # own throwaway server, seeded, deterministic
//   node perf-check.mjs --url http://192.168.1.131:5000 --password-env ADMIN_PASS
//
// The default mode is the one worth comparing over time: it seeds its own instance
// from a fixed PRNG seed, so a month-apart difference is a real difference. Pointing
// --url at a live server measures whatever data happens to be in it that day.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { seed } from './seed.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

// Visited in this order by clicking the real nav links, so every row after the cold
// load is a client-side navigation -- which is how anyone actually moves through the
// app, and the only way the QueryClient's staleTime shows up in the numbers at all.
// Dashboard comes last because the cold load already paid for it.
// Dashboard's nav href is "/", not "/dashboard" -- both routes render it.
const PAGES = [
  ['Events', '/events'],
  ['Requests', '/requests'],
  ['Exceptions', '/exceptions'],
  ['Queries', '/queries'],
  ['Services', '/services'],
  ['Users', '/users'],
  ['Analysis', '/analysis'],
  ['Signals', '/signals'],
  ['Alerts', '/alerts'],
  ['Settings', '/settings'],
  ['Dashboard', '/'],
];

function parseArgs(argv) {
  const options = {
    url: null, port: 5199, events: 18000, hours: 6, seed: 20260801,
    passwordEnv: null, headed: false, viewport: [1440, 900],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') options.url = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--events') options.events = Number(argv[++i]);
    else if (arg === '--hours') options.hours = Number(argv[++i]);
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else if (arg === '--password-env') options.passwordEnv = argv[++i];
    else if (arg === '--headed') options.headed = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(300);
  }
  throw new Error(`${baseUrl}/healthz never answered`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0
      ? resolve(output)
      : reject(new Error(`${command} exited ${code}\n${output.slice(-2000)}`))));
  });
}

/**
 * Builds and runs the API against a throwaway database, with a password this process
 * invents and nothing else ever sees. Nobody's real credentials go anywhere near this.
 */
async function startServer({ port, log }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'logharbor-perf-'));
  const password = `perf-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  log('building the API (Release)...');
  await run('dotnet', ['build', path.join(REPO, 'backend/LogHarbor.Api'), '-c', 'Release', '--nologo'],
    { cwd: REPO });

  log(`starting it on ${baseUrl} against a temp database...`);
  // No shell here on purpose: a cmd.exe wrapper takes the kill signal and leaves the
  // real dotnet process running, which then holds the port and keeps node alive.
  const child = spawn('dotnet', ['bin/Release/net8.0/LogHarbor.Api.dll'], {
    cwd: path.join(REPO, 'backend/LogHarbor.Api'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ASPNETCORE_URLS: baseUrl,
      ASPNETCORE_ENVIRONMENT: 'Production',
      LogHarbor__DatabasePath: path.join(dataDir, 'perf.db'),
      // plain HTTP on loopback, so the session cookie must not be Secure
      LogHarbor__AllowInsecureCookie: 'true',
      LOGHARBOR_ADMIN_PASSWORD: password,
    },
  });
  let serverLog = '';
  let stopping = false;
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });
  child.on('close', (code) => {
    // Only interesting when it died on its own. Our own teardown is not a crash, and
    // dumping the startup log over the results would bury the numbers.
    if (!stopping) console.error(`\nthe server exited early with ${code}:\n${serverLog.slice(-2000)}`);
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${serverLog.slice(-2000)}`);
  }

  return {
    baseUrl,
    username: 'admin',
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

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(`login failed: ${response.status} ${await response.text()}`);
  }
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .find((c) => c.startsWith('logharbor_session='));
  if (!cookie) throw new Error('login succeeded but returned no session cookie');
  return cookie.split(';')[0].split('=').slice(1).join('=');
}

async function createApiKey(baseUrl, sessionCookie) {
  const response = await fetch(`${baseUrl}/api/apikeys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `logharbor_session=${sessionCookie}` },
    body: JSON.stringify({ title: 'perf-check' }),
  });
  if (!response.ok) throw new Error(`could not create an API key: ${response.status}`);
  const body = await response.json();
  const token = body.token ?? body.key ?? body.apiKey;
  if (!token) throw new Error(`no token in the API key response: ${JSON.stringify(body)}`);
  return token;
}

/**
 * Runs before any app code on every navigation. Polls document.getAnimations() rather
 * than listening for events because what matters is how many are running at once, and
 * infinite ones are filtered because the live-tail pulse never ends and would make
 * every page look like it never settles.
 */
const INSTRUMENT = () => {
  // The default resource buffer is 250 entries and silently stops recording past it,
  // which would quietly zero out the later pages in a single-document run.
  performance.setResourceTimingBufferSize(2000);
  const state = { startedAt: performance.now(), lastBusyAt: 0, peak: 0 };
  window.__perf = state;
  window.__perfReset = () => {
    state.startedAt = performance.now();
    state.lastBusyAt = 0;
    state.peak = 0;
  };
  setInterval(() => {
    let live = 0;
    for (const animation of document.getAnimations()) {
      try {
        if (animation.playState !== 'running') continue;
        if (animation.effect?.getTiming?.().iterations === Infinity) continue;
        live++;
      } catch {
        // an animation can be collected mid-poll
      }
    }
    if (live > state.peak) state.peak = live;
    if (live > 0) state.lastBusyAt = performance.now();
  }, 50);
};

/** Reads the resource timings recorded since `fromIndex`, which is how bytes and API calls are counted. */
async function collect(page, fromIndex) {
  return page.evaluate((from) => {
    const entries = performance.getEntriesByType('resource').slice(from);
    const state = window.__perf;
    const api = entries.filter((e) => new URL(e.name).pathname.startsWith('/api/'));
    const byPath = {};
    for (const entry of api) {
      const key = new URL(entry.name).pathname;
      byPath[key] = (byPath[key] ?? 0) + 1;
    }
    return {
      entryCount: performance.getEntriesByType('resource').length,
      requests: entries.length,
      apiRequests: api.length,
      bytes: entries.reduce((sum, e) => sum + (e.encodedBodySize || 0), 0),
      lastApiMs: api.length
        ? Math.max(...api.map((e) => e.responseEnd)) - state.startedAt
        : null,
      settleMs: state.lastBusyAt ? state.lastBusyAt - state.startedAt : 0,
      peakAnimated: state.peak,
      repeats: Object.entries(byPath).filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]),
      // Best-effort only: pages mark rows differently and Events renders a virtualised
      // list this does not see. It is context for the api column, not a measurement.
      rows: document.querySelectorAll('tbody tr, [role="row"]').length,
    };
  }, fromIndex);
}

/** Settled means both quiet: nothing new on the network, nothing still animating. */
async function waitUntilSettled(page, { quietMs = 800, maxMs = 20000 } = {}) {
  const deadline = Date.now() + maxMs;
  let lastCount = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const [count, busy] = await page.evaluate(() => [
      performance.getEntriesByType('resource').length,
      performance.now() - (window.__perf?.lastBusyAt ?? 0),
    ]);
    if (count !== lastCount) { lastCount = count; quietSince = Date.now(); }
    if (Date.now() - quietSince > quietMs && busy > 400) return;
    await sleep(100);
  }
}

function table(rows) {
  const headers = ['page', 'reqs', 'api', 'KB', 'lastApi', 'settle', 'gap', 'peak', 'rows~'];
  const widths = headers.map((h, i) => Math.max(h.length,
    ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells
    .map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c ?? '').padStart(widths[i])))
    .join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`perf-check -- prints what each LogHarbor page costs to open.

  --url URL           measure a running server instead of starting one
  --password-env VAR  env var holding the admin password for --url
  --port N            port for the throwaway server (default 5199)
  --events N          how many events to seed (default 18000)
  --hours N           how many hours to spread them over (default 6)
  --seed N            PRNG seed (default 20260801 -- change only on purpose)
  --headed            watch it run

No thresholds and no exit codes to trip on: read the numbers.`);
    return;
  }

  const log = (message) => console.log(message);
  let server = null;
  let baseUrl = options.url;
  let username = 'admin';
  let password = null;

  if (options.url) {
    if (!options.passwordEnv) {
      throw new Error('--url needs --password-env NAME, naming an env var with the admin password');
    }
    password = process.env[options.passwordEnv];
    if (!password) throw new Error(`${options.passwordEnv} is not set`);
    log(`measuring ${baseUrl} as it is -- its data is whatever is in it today, so these`);
    log('numbers are a snapshot, not a baseline to compare against next month.\n');
  } else {
    server = await startServer({ port: options.port, log });
    baseUrl = server.baseUrl;
    password = server.password;
  }

  try {
    const sessionCookie = await login(baseUrl, username, password);

    if (server) {
      const apiKey = await createApiKey(baseUrl, sessionCookie);
      log(`seeding ${options.events} events over ${options.hours}h (seed ${options.seed})...`);
      const started = Date.now();
      const sent = await seed({
        baseUrl, apiKey, count: options.events, hours: options.hours, seed: options.seed,
      });
      // Ask the server what it actually stored. A 201 per batch is not proof the rows
      // landed, and measuring an empty instance is fast and completely meaningless.
      const health = await (await fetch(`${baseUrl}/healthz`)).json();
      log(`  sent ${sent}, server reports ${health.eventCount} events`
        + ` (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      if (health.eventCount < sent) {
        throw new Error(`only ${health.eventCount} of ${sent} events landed -- not measuring this`);
      }
      log('');
    }

    const browser = await chromium.launch({ headless: !options.headed });
    const context = await browser.newContext({
      viewport: { width: options.viewport[0], height: options.viewport[1] },
    });
    await context.addCookies([{
      name: 'logharbor_session', value: sessionCookie,
      url: baseUrl,
    }]);
    await context.addInitScript(INSTRUMENT);

    const page = await context.newPage();

    // Cold load first: an empty cache is the only time the bundle and the fonts are
    // paid for, and it is the number the font work moved.
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await waitUntilSettled(page);
    const cold = await collect(page, 0);

    const rows = [[
      'cold load', cold.requests, cold.apiRequests, Math.round(cold.bytes / 1024),
      cold.lastApiMs === null ? '-' : Math.round(cold.lastApiMs),
      Math.round(cold.settleMs),
      cold.lastApiMs === null ? '-' : Math.round(cold.settleMs - cold.lastApiMs),
      cold.peakAnimated, cold.rows,
    ]];
    const repeats = [];
    if (cold.repeats.length) repeats.push(['cold load', cold.repeats]);

    // Then each page as a user reaches it: click the nav link, stay in the same
    // document. A page.goto here would be a full reload -- it clears the resource
    // timeline, so every page after the first would report zero requests.
    let cursor = cold.entryCount;
    for (const [name, route] of PAGES) {
      await page.evaluate(() => window.__perfReset());
      const link = page.locator(`a[href="${route}"]`).first();
      if (await link.count() === 0) {
        rows.push([name, '-', '-', '-', '-', '-', '-', '-', 'no nav link']);
        continue;
      }
      await link.click();
      await page.waitForFunction((p) => location.pathname === p, route, { timeout: 10000 });
      await waitUntilSettled(page);
      const measured = await collect(page, cursor);
      cursor = measured.entryCount;
      rows.push([
        name, measured.requests, measured.apiRequests, Math.round(measured.bytes / 1024),
        measured.lastApiMs === null ? '-' : Math.round(measured.lastApiMs),
        Math.round(measured.settleMs),
        measured.lastApiMs === null ? '-' : Math.round(measured.settleMs - measured.lastApiMs),
        measured.peakAnimated, measured.rows,
      ]);
      if (measured.repeats.length) repeats.push([name, measured.repeats]);
    }

    const bundle = await page.evaluate(() => performance.getEntriesByType('resource')
      .map((e) => e.name.split('/').pop()).find((n) => /^index-.*\.js$/.test(n)) ?? 'unknown');

    console.log(`\n${table(rows)}\n`);
    console.log('lastApi = ms until the last /api answered, settle = ms until the last');
    console.log('animation stopped, gap = motion still running after the data arrived.');
    console.log('peak = most elements animating at one moment. rows~ is a best-effort');
    console.log('table-row count for context; Events renders a virtual list it cannot see.\n');

    if (repeats.length === 0) {
      console.log('No /api path was called more than twice on any page (no per-row fetching).');
    } else {
      console.log('Repeated /api calls on one page. A handful is one call per chart and fine;');
      console.log('what is not fine is a count that tracks the row count -- that is the N+1:');
      for (const [name, list] of repeats) {
        for (const [pathname, n] of list) console.log(`  ${name}: ${pathname} x${n}`);
      }
    }
    console.log(`\nbundle measured: ${bundle}`);
    console.log(server
      ? `seeded instance: ${options.events} events, seed ${options.seed}`
      : `live instance: ${baseUrl}`);

    await browser.close();
  } finally {
    if (server) await server.stop();
  }
}

main().then(
  // Explicit exits: a stray handle from playwright or the server child would otherwise
  // leave this hanging after the numbers are already on screen.
  () => process.exit(0),
  (error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  },
);
