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

export function instrument(adapter, metrics) {
  const wrapped = { name: adapter.name };

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
      try {
        const result = await value.apply(adapter, args);
        entry.durations.push(performance.now() - started);
        return result;
      } catch (error) {
        entry.durations.push(performance.now() - started);
        entry.failures += 1;
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
