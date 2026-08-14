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

import {
  backoffMs,
  CircuitBreaker,
  isTransportError,
  sleep,
  TargetUnreachableError,
} from "./net.mjs";

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

// Transport failures get retried; application failures never do. Three extra
// attempts absorbs the ordinary blips of a real network — a CI runner losing a
// socket, a staging box behind a flaky VPN — without papering over an endpoint
// that is genuinely down, which still fails after the last attempt.
export const DEFAULT_RETRIES = 3;

// Consecutive transport failures before Populace concludes the target is gone
// and stops the run. Twelve is roughly two full ticks' worth of calls for a
// small population — long enough that a brief outage does not abort a good run,
// short enough that a dead host is called in under a minute instead of grinding
// out the full duration and producing nothing.
export const DEFAULT_GIVE_UP_AFTER = 12;

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
      // Failures split by whose problem they are. `apiFailures` are findings
      // about the customer's code; `transportFailures` are the network between
      // us and them, and must never be presented as the same thing.
      apiFailures: 0,
      transportFailures: 0,
      // Attempts that failed at transport level and were retried. Kept and
      // reported: a run that only survived on its fifth try is not the same as
      // one that worked first time, and hiding that would inflate reliability.
      retries: 0,
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

export function instrument(
  adapter,
  metrics,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    giveUpAfter = DEFAULT_GIVE_UP_AFTER,
    breaker = new CircuitBreaker({ threshold: giveUpAfter }),
  } = {},
) {
  const wrapped = { name: adapter.name };
  metrics.breaker = breaker;
  // 0 or Infinity disables the deadline, for adapters whose work is legitimately
  // long (a batch import, a deliberate slow-endpoint probe).
  const limited = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const maxAttempts = Math.max(1, Number(retries) + 1);

  for (const key of Object.keys(adapter)) {
    const value = adapter[key];
    if (typeof value !== "function") {
      wrapped[key] = value;
      continue;
    }

    /** One attempt, with the deadline applied. Timing is per-attempt. */
    const attemptOnce = async (args) => {
      const clock = limited ? deadline(key, timeoutMs) : null;
      const started = performance.now();
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
        return { ok: true, result, ms: performance.now() - started };
      } catch (error) {
        return { ok: false, error, ms: performance.now() - started };
      } finally {
        clock?.cancel();
      }
    };

    wrapped[key] = async (...args) => {
      const entry = bucket(metrics, key);
      entry.calls += 1;

      // Already given up on this target: fail instantly rather than spend the
      // full deadline discovering the same thing again.
      if (breaker.open) {
        const error = new TargetUnreachableError(breaker.openedAfter);
        error.fromAdapter = true;
        entry.failures += 1;
        entry.transportFailures += 1;
        entry.durations.push(0);
        if (entry.firstErrorAt === null) entry.firstErrorAt = Date.now();
        const shape = normaliseError(error);
        entry.errors.set(shape, (entry.errors.get(shape) || 0) + 1);
        throw error;
      }

      for (let attempt = 1; ; attempt++) {
        const outcome = await attemptOnce(args);

        if (outcome.ok) {
          breaker.recordSuccess();
          // Only the SUCCESSFUL attempt's duration is recorded. Including the
          // failed attempts before it would fold network problems into the
          // customer's latency figures and make p50/p95 unpublishable — which
          // is exactly what went wrong in an earlier run of this tool.
          entry.durations.push(outcome.ms);
          return outcome.result;
        }

        const error = outcome.error;
        const transport = isTransportError(error);

        // An error the server RETURNED proves the link is alive, whatever it
        // says about their code. That must reset the breaker, or a genuinely
        // broken endpoint would look like a dead network and abort the run.
        if (transport) breaker.recordTransportFailure();
        else breaker.recordApiFailure();

        // Retry ONLY when the server never answered. Any response the server
        // actually produced — including a 500 — is a finding about their code,
        // and retrying it would quietly turn a real bug into a green tick.
        if (transport && attempt < maxAttempts && !breaker.open) {
          entry.retries += 1;
          await sleep(backoffMs(attempt));
          continue;
        }

        // Mark it as the adapter's, so the engine can tell a customer's API
        // failing apart from a bug of our own. Untagged failures reaching the
        // agent loop are Populace's fault and must not be reported as theirs.
        if (error && typeof error === "object") error.fromAdapter = true;
        entry.durations.push(outcome.ms);
        entry.failures += 1;
        if (transport) entry.transportFailures += 1;
        else entry.apiFailures += 1;
        if (entry.firstErrorAt === null) entry.firstErrorAt = Date.now();
        const shape = normaliseError(error);
        entry.errors.set(shape, (entry.errors.get(shape) || 0) + 1);
        throw error;
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
      apiFailures: entry.apiFailures,
      transportFailures: entry.transportFailures,
      retries: entry.retries,
      failureRate: entry.calls ? entry.failures / entry.calls : 0,
      latencyMs: { ...latency, max: Math.round(sorted[sorted.length - 1] || 0) },
      errors: [...entry.errors.entries()]
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

  // Sort by the customer's own failures first. On a bad link transport noise
  // can dwarf a single real bug, and the bug is what they need to see at the
  // top of the table.
  methods.sort(
    (a, b) => b.apiFailures - a.apiFailures || b.failures - a.failures || b.calls - a.calls,
  );

  const sum = (f) => methods.reduce((n, m) => n + f(m), 0);
  const calls = sum((m) => m.calls);
  const failures = sum((m) => m.failures);
  const apiFailures = sum((m) => m.apiFailures);
  const transportFailures = sum((m) => m.transportFailures);
  const retries = sum((m) => m.retries);

  return {
    calls,
    failures,
    apiFailures,
    transportFailures,
    retries,
    failureRate: calls ? failures / calls : 0,
    // The rate that actually says something about their software. Reported
    // separately so a bad link cannot inflate the number they are judged on.
    apiFailureRate: calls ? apiFailures / calls : 0,
    network: {
      retries,
      transportFailures,
      // Attempts that had to be repeated, as a share of all attempts made.
      // A high number here means the link was bad, NOT that the API was.
      retryRate: calls + retries ? retries / (calls + retries) : 0,
      healthy: retries === 0 && transportFailures === 0,
      // Set when Populace concluded the target was gone and stopped early.
      // Without this the report would show a short run full of failures and
      // give no clue that it was cut short deliberately.
      gaveUp: Boolean(metrics.breaker?.open),
      gaveUpAfter: metrics.breaker?.openedAfter ?? null,
    },
    durationMs: (metrics.endedAt || Date.now()) - metrics.startedAt,
    methods,
  };
}
