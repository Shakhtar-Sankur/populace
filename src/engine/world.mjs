// Orchestrates a run: brings a population into existence, lets it live for a
// while, then reports what happened. Knows nothing about the terminal — the CLI
// passes callbacks in, so the same engine can drive a UI or a CI job later.

import { Agent } from "./agent.mjs";
import { buildPersonas } from "./personas.mjs";

export class World {
  constructor({ adapter, personas, options = {}, on = {} }) {
    this.adapter = adapter;
    this.personas = personas;
    this.options = options;
    this.on = on;
    this.agents = [];
    this.signupFailures = [];
    this.stopping = false;
  }

  static fromConfig(config, adapter, on) {
    const { agents = 6, cities } = config.population;
    const personas =
      typeof config.personas === "function"
        ? config.personas(agents, cities)
        : Array.isArray(config.personas)
          ? config.personas
          : buildPersonas(agents, cities);
    const options = {
      ...(config.identity || {}),
      refreshEveryMs: (config.session?.refreshEveryMinutes ?? 30) * 60_000,
    };
    return new World({ adapter, personas, options, on });
  }

  /**
   * Sign everyone in, staggered. Auth endpoints are commonly rate-limited, and
   * a burst of simultaneous sign-ups produces a wall of 429s that looks like a
   * bug in the customer's app when it is really a bug in this harness.
   */
  async populate({ staggerMs = 400 } = {}) {
    for (const [i, persona] of this.personas.entries()) {
      const agent = new Agent(persona, this.adapter, i, this.options);
      try {
        await agent.ensureAccount();
        this.agents.push(agent);
        this.on.joined?.(agent);
      } catch (error) {
        this.signupFailures.push({ persona: persona.name, error: String(error.message || error) });
        this.on.joinFailed?.(persona, error);
      }
      if (staggerMs) await sleep(staggerMs);
    }
    return this.agents.length;
  }

  async run({ minutes = 10, tickSeconds = 5, realtime = true } = {}) {
    const totalTicks = Math.max(1, Math.round((minutes * 60) / tickSeconds));
    for (let tick = 1; tick <= totalTicks && !this.stopping; tick++) {
      // Everyone acts concurrently, the way real users do. Sequential agents
      // would never surface a race condition, which is half the reason to run
      // a simulation at all.
      await Promise.all(this.agents.map((a) => a.tick(tickSeconds, this)));
      this.on.tick?.(tick, totalTicks, this);
      if (realtime) await sleep(tickSeconds * 1000);
    }
    return this.totals();
  }

  totals() {
    return this.agents.reduce(
      (acc, a) => {
        acc.km += a.distanceKm;
        for (const key of Object.keys(a.stats)) acc[key] = (acc[key] || 0) + a.stats[key];
        return acc;
      },
      { km: 0, posts: 0, likes: 0, comments: 0, messages: 0, groups: 0, errors: 0 },
    );
  }

  stop() {
    this.stopping = true;
  }

  /** Remove every account this run created, through the app's own delete path. */
  async teardown() {
    const results = { removed: 0, failed: [] };
    for (const agent of this.agents) {
      try {
        await agent.selfDestruct();
        results.removed += 1;
      } catch (error) {
        results.failed.push({ name: agent.persona.name, error: String(error.message || error) });
      }
    }
    return results;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
