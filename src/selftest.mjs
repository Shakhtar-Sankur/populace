// Self-test: runs the entire product against an in-memory adapter.
//
// No network, no database, no customer. If this passes, the engine really is
// app-agnostic — because the "app" here is a plain object with no relationship
// to anything.
//
// It also injects a deliberately flaky method, because a reporting tool that
// only ever reports success is worse than no reporting tool at all. We assert
// that the failures are CAUGHT, grouped, and reflected in the verdict.

import assert from "node:assert/strict";
import { World } from "./engine/world.mjs";
import { Agent } from "./engine/agent.mjs";
import { buildPersonas } from "./engine/personas.mjs";
import { createMetrics, instrument, normaliseError, summarise } from "./instrument.mjs";
import { buildReport, renderReport } from "./report.mjs";
import { canSignInOnly, CONTRACT_METHODS, coverageOf, isStub } from "./contract.mjs";

let failed = 0;
const pending = [];
const check = (name, fn) => {
  try {
    const out = fn();
    // Some checks are async. Keep the sync path exactly as it was and let an
    // async one settle before the process reports a total.
    if (out && typeof out.then === "function") {
      pending.push(
        out.then(
          () => console.log(`  ✔ ${name}`),
          (error) => {
            failed += 1;
            console.log(`  ✖ ${name}\n      ${error.message}`);
          },
        ),
      );
      return;
    }
    console.log(`  ✔ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✖ ${name}\n      ${error.message}`);
  }
};

// --- a fake app, backed by plain objects ---------------------------------
function inMemoryAdapter({ flakyLike = 0 } = {}) {
  const db = { users: [], posts: [], likes: 0, comments: 0, messages: 0, joins: 0, locations: 0 };
  let likeCalls = 0;
  return {
    db,
    name: "in-memory",
    async createUser({ name }) {
      const u = { id: `u${db.users.length}`, name };
      db.users.push(u);
      return u;
    },
    async setProfile() {},
    async reportLocation() {
      db.locations += 1;
    },
    async post(u, t) {
      const p = { id: `p${db.posts.length}`, userId: u.id, t };
      db.posts.push(p);
      return p.id;
    },
    async recentPostsByOthers(u) {
      return db.posts.filter((p) => p.userId !== u.id);
    },
    async like() {
      likeCalls += 1;
      // Deterministic flakiness — every Nth call fails, so the assertion below
      // is not a coin flip.
      if (flakyLike && likeCalls % flakyLike === 0) {
        throw new Error(`row 4821 violates policy "post_likes_insert"`);
      }
      db.likes += 1;
    },
    async comment() {
      db.comments += 1;
    },
    async openConversation() {
      return "c1";
    },
    async sendMessage() {
      db.messages += 1;
    },
    async listGroups() {
      return [{ id: "g1" }, { id: "g2" }];
    },
    async joinGroup() {
      db.joins += 1;
    },
    async deleteUser(u) {
      db.users = db.users.filter((x) => x.id !== u.id);
    },
  };
}

const config = {
  app: "Self Test",
  adapter: "./in-memory",
  environment: "test",
  population: { agents: 5, cities: ["manila", "mumbai"], minutes: 1, tickSeconds: 5 },
  _dir: process.cwd(),
};

console.log("\n  populace self-test\n");

// --- 1. error grouping ----------------------------------------------------
check("errors group by shape, not by exact text", () => {
  const a = normaliseError(new Error("row 4821 violates policy 3f2a1b9c-1111-2222-3333-444455556666"));
  const b = normaliseError(new Error("row 9134 violates policy 8e7d6c5b-9999-8888-7777-666655554444"));
  assert.equal(a, b, "two instances of the same bug should collapse into one line");
});

// --- 2. a clean run -------------------------------------------------------
const clean = inMemoryAdapter();
const cleanMetrics = createMetrics();
const cleanWorld = new World({
  adapter: instrument(clean, cleanMetrics),
  personas: buildPersonas(5, ["manila", "mumbai"]),
});
await cleanWorld.populate({ staggerMs: 0 });
await cleanWorld.run({ minutes: 1, tickSeconds: 5, realtime: false });
const cleanTeardown = await cleanWorld.teardown();
cleanMetrics.endedAt = Date.now();
const cleanReport = buildReport({
  config,
  adapter: clean,
  world: cleanWorld,
  metrics: cleanMetrics,
  teardown: cleanTeardown,
  startedAt: Date.now() - 5000,
});

check("engine runs against an adapter that knows nothing about any real app", () => {
  assert.equal(cleanWorld.agents.length, 5);
  assert.ok(clean.db.locations > 0, "should have reported locations");
});

check("people behave differently from one another", () => {
  const distances = new Set(cleanWorld.agents.map((a) => a.distanceKm.toFixed(3)));
  assert.ok(distances.size > 1, "identical agents would find identical bugs");
});

