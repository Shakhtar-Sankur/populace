// A machine-readable view of a run, for anything watching it happen.
//
// The engine already knows everything anyone could want each tick - every
// person's city, platform, distance, activity and position, and the latency of
// every method. In a terminal it draws all of that as a table. Piped anywhere
// else it deliberately drops to a heartbeat every fifth of the run, because a
// full table written into a CI log would bury the report under thousands of
// screens of scrollback.
//
// That is right for CI and wrong for a window. Populace Studio spawns the CLI
// with its output piped, so it received the CI version: at a one-second tick
// over fifteen minutes, one update every three minutes. The application looked
// frozen while a quarter of a million calls went through it.
//
// So the data was never missing - only the transport. This is the transport.
//
//   populace run --progress json
//
// Each line is `@@populace@@` followed by one JSON object. The prefix means a
// reader can pick these out of ordinary output without ambiguity, and nothing
// is emitted at all unless asked, so a human's terminal is unchanged.
//
// Percentiles are not computed every tick. summarise() sorts every recorded
// duration, and at a quarter of a million calls that is real work to do once a
// second for numbers nobody can read that fast.

export const PROGRESS_PREFIX = "@@populace@@";

/**
 * Cheap per-method counters, straight off the metrics map - no sorting.
 *
 * The most common error message travels with them when there is one. A count
 * of failures tells a watcher that something is wrong; only the message tells
 * them what, and waiting for the report to find out is a long time to sit in
 * front of a run that is already broken.
 */
function counters(metrics) {
  return [...metrics.methods.values()].map((e) => {
    const row = {
      method: e.method,
      calls: e.calls,
      apiFailures: e.apiFailures,
      transportFailures: e.transportFailures,
      retries: e.retries,
    };
    if (e.failures && e.errors?.size) {
      let top = null;
      for (const [message, count] of e.errors) if (!top || count > top.count) top = { message, count };
      if (top) row.error = { message: top.message.slice(0, 300), count: top.count };
    }
    return row;
  });
}

/** p50 and p95 per method. Costs a sort per method, so it runs rarely. */
function latencies(metrics) {
  const out = {};
  for (const e of metrics.methods.values()) {
    if (!e.durations.length) continue;
    const sorted = [...e.durations].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    out[e.method] = { p50: Math.round(at(50)), p95: Math.round(at(95)) };
  }
  return out;
}

/**
 * @param {object} options
 * @param {boolean} options.enabled   emit anything at all
 * @param {number}  options.everyLatency  ticks between percentile refreshes
 * @param {(line: string) => void} options.write
 */
export function createProgress({ enabled, everyLatency = 5, write = (l) => process.stdout.write(l) } = {}) {
  if (!enabled) return { start() {}, joining() {}, tick() {}, done() {} };

  const emit = (event) => {
    try {
      write(`${PROGRESS_PREFIX}${JSON.stringify(event)}\n`);
    } catch {
      // A watcher that has gone away is not a reason to fail a run.
    }
  };

  const startedAt = Date.now();

  return {
    start(config) {
      emit({
        type: "start",
        app: config.app || "populace",
        environment: config.environment,
        agents: config.population.agents,
        cities: config.population.cities,
        minutes: config.population.minutes,
        tickSeconds: config.population.tickSeconds,
        engagement: config.population.engagement ?? 1,
      });
    },

    /**
     * One event per person as they sign in, before any tick exists.
     *
     * Signing 250 people in takes minutes, and until this existed a watcher had
     * nothing to show for it: every counter read zero, the progress bar stayed
     * empty and the clock counted down as though the run were already under way.
     * A window that looks identical to a hung one is a window people kill.
     */
    joining({ done, total, name, city, ok }) {
      emit({ type: "joining", done, total, name, city, ok });
    },

    tick(tickNo, totalTicks, world, metrics) {
      const t = world.totals();
      emit({
        type: "tick",
        tick: tickNo,
        totalTicks,
        elapsedMs: Date.now() - startedAt,
        totals: {
          km: Number(t.km.toFixed(2)),
          posts: t.posts || 0,
          likes: t.likes || 0,
          comments: t.comments || 0,
          messages: t.messages || 0,
          groupJoins: t.groupJoins || 0,
          errors: t.errors || 0,
        },
        // Short keys: this is written once a second with a row per person, and
        // the field names would otherwise be most of the bytes.
        people: world.agents.map((a) => ({
          n: a.persona.name,
          c: a.persona.city.name,
          y: a.persona.city.country,
          p: a.persona.platform,
          k: Number(a.distanceKm.toFixed(1)),
          o: a.stats.posts || 0,
          l: a.stats.likes || 0,
          m: a.stats.messages || 0,
          e: a.stats.errors || 0,
          b: Boolean(a.onBreak),
          la: Number(a.position.lat.toFixed(3)),
          lo: Number(a.position.lng.toFixed(3)),
        })),
        methods: counters(metrics),
        latency: tickNo % everyLatency === 0 || tickNo === totalTicks ? latencies(metrics) : undefined,
      });
    },

    done(report) {
      emit({ type: "done", verdict: report?.verdict?.status || "unknown" });
    },
  };
}
