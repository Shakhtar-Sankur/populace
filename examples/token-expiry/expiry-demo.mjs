// A visible before/after for the session-expiry defect.
//
//   node examples/token-expiry/expiry-demo.mjs
//
// Both runs use the SAME population against the SAME pretend app — an app whose
// access tokens expire after 3 seconds. The only difference is whether the
// adapter implements refreshSession().
//
// This is the failure worth demonstrating because of how it LIES: the agents
// keep moving, the table keeps updating, the run looks healthy — while every
// single call is rejected. A customer would read that as their own API falling
// over under load.

import { World } from "../../src/engine/world.mjs";
import { buildPersonas } from "../../src/engine/personas.mjs";
import { createMetrics, instrument, summarise } from "../../src/instrument.mjs";

const TOKEN_TTL_MS = 3000;

function pretendApp({ supportsRefresh }) {
  const sessions = new Map();
  const seen = { posts: 0, locations: 0 };

  const assertLive = (user) => {
    const expiresAt = sessions.get(user.id);
    if (!expiresAt || Date.now() > expiresAt) {
      throw new Error(`JWT expired (token issued for user ${user.id})`);
    }
  };

  const adapter = {
    name: supportsRefresh ? "with-refresh" : "no-refresh",
    async createUser({ name, phone }) {
      const id = `u_${phone}`;
      sessions.set(id, Date.now() + TOKEN_TTL_MS);
      return { id, name };
    },
    async setProfile(user) {
      assertLive(user);
    },
    async reportLocation(user) {
      assertLive(user);
      seen.locations += 1;
    },
    async post(user) {
      assertLive(user);
      seen.posts += 1;
      return `p${seen.posts}`;
    },
    async recentPostsByOthers(user) {
      assertLive(user);
      return [];
    },
    async deleteUser(user) {
      assertLive(user);
      sessions.delete(user.id);
    },
    seen,
  };

  if (supportsRefresh) {
    adapter.refreshSession = async (user) => {
      if (!sessions.has(user.id)) throw new Error("no session to refresh");
      sessions.set(user.id, Date.now() + TOKEN_TTL_MS);
    };
  }
  return adapter;
}

async function go({ supportsRefresh }) {
  const app = pretendApp({ supportsRefresh });
  const metrics = createMetrics();
  const world = new World({
    adapter: instrument(app, metrics),
    personas: buildPersonas(4, ["manila", "mumbai"]),
    // Refresh well inside the 3s token, the same way the real default sits
    // well inside a 1-hour one.
    options: { refreshEveryMs: 1200 },
  });

  await world.populate({ staggerMs: 0 });
  await world.run({ minutes: 0.25, tickSeconds: 1, realtime: true });
  metrics.endedAt = Date.now();

  const api = summarise(metrics);
  const teardown = await world.teardown();
  return { api, world, app, teardown };
}

const pct = (n) => `${(n * 100).toFixed(0)}%`;
const row = (label, a, b) => console.log(`  ${label.padEnd(30)}${String(a).padStart(18)}${String(b).padStart(18)}`);

console.log(`\n  Pretend app: access tokens expire after ${TOKEN_TTL_MS / 1000}s. Run lasts ~15s.\n`);

process.stdout.write("  running WITHOUT refreshSession… ");
const before = await go({ supportsRefresh: false });
console.log("done");
process.stdout.write("  running WITH refreshSession…    ");
const after = await go({ supportsRefresh: true });
console.log("done\n");

console.log("  " + "─".repeat(64));
row("", "no refreshSession", "with refresh");
console.log("  " + "─".repeat(64));
row("API calls attempted", before.api.calls, after.api.calls);
row("API calls FAILED", before.api.failures, after.api.failures);
row("failure rate", pct(before.api.failureRate), pct(after.api.failureRate));
row("location writes accepted", before.app.seen.locations, after.app.seen.locations);
row("posts accepted", before.app.seen.posts, after.app.seen.posts);
row("accounts cleaned up", before.teardown.removed, after.teardown.removed);
row("accounts LEFT BEHIND", before.teardown.failed.length, after.teardown.failed.length);
console.log("  " + "─".repeat(64));

const topBefore = before.api.methods.find((m) => m.failures)?.errors[0];
if (topBefore) console.log(`\n  What the broken run reported: "${topBefore.message}"`);
console.log(
  `\n  Both runs kept ${before.world.agents.length} agents "alive" on screen the whole time.\n` +
    `  Only the numbers show that one of them stopped testing anything after ${TOKEN_TTL_MS / 1000}s.\n`,
);