check("cleanup removes every account it created", () => {
  assert.equal(clean.db.users.length, 0);
  assert.equal(cleanTeardown.failed.length, 0);
});

check("a clean run reports clean", () => {
  assert.equal(cleanReport.verdict.status, "clean", JSON.stringify(cleanReport.verdict.problems));
  assert.ok(cleanReport.api.calls > 0);
});

check("latency is measured per method", () => {
  const post = cleanReport.api.methods.find((m) => m.method === "post");
  assert.ok(post, "post should appear in the report");
  assert.ok(Number.isFinite(post.latencyMs.p95));
});

// --- 3. a run that breaks -------------------------------------------------
const flaky = inMemoryAdapter({ flakyLike: 3 });
const flakyMetrics = createMetrics();
const flakyWorld = new World({
  adapter: instrument(flaky, flakyMetrics),
  personas: buildPersonas(5, ["manila", "mumbai"]),
});
await flakyWorld.populate({ staggerMs: 0 });
await flakyWorld.run({ minutes: 1, tickSeconds: 5, realtime: false });
flakyMetrics.endedAt = Date.now();
const flakyReport = buildReport({
  config,
  adapter: flaky,
  world: flakyWorld,
  metrics: flakyMetrics,
  teardown: await flakyWorld.teardown(),
  startedAt: Date.now() - 5000,
});

check("a broken endpoint is caught and named", () => {
  const like = flakyReport.api.methods.find((m) => m.method === "like");
  assert.ok(like && like.failures > 0, "the flaky method should have recorded failures");
  assert.ok(like.errors[0].message.includes("violates policy"));
  assert.equal(flakyReport.verdict.status, "problems-found");
  assert.ok(flakyReport.verdict.failingMethods.some((m) => m.method === "like"));
});

check("one person's broken app does not end everyone else's run", () => {
  assert.equal(flakyWorld.agents.length, 5, "all agents should have survived the failures");
  assert.ok(flaky.db.posts.length > 0, "unrelated actions should have continued");
});

// --- 4. partial adapters --------------------------------------------------
const partial = {
  name: "read-only",
  createUser: async () => ({ id: "x" }),
  deleteUser: async (u) => {
    await Promise.resolve(u);
  },
};
check("a partial adapter is honestly reported as partial coverage", () => {
  const cov = coverageOf(partial);
  assert.equal(cov.implemented.length, 2);
  assert.ok(cov.missing.some((m) => m.method === "sendMessage"));
});

// A method that exists but does nothing is not coverage. Without this, a
// freshly scaffolded adapter reports 12/12 and runs "clean" while testing
// nothing at all — confidence manufactured out of empty functions.
check("empty and not-implemented stubs do NOT count as coverage", () => {
  assert.equal(isStub(async () => {}), true, "empty body");
  assert.equal(isStub(async function () {}), true, "empty function");
  assert.equal(isStub(async () => { /* return postId */ }), true, "comment-only body");
  assert.equal(
    isStub(async () => {
      throw new Error("createUser not implemented");
    }),
    true,
    "explicit not-implemented throw",
  );
  assert.equal(isStub(async () => ({ id: "x" })), false, "concise arrow returning a value");
  assert.equal(
    isStub(async (u) => {
      await u.client.rpc("delete_own_account");
    }),
    false,
    "real work",
  );
});

check("skipped methods are listed with what they would have tested", () => {
  const r = buildReport({
    config,
    adapter: partial,
    world: cleanWorld,
    metrics: cleanMetrics,
    teardown: cleanTeardown,
    startedAt: Date.now(),
  });
  const skipped = r.coverage.notTested.find((c) => c.method === "reportLocation");
  assert.ok(skipped?.wouldHaveTested.length > 10, "a gap should say what it costs you");
});

// --- 4b. cleanup that does not write to the customer's database -----------
// clean reaches an account through createUser, which SIGNS UP when the identity
// is absent. On an already-clean environment that creates every simulated
// identity just to delete it again — writing to someone else's auth table to
// prove the table is empty — and makes the per-account result useless as
// evidence of what was actually stranded. `signIn` is the read-only path.

function appWithSignIn({ existing = [] } = {}) {
  const db = { users: [...existing], signUps: 0, signIns: 0, deleted: [] };
  return {
    db,
    name: "with-signin",
    async createUser({ name, phone }) {
      db.signUps += 1;
      const found = db.users.find((u) => u.phone === phone);
      if (found) return found;
      const u = { id: `u${db.users.length}`, name, phone };
      db.users.push(u);
      return u;
    },
    async signIn({ phone }) {
      db.signIns += 1;
      return db.users.find((u) => u.phone === phone) || null;
    },
    async deleteUser(user) {
      db.deleted.push(user.phone);
      db.users = db.users.filter((u) => u.phone !== user.phone);
    },
  };
}

