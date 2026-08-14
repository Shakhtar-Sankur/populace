// Wraps an adapter so every call through it is timed, counted, and its failures
// grouped by message.
//
// This is what a customer actually buys. The simulation being interesting to
// watch is not the product — the product is the evidence it leaves behind:
// which of your endpoints broke, how often, under how many concurrent users,
// and how slow they got while it was happening.
//
// Neither the engine nor the adapter knows this exists. The engine calls
// `adapter.post(...)`; the adapter does its thing; the numbers accumulate in
// between.

const PERCENTILES = [50, 95, 99];

// A call that never comes back is the worst failure mode this tool has, because
// it does not look like a failure — it looks like nothing. A real run against a
// flaky network froze at tick 24 of 60 and sat there silently until an external
// timeout killed it 9 minutes later, producing no report at all. The customer's
// API was fine; one socket died and the whole run went with it.
//
// So every adapter call gets a deadline. Past it we stop waiting, record a
// normal failure, and let the other agents carry on. A slow API then shows up
// as a timeout in the report — which is a finding — instead of a hung process,
// which is nothing.
export const DEFAULT_TIMEOUT_MS = 20_000;

export class TimeoutError extends Error {
  constructor(method, ms) {
    super(`${method} timed out after ${ms}ms`);
    this.name = "TimeoutError";
    this.isTimeout = true;
  }
}

/**
 * Reject once `ms` has passed. Resolves to a cancel() so the timer is always
 * cleared — an uncleared timer keeps the process alive past the end of a run,
 * which would make `populace run` hang on exit for every fast call.
 */
function deadline(method, ms) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(method, ms)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export function createMetrics() {
  return { methods: new Map(), startedAt: Date.now(), endedAt: null };
}

function bucket(metrics, method) {
  if (!metrics.methods.has(method)) {
    metrics.methods.set(method, {
      method,
      calls: 0,
      failures: 0,
      durations: [],
      errors: new Map(),
      firstErrorAt: null,
    });
  }
  return metrics.methods.get(method);
}

/**
 * Group errors by SHAPE, not by exact text. Two failures that differ only by a
 * uuid or a row count are the same bug, and a report that lists them separately
 * buries the signal it was written to surface.
 */
export function normaliseError(error) {
  return String(error?.message || error || "unknown error")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function instrument(adapter, metrics, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const wrapped = { name: adapter.name };
  // 0 or Infinity disables the deadline, for adapters whose work is legitimately
  // long (a batch import, a deliberate slow-endpoint probe).
  const limited = Number.isFinite(timeoutMs) && timeoutMs > 0;

  for (const key of Object.keys(adapter)) {
    const value = adapter[key];
    if (typeof value !== "function") {
      wrapped[key] = value;
      continue;
    }
    wrapped[key] = async (...args) => {
      const entry = bucket(metrics, key);
      const started = performance.now();
      entry.calls += 1;
      const clock = limited ? deadline(key, timeoutMs) : null;
      try {
        // We stop WAITING at the deadline; we cannot cancel the adapter's own
        // work, so a late reply may still land and is simply ignored. Recording
        // the timeout as the outcome is honest — the run did not get an answer
        // in time, which is exactly what a user of the API would experience.
        const call = value.apply(adapter, args);
        // Never leave a late rejection unhandled: once we have raced past it,
        // nothing is awaiting `call`, and an unhandled rejection would crash the
        // run with a stack trace that has nothing to do with the real problem.
        if (clock) call.then?.(undefined, () => {});
        const result = clock ? await Promise.race([call, clock.promise]) : await call;
        entry.durations.push(performance.now() - started);
        return result;
      } catch (error) {
        // Mark it as the adapter's, so the engine can tell a customer's API
        // failing apart from a bug of our own. Untagged failures reaching the
        // agent loop are Populace's fault and must not be reported as theirs.
        if (error && typeof error === "object") error.fromAdapter = true;
        entry.durations.push(performance.now() - started);
        entry.failures += 1;
        if (entry.firstErrorAt === null) entry.firstErrorAt = Date.now();
        const shape = normaliseError(error);
        entry.errors.set(shape, (entry.errors.get(shape) || 0) + 1);
        throw error;
      } finally {
        clock?.cancel();
      }
    };
  }
  return wrapped;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

export function summarise(metrics) {
  const methods = [...metrics.methods.values()].map((entry) => {
    const sorted = [...entry.durations].sort((a, b) => a - b);
    const latency = Object.fromEntries(
      PERCENTILES.map((p) => [`p${p}`, Math.round(percentile(sorted, p))]),
    );
    return {
      method: entry.method,
      calls: entry.calls,
      failures: entry.failures,
      failureRate: entry.calls ? entry.failures / entry.calls : 0,
      latencyMs: { ...latency, max: Math.round(sorted[sorted.length - 1] || 0) },
      errors: [...entry.errors.entries()]
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

  methods.sort((a, b) => b.failures - a.failures || b.calls - a.calls);

  const calls = methods.reduce((n, m) => n + m.calls, 0);
  const failures = methods.reduce((n, m) => n + m.failures, 0);

  return {
    calls,
    failures,
    failureRate: calls ? failures / calls : 0,
    durationMs: (metrics.endedAt || Date.now()) - metrics.startedAt,
    methods,
  };
}
