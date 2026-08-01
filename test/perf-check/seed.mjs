// Fills a LogHarbor instance with a known, repeatable event mix.
//
// "Known" is the whole point: a perf number is only comparable next month if the
// data underneath it is the same shape and the same size. Everything here comes
// out of a seeded PRNG, so two runs a month apart differ only in the timestamps.
//
// The property names are not arbitrary either -- they are the defaults the stats
// endpoints read (StatsEndpoints.cs). Get one wrong and the page still renders,
// just empty, which measures an empty page very fast and tells you nothing:
//   Elapsed .......... latency tiles, Requests p95, Services
//   Path, Method ..... Requests
//   UserId ........... Users
//   commandText, elapsed, connection ... Queries
//   service.name ..... Services
//   @x (exception) ... Exceptions

/** Mulberry32: tiny, seeded, and identical across Node versions. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERVICES = ['checkout-api', 'orders-worker', 'identity'];
const ROUTES = [
  ['GET', '/api/orders'],
  ['GET', '/api/orders/{id}'],
  ['POST', '/api/orders'],
  ['GET', '/api/products'],
  ['POST', '/api/carts/{cartId}/items'],
  ['GET', '/api/users/{id}'],
  ['POST', '/api/auth/login'],
];
const QUERIES = [
  'SELECT * FROM orders WHERE customer_id = @p0',
  'UPDATE inventory SET qty = qty - @p0 WHERE sku = @p1',
  'SELECT COUNT(*) FROM events WHERE created_at > @p0',
  'INSERT INTO audit_log (actor, action) VALUES (@p0, @p1)',
];
const EXCEPTIONS = [
  ['Npgsql.PostgresException', 'duplicate key value violates unique constraint "orders_pkey"'],
  ['System.TimeoutException', 'The operation has timed out.'],
  ['System.InvalidOperationException', 'Sequence contains no elements'],
];

/**
 * A spike in the last fifth of the window, because a flat series hides exactly the
 * thing these pages exist to show -- and a chart with nothing to draw is not the
 * chart anyone will be looking at when they wonder whether a page got slower.
 */
function isSpike(position) {
  return position > 0.78 && position < 0.86;
}

export function* generateEvents({ count, hours = 6, seed = 20260801, now = Date.now() }) {
  const random = rng(seed);
  const spanMs = hours * 3600 * 1000;
  const start = now - spanMs;

  for (let i = 0; i < count; i++) {
    const position = i / count;
    const at = new Date(start + spanMs * position).toISOString();
    const spike = isSpike(position);
    const service = SERVICES[Math.floor(random() * SERVICES.length)];
    const roll = random();

    if (roll < 0.62) {
      const [method, path] = ROUTES[Math.floor(random() * ROUTES.length)];
      const failed = random() < (spike ? 0.22 : 0.02);
      const base = spike ? 420 : 45;
      yield {
        '@t': at,
        '@mt': 'HTTP {Method} {Path} responded {StatusCode} in {Elapsed:0.0} ms',
        '@l': failed ? 'Error' : 'Information',
        Method: method,
        Path: path.replace('{id}', String(1000 + Math.floor(random() * 9000)))
          .replace('{cartId}', String(500 + Math.floor(random() * 400))),
        StatusCode: failed ? 500 : 200,
        Elapsed: +(base * (0.4 + random() * 2.2)).toFixed(1),
        UserId: `u-${100 + Math.floor(random() * 40)}`,
        'service.name': service,
      };
    } else if (roll < 0.82) {
      yield {
        '@t': at,
        '@mt': 'Executed DbCommand ({elapsed} ms) [Parameters=[]], CommandText={commandText}',
        '@l': 'Debug',
        commandText: QUERIES[Math.floor(random() * QUERIES.length)],
        elapsed: +((spike ? 180 : 12) * (0.3 + random() * 2.5)).toFixed(1),
        connection: `Host=db-${1 + Math.floor(random() * 2)};Database=shop`,
        'service.name': service,
      };
    } else if (roll < 0.9) {
      yield {
        '@t': at,
        '@mt': 'Cache {Outcome} for {Key}',
        '@l': random() < 0.25 ? 'Warning' : 'Information',
        Outcome: random() < 0.5 ? 'hit' : 'miss',
        Key: `product:${Math.floor(random() * 200)}`,
        Elapsed: +(random() * 8).toFixed(2),
        UserId: `u-${100 + Math.floor(random() * 40)}`,
        'service.name': service,
      };
    } else if (roll < 0.97 || !spike) {
      yield {
        '@t': at,
        '@mt': 'Background job {Job} completed in {Elapsed:0.0} ms',
        '@l': 'Information',
        Job: random() < 0.5 ? 'reconcile-payments' : 'expire-carts',
        Elapsed: +(500 + random() * 4000).toFixed(1),
        'service.name': service,
      };
    } else {
      const [type, message] = EXCEPTIONS[Math.floor(random() * EXCEPTIONS.length)];
      yield {
        '@t': at,
        '@mt': 'Order {OrderId} failed',
        '@l': random() < 0.2 ? 'Fatal' : 'Error',
        '@x': `${type}: ${message}\n   at Shop.Orders.Handler.Handle(Command c)\n`
          + '   at Shop.Api.Endpoints.Orders.Post(Command c)',
        OrderId: 40000 + Math.floor(random() * 9000),
        Path: '/api/orders',
        Method: 'POST',
        StatusCode: 500,
        Elapsed: +(200 + random() * 900).toFixed(1),
        UserId: `u-${100 + Math.floor(random() * 40)}`,
        'service.name': service,
      };
    }
  }
}

/** Posts CLEF in batches, and throws on the first rejection rather than seeding half a set. */
export async function seed({ baseUrl, apiKey, count, hours, seed: seedValue, batchSize = 1000, log = () => {} }) {
  let batch = [];
  let sent = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const body = batch.map((e) => JSON.stringify(e)).join('\n');
    const response = await fetch(`${baseUrl}/api/events/raw`, {
      method: 'POST',
      headers: { 'X-LogHarbor-ApiKey': apiKey, 'Content-Type': 'application/vnd.serilog.clef' },
      body,
    });
    if (!response.ok) {
      throw new Error(`ingest failed: ${response.status} ${await response.text()}`);
    }
    sent += batch.length;
    log(`  seeded ${sent}`);
    batch = [];
  };

  for (const event of generateEvents({ count, hours, seed: seedValue })) {
    batch.push(event);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return sent;
}