function appWithoutSignIn() {
  const db = { users: [], signUps: 0, deleted: [] };
  return {
    db,
    name: "no-signin",
    async createUser({ name, phone }) {
      db.signUps += 1;
      const found = db.users.find((u) => u.phone === phone);
      if (found) return found;
      const u = { id: `u${db.users.length}`, name, phone };
      db.users.push(u);
      return u;
    },
    async deleteUser(user) {
      db.deleted.push(user.phone);
      db.users = db.users.filter((u) => u.phone !== user.phone);
    },
  };
}

const cleanupPersona = buildPersonas(1, ["manila"])[0];
const phoneOfAgent0 = new Agent(cleanupPersona, appWithoutSignIn(), 0, {}).phone;

check("signIn is a capability, not a fourteenth contract method", () => {
  const withIt = coverageOf(appWithSignIn());
  const withoutIt = coverageOf(appWithoutSignIn());
  assert.equal(
    withIt.label,
    withoutIt.label,
    "implementing signIn must not change the coverage denominator",
  );
  assert.ok(
    !CONTRACT_METHODS.includes("signIn"),
    "signIn must stay out of the simulation contract",
  );
  assert.ok(canSignInOnly(appWithSignIn()), "should be detected when present");
  assert.ok(!canSignInOnly(appWithoutSignIn()), "should be absent when not implemented");
  assert.ok(!canSignInOnly({ signIn: () => {} }), "an empty stub is not a capability");
});

check("with signIn, checking an absent identity creates nothing", async () => {
  const app = appWithSignIn();
  const agent = new Agent(cleanupPersona, app, 0, {});
  const found = await agent.findAccount();
  assert.equal(found, null, "should report definitively absent");
  assert.equal(app.db.signUps, 0, "must not sign anybody up while looking");
  assert.equal(app.db.users.length, 0, "must not leave a row behind");
});

check("with signIn, a stranded identity is found and removed", async () => {
  const app = appWithSignIn({
    existing: [{ id: "u0", name: "left over", phone: phoneOfAgent0 }],
  });
  const agent = new Agent(cleanupPersona, app, 0, {});
  const found = await agent.findAccount();
  assert.ok(found, "should find the account that is really there");
  await agent.selfDestruct();
  assert.deepEqual(app.db.deleted, [phoneOfAgent0], "should delete exactly that account");
  assert.equal(app.db.signUps, 0, "still no sign-ups");
});

check("without signIn, the answer is 'cannot tell' rather than 'absent'", async () => {
  const app = appWithoutSignIn();
  const agent = new Agent(cleanupPersona, app, 0, {});
  const answer = await agent.findAccount();
  assert.equal(answer, undefined, "undefined means unknown — never conflate it with null");
  assert.equal(app.db.signUps, 0, "asking must not create anything either");
});

// --- 5. session expiry ----------------------------------------------------
// Tokens expire. Without a refresh, every agent starts failing at once and the
// run reports a catastrophe that belongs to us, not to the customer's app —
// and cannot even delete its own accounts afterwards, stranding invented
// people in someone else's environment.
function expiringApp({ supportsRefresh, ttlMs = 120 }) {
  const sessions = new Map();
  const live = (user) => {
    if (!(sessions.get(user.id) > Date.now())) throw new Error("JWT expired");
  };
  const app = {
    name: "expiring",
    refreshes: 0,
    async createUser({ phone }) {
      const id = `u_${phone}`;
      sessions.set(id, Date.now() + ttlMs);
      return { id };
    },
    async reportLocation(u) {
      live(u);
    },
    async deleteUser(u) {
      live(u);
      sessions.delete(u.id);
    },
  };
  if (supportsRefresh) {
    app.refreshSession = async (u) => {
      if (!sessions.has(u.id)) throw new Error("no session");
      app.refreshes += 1;
      sessions.set(u.id, Date.now() + ttlMs);
    };
  }
  return app;
}

async function runExpiring(supportsRefresh) {
  const app = expiringApp({ supportsRefresh });
  const metrics = createMetrics();
  const world = new World({
    adapter: instrument(app, metrics),
    personas: buildPersonas(3, ["manila"]),
    options: { refreshEveryMs: 40 },
  });
  await world.populate({ staggerMs: 0 });
  await world.run({ minutes: 0.02, tickSeconds: 0.06, realtime: true });
  const teardown = await world.teardown();
  metrics.endedAt = Date.now();
  return { app, api: summarise(metrics), teardown };
}

const expired = await runExpiring(false);
const refreshed = await runExpiring(true);

check("without refresh, an expired session poisons the whole run", () => {
  assert.ok(expired.api.failures > 0, "the unrefreshed run should have failed");
  assert.ok(
    expired.api.methods.some((m) => m.errors.some((e) => /expired/i.test(e.message))),
    "and should say why",
  );
});

