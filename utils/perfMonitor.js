'use strict';

// Do do tre event loop + request cham + job nen dang chay, de biet server lag vi dau.
// Log co tien to [perf]; xem tren VPS: pm2 logs server | grep perf
const { monitorEventLoopDelay } = require('perf_hooks');
const { parseBoundedInt } = require('./number');

const REPORT_MS = parseBoundedInt(process.env.PERF_REPORT_MS, 60 * 1000, 10 * 1000, 60 * 60 * 1000);
// Bao cao dinh ky ca khi binh thuong, de co moc so sanh
const HEARTBEAT_MS = parseBoundedInt(process.env.PERF_HEARTBEAT_MS, 10 * 60 * 1000, 60 * 1000, 24 * 3600 * 1000);
const BLOCK_MS = parseBoundedInt(process.env.PERF_BLOCK_MS, 200, 20, 60 * 1000);
const SLOW_REQUEST_MS = parseBoundedInt(process.env.PERF_SLOW_REQUEST_MS, 1500, 50, 10 * 60 * 1000);
const CHECK_MS = 100;
const HISTOGRAM_RESOLUTION_MS = 20;

const inFlightRequests = new Map();
const activeJobs = new Map();
let requestSeq = 0;
let period = createPeriod();

function createPeriod() {
  return { startedAt: Date.now(), requests: 0, slowRequests: 0, blocks: 0, maxBlockMs: 0, routes: new Map() };
}

// "/api/orders/141615/status" -> "/api/orders/:id/status"; khong log query string (co the chua token)
function routeLabel(req) {
  const path = req.route?.path && typeof req.route.path === 'string'
    ? `${req.baseUrl || ''}${req.route.path}`
    : String(req.originalUrl || req.url || '').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id');
  return `${req.method} ${path}`;
}

function describeActive(now) {
  const jobs = [...activeJobs.entries()].map(([name, startedAt]) => `${name}(${now - startedAt}ms)`);
  const requests = [...inFlightRequests.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, 5)
    .map(item => `${item.label}(${now - item.startedAt}ms)`);
  return `jobs=[${jobs.join(', ')}] requests=[${requests.join(', ')}]`;
}

function requestTimingMiddleware(req, res, next) {
  const id = ++requestSeq;
  const startedAt = Date.now();
  const entry = { label: `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`, startedAt };
  inFlightRequests.set(id, entry);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inFlightRequests.delete(id);
    const ms = Date.now() - startedAt;
    const label = routeLabel(req);
    period.requests += 1;
    const route = period.routes.get(label) || { count: 0, totalMs: 0, maxMs: 0 };
    route.count += 1;
    route.totalMs += ms;
    route.maxMs = Math.max(route.maxMs, ms);
    period.routes.set(label, route);
    if (ms >= SLOW_REQUEST_MS) {
      period.slowRequests += 1;
      console.warn(`[perf] request cham ${label} ${ms}ms status=${res.statusCode}`);
    }
  };
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

// Danh dau job nen dang chay -> khi event loop bi chan se biet job nao trung thoi diem
async function trackJob(name, fn) {
  const key = activeJobs.has(name) ? `${name}#${Date.now()}` : name;
  activeJobs.set(key, Date.now());
  try {
    return await fn();
  } finally {
    activeJobs.delete(key);
  }
}

function startPerfMonitor() {
  if (process.env.PERF_MONITOR === 'false') return;

  const histogram = monitorEventLoopDelay({ resolution: HISTOGRAM_RESOLUTION_MS });
  histogram.enable();

  // setInterval tre hon CHECK_MS bao nhieu = event loop bi chan bay nhieu (1 lan dai, khac voi histogram)
  let expected = Date.now() + CHECK_MS;
  const blockTimer = setInterval(() => {
    const now = Date.now();
    const blockedMs = now - expected;
    expected = now + CHECK_MS;
    if (blockedMs < BLOCK_MS) return;
    period.blocks += 1;
    period.maxBlockMs = Math.max(period.maxBlockMs, blockedMs);
    console.warn(`[perf] event loop bi chan ${blockedMs}ms ${describeActive(now)}`);
  }, CHECK_MS);
  blockTimer.unref?.();

  let lastHeartbeat = 0;
  const reportTimer = setInterval(() => {
    const now = Date.now();
    // Histogram tinh ca chu ky do (resolution) -> tru ra de con do tre that (0 = khong lag)
    const toMs = value => Math.max(0, Math.round(value / 1e6) - HISTOGRAM_RESOLUTION_MS);
    const p50 = toMs(histogram.percentile(50));
    const p99 = toMs(histogram.percentile(99));
    const max = toMs(histogram.max);
    histogram.reset();

    const notable = p99 >= 100 || period.blocks > 0 || period.slowRequests > 0;
    if (notable || now - lastHeartbeat >= HEARTBEAT_MS) {
      lastHeartbeat = now;
      const mem = process.memoryUsage();
      const topRoutes = [...period.routes.entries()]
        .sort((a, b) => b[1].totalMs - a[1].totalMs)
        .slice(0, 5)
        .map(([label, r]) => `${label} x${r.count} avg=${Math.round(r.totalMs / r.count)}ms max=${r.maxMs}ms`);
      console.log(
        `[perf] ${Math.round((now - period.startedAt) / 1000)}s: loop p50=${p50}ms p99=${p99}ms max=${max}ms` +
        ` | chan>${BLOCK_MS}ms: ${period.blocks} lan (max ${period.maxBlockMs}ms)` +
        ` | request: ${period.requests} (cham ${period.slowRequests})` +
        ` | rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}MB` +
        (topRoutes.length ? ` | ton thoi gian nhat: ${topRoutes.join('; ')}` : '')
      );
    }
    period = createPeriod();
  }, REPORT_MS);
  reportTimer.unref?.();

  console.log(`[perf] bat dau do: bao cao moi ${REPORT_MS / 1000}s, chan >${BLOCK_MS}ms, request cham >${SLOW_REQUEST_MS}ms`);
}

module.exports = { startPerfMonitor, requestTimingMiddleware, trackJob };