check("refreshSession keeps a run alive past token expiry", () => {
  assert.ok(refreshed.app.refreshes > 0, "refreshSession should have been called");
  assert.equal(refreshed.api.failures, 0, "no call should have failed");
});

check("an expired run cannot even clean up after itself", () => {
  assert.ok(expired.teardown.failed.length > 0, "stranded accounts are the real damage");
  assert.equal(refreshed.teardown.failed.length, 0);
  assert.equal(refreshed.teardown.removed, 3);
});

// A refresh token can itself be revoked or expire. Signing in again from
// scratch is the last line of defence before an agent goes quietly dead.
const revoked = expiringApp({ supportsRefresh: true });
revoked.refreshSession = async () => {
  throw new Error("refresh token revoked");
};
const reauthAgent = new Agent(buildPersonas(1, ["manila"])[0], revoked, 0, { refreshEveryMs: 0 });
await reauthAgent.ensureAccount();
await reauthAgent.ensureFreshSession();

check("a dead refresh token falls back to full re-authentication", () => {
  assert.equal(reauthAgent.stats.reauths, 1, "should have signed in again");
  assert.ok(reauthAgent.log.includes("re-authenticated"));
});

// --- 6. no tolerance band -------------------------------------------------
// Found by a real user run: 1 failure in 114 calls is 0.88%, which slipped
// under an old 1%-tolerance and was reported as "No failures" while the table
// right below it showed the failure — and the process exited 0.
// Built directly, because reproducing 114 calls through a live run is slow and
// the thing under test is the verdict logic, not the engine.
{
  const metrics = createMetrics();
  const app = instrument(
    {
      name: "rare",
      async ok() {},
      async bad() {
        throw new Error('new row violates row-level security policy "post_likes_insert"');
      },
    },
    metrics,
  );
  for (let i = 0; i < 113; i++) await app.ok();
  try {
    await app.bad();
  } catch {
    /* expected */
  }
  metrics.endedAt = Date.now();

  const rare = buildReport({
    config,
    adapter: clean,
    world: cleanWorld,
    metrics,
    teardown: cleanTeardown,
    startedAt: Date.now() - 1000,
  });

  check("0.88% failure rate is still a problem, not 'clean'", () => {
    assert.equal(rare.api.calls, 114);
    assert.equal(rare.api.failures, 1);
    assert.equal(rare.verdict.status, "problems-found", "a real failure must fail the run");
    assert.ok(rare.verdict.problems[0].includes("1 of 114"));
  });

  check("the verdict line can never contradict the table beneath it", () => {
    const text = renderReport(rare);
    assert.ok(!text.includes("No failures"), "must not claim 'No failures' when one failed");
    assert.ok(text.includes("✖"), "must show the failure");
  });
}

// --- 7. the report renders ------------------------------------------------
check("the report renders without throwing", () => {
  const text = renderReport(flakyReport);
  assert.ok(text.includes("POPULACE REPORT"));
  assert.ok(text.includes("✖"), "problems should be visible at a glance");
});

// --- 8. a bug in Populace is never reported as the customer's --------------
{
  const adapter = inMemoryAdapter();
  const world = new World({
    adapter: instrument(adapter, createMetrics()),
    personas: buildPersonas(2, ["manila"]),
    options: {},
    on: {},
  });
  await world.populate({ staggerMs: 0 });

  // Break the engine, not the adapter: this failure never reaches a wrapped
  // call, so nothing in the metrics will ever know about it.
  world.agents[0].post = () => {
    throw new TypeError("engine bug: cannot read properties of undefined");
  };
  world.agents[0].persona.postiness = 1;
  world.agents[0].persona.breakiness = 0;
  await world.agents[0].tick(5, world);

  check("a bug inside Populace is kept, not swallowed", () => {
    const engineErrors = world.engineErrors();
    assert.equal(engineErrors.length, 1);
    assert.ok(engineErrors[0].includes("engine bug"));
  });

  const report = buildReport({
    config: { app: "x", adapter: "y", environment: "test", population: {} },
    adapter,
    world,
    metrics: createMetrics(),
    teardown: { failed: [] },
    startedAt: Date.now() - 1000,
  });

  check("a run that broke internally is never reported clean", () => {
    assert.equal(report.verdict.status, "problems-found");
    assert.ok(report.verdict.problems.some((p) => p.includes("inside Populace")));
  });
}

// Async checks must settle before the total is printed. Exiting synchronously
// would report "all passed" while an async assertion was still in flight — a
// test suite lying about its own result, in a product whose entire argument is
// that a report must never claim more than it has earned.
await Promise.all(pending);

console.log(
  failed
    ? `\n  ${failed} check(s) failed.\n`
    : `\n  All checks passed — the engine is app-agnostic and the report is honest.\n`,
);
process.exit(failed ? 1 : 0);
