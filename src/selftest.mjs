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
import { execFile } from "node:child_process";
import { World } from "./engine/world.mjs";
import { Agent } from "./engine/agent.mjs";
import { buildPersonas } from "./engine/personas.mjs";
import { CircuitBreaker, isTransportError } from "./net.mjs";
import {
  createMetrics,
  DEFAULT_TIMEOUT_MS,
  instrument,
  normaliseError,
  summarise,
} from "./instrument.mjs";
import { buildReport, renderReport } from "./report.mjs";
import { canSignInOnly, CONTRACT_METHODS, coverageOf, isStub } from "./contract.mjs";
import { diagnose } from "./diagnose.mjs";

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

// --- 4c. what `doctor` decides -------------------------------------------
// doctor is the one thing standing between a customer and a run that proves
// nothing. Its judgement now lives in diagnose(), so it can be tested without
// spawning a process and matching strings.

// Every method here needs a real body: an empty one is deliberately not
// counted as coverage, so `async deleteUser() {}` would read as missing and
// this fixture would block on its own required method rather than on the
// condition under test.
const fullApp = () => ({
  name: "full",
  async createUser() { return { id: "u" }; },
  async deleteUser(u) { return u?.id ?? null; },
  async signIn() { return null; },
});
const noDelete = () => ({ name: "partial", async createUser() { return { id: "u" }; } });
const cfg = { neverRunAgainst: ["https://prod.example"], _file: "x", environment: "test" };

check("doctor is ready only when nothing blocks it", () => {
  const d = diagnose({ config: cfg, adapter: fullApp(), reachable: true });
  assert.equal(d.ready, true);
  assert.deepEqual(d.blockers, []);
  assert.equal(d.guarded, 1, "should count the denied production hosts");
});

check("doctor blocks when a REQUIRED method is missing", () => {
  const d = diagnose({ config: cfg, adapter: noDelete(), reachable: true });
  assert.equal(d.ready, false);
  assert.ok(
    d.blockers.some((b) => b.includes("deleteUser")),
    "must name the missing requirement, not just refuse",
  );
});

check("doctor blocks when the target cannot be reached", () => {
  const d = diagnose({ config: cfg, adapter: fullApp(), reachable: false });
  assert.equal(d.ready, false);
  assert.ok(d.blockers.some((b) => b.includes("unreachable")));
});

check("doctor reports both blockers when both apply", () => {
  const d = diagnose({ config: cfg, adapter: noDelete(), reachable: false });
  assert.equal(d.blockers.length, 2, "fixing one must not hide the other");
});

check("doctor does not invent a reachability verdict it never checked", () => {
  const d = diagnose({ config: cfg, adapter: fullApp(), reachable: null });
  assert.equal(d.ready, true, "no healthCheck is not the same as unreachable");
  assert.deepEqual(d.blockers, []);
});

check("doctor names the cleanup mode", () => {
  assert.equal(diagnose({ config: cfg, adapter: fullApp(), reachable: true }).cleanup, "read-only");
  assert.equal(
    diagnose({ config: cfg, adapter: noDelete(), reachable: true }).cleanup,
    "create-then-delete",
  );
});

// --- 4d. teardown must not claim removals it did not make ------------------
// selfDestruct() does nothing when there is no account and no deleteUser, and
// teardown counted both as successes — so a run could print "Cleanup complete
// — 6 accounts removed" having deleted none of them.

async function tornDown({ deletable, withUser }) {
  const deleted = [];
  const app = {
    name: "t",
    async createUser() { return { id: "u" }; },
    ...(deletable ? { async deleteUser(u) { deleted.push(u.id); } } : {}),
  };
  const personas = buildPersonas(2, ["manila"]);
  const world = new World({ adapter: app, personas, identity: {}, hooks: {} });
  world.agents = personas.map((p, i) => {
    const a = new Agent(p, app, i, {});
    a.user = withUser ? { id: `u${i}` } : null;
    return a;
  });
  return { result: await world.teardown(), deleted };
}

check("teardown counts only the accounts it actually deleted", async () => {
  const { result, deleted } = await tornDown({ deletable: true, withUser: true });
  assert.equal(result.removed, 2);
  assert.equal(deleted.length, 2, "and really called deleteUser for each");
  assert.equal(result.notDeleted.length, 0);
  assert.equal(result.failed.length, 0);
});

check("teardown does not report a removal when there was no account", async () => {
  const { result, deleted } = await tornDown({ deletable: true, withUser: false });
  assert.equal(result.removed, 0, "claiming these were removed is the bug this covers");
  assert.equal(deleted.length, 0, "nothing was deleted");
  assert.equal(result.notDeleted.length, 2);
  assert.ok(result.notDeleted[0].why.length > 0, "and says why for each");
});

check("teardown does not report a removal when the adapter cannot delete", async () => {
  const { result } = await tornDown({ deletable: false, withUser: true });
  assert.equal(result.removed, 0);
  assert.equal(result.notDeleted.length, 2);
  assert.ok(result.notDeleted[0].why.includes("deleteUser"));
});

check("a cleanup that removed nothing is never rendered as complete", async () => {
  const { result } = await tornDown({ deletable: true, withUser: false });
  const text = renderReport({ ...cleanReport, cleanup: result });
  assert.ok(!/Cleanup complete/.test(text), "must not say complete");
  assert.ok(/Cleanup partial/.test(text), "must say what actually happened");
});

// --- 4e. a call that never returns must not hang the run -------------------
// A real run froze at tick 24/60 on one dead socket and produced no report at
// all. The customer's API was not at fault and nothing was logged — the worst
// kind of failure, because it looks like nothing. Every adapter call now has a
// deadline.

const never = () => new Promise(() => {});

function timed(adapterFns, timeoutMs) {
  const metrics = createMetrics();
  return { metrics, app: instrument({ name: "t", ...adapterFns }, metrics, { timeoutMs }) };
}

check("a hung adapter call rejects instead of hanging forever", async () => {
  const { app } = timed({ async post() { return never(); } }, 40);
  const started = Date.now();
  await assert.rejects(() => app.post(), /timed out after 40ms/);
  assert.ok(Date.now() - started < 2000, "must give up at the deadline, not wait");
});

check("a timeout is recorded as a failure, not silently swallowed", async () => {
  const { metrics, app } = timed({ async post() { return never(); } }, 40);
  await app.post().catch(() => {});
  const post = summarise(metrics).methods.find((m) => m.method === "post");
  assert.equal(post.calls, 1);
  assert.equal(post.failures, 1, "a run that gets no answer has failed, and must say so");
  assert.ok(post.errors[0].message.includes("timed out"), "and the report must name why");
});

check("a timeout is attributed to the adapter, not to Populace", async () => {
  // If this leaks as an untagged error the agent loop treats it as OUR bug and
  // aborts the run — turning a slow customer endpoint into a crash.
  const { app } = timed({ async post() { return never(); } }, 40);
  const err = await app.post().catch((e) => e);
  assert.equal(err.fromAdapter, true);
  assert.equal(err.isTimeout, true);
});

check("one hung method does not stop the others from working", async () => {
  const { app } = timed(
    { async post() { return never(); }, async like() { return "ok"; } },
    40,
  );
  const [slow, fast] = await Promise.allSettled([app.post(), app.like()]);
  assert.equal(slow.status, "rejected");
  assert.equal(fast.status, "fulfilled", "the run must carry on around a dead endpoint");
  assert.equal(fast.value, "ok");
});

check("calls that finish in time are untouched by the deadline", async () => {
  const { metrics, app } = timed({ async post() { return "fine"; } }, 5000);
  assert.equal(await app.post(), "fine");
  assert.equal(summarise(metrics).methods.find((m) => m.method === "post").failures, 0);
});

check("a real rejection still reports its own message, not a timeout", async () => {
  const { app } = timed({ async post() { throw new Error("row-level security"); } }, 5000);
  await assert.rejects(() => app.post(), /row-level security/);
});

check("a late rejection after the deadline does not crash the process", async () => {
  // Nothing awaits the original promise once we have raced past it, so an
  // unhandled rejection here would take down the whole run.
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on("unhandledRejection", onUnhandled);
  const { app } = timed(
    { async post() { await new Promise((r) => setTimeout(r, 30)); throw new Error("late"); } },
    10,
  );
  await app.post().catch(() => {});
  await new Promise((r) => setTimeout(r, 120));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, null, "a late failure must not become an unhandled rejection");
});

check("the deadline can be switched off for legitimately long work", async () => {
  const { app } = timed({ async post() { await new Promise((r) => setTimeout(r, 60)); return "done"; } }, 0);
  assert.equal(await app.post(), "done");
});

check("instrument applies a default deadline when none is given", async () => {
  assert.ok(DEFAULT_TIMEOUT_MS > 0, "there must be a default, or hangs come straight back");
  const metrics = createMetrics();
  const app = instrument({ name: "t", async post() { return "ok"; } }, metrics);
  assert.equal(await app.post(), "ok");
});

check("a fast call leaves no timer holding the process open", async () => {
  // An uncleared timer per call would make `populace run` hang on exit for the
  // full deadline after the simulation had already finished.
  //
  // This has to run in its OWN process. Checking getActiveResourcesInfo() here
  // would see the deliberately-hung deadlines from the checks running alongside
  // it and fail for a reason that has nothing to do with the code under test —
  // which is exactly what the first version of this test did.
  const here = new URL("./instrument.mjs", import.meta.url).href;
  const script = `
    import { createMetrics, instrument } from ${JSON.stringify(here)};
    const app = instrument({ name: "t", async post() { return "ok"; } }, createMetrics(), {
      timeoutMs: 60_000,
    });
    await app.post();
  `;
  const started = Date.now();
  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      { timeout: 20_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 10_000, `process took ${elapsed}ms to exit; a 60s timer was left armed`);
});

// Reuses the clean run's world and teardown; only the metrics vary per case.
const inconclusiveShape = {
  config,
  adapter: clean,
  world: cleanWorld,
  teardown: cleanTeardown,
  startedAt: Date.now() - 5000,
};

// --- 4f. a bad link must not be reported as a bad API ----------------------
// The most damaging thing this tool could do is blame a customer's code for a
// dropped socket. Cry wolf once and the team stops reading the real findings.
// The mirror danger is retrying a genuine 500 until it passes, which turns
// their bug into a green tick. Both are tested here.

function flakyCall({ failFirst, error, method = "post" }) {
  let n = 0;
  const metrics = createMetrics();
  const app = instrument(
    {
      name: "f",
      async [method]() {
        n += 1;
        if (n <= failFirst) throw error();
        return "ok";
      },
    },
    metrics,
    { timeoutMs: 2000, retries: 3 },
  );
  return { app, metrics, attempts: () => n };
}

const dropped = () => Object.assign(new TypeError("fetch failed"), {
  cause: { code: "ECONNRESET" },
});

check("isTransportError knows a dead socket from a rejected request", () => {
  assert.equal(isTransportError(dropped()), true);
  assert.equal(isTransportError(new Error("ENOTFOUND")), true);
  assert.equal(isTransportError({ isTimeout: true }), true);
  // Anything the server actually answered is the application's.
  assert.equal(isTransportError(new Error("permission denied for table posts")), false);
  assert.equal(isTransportError(new Error("500 Internal Server Error")), false);
  assert.equal(isTransportError(null), false);
});

check("a dropped connection is retried and the call still succeeds", async () => {
  const { app, attempts } = flakyCall({ failFirst: 2, error: dropped });
  assert.equal(await app.post(), "ok");
  assert.equal(attempts(), 3, "should have retried twice then succeeded");
});

check("retries are counted in the report, never hidden", async () => {
  const { app, metrics } = flakyCall({ failFirst: 2, error: dropped });
  await app.post();
  const s = summarise(metrics);
  assert.equal(s.retries, 2, "a call that only worked on its third try must say so");
  assert.equal(s.failures, 0, "but it did ultimately succeed");
  assert.equal(s.network.healthy, false);
});

check("an error the API actually returned is NEVER retried", async () => {
  // Retrying this would turn a real bug into a passing run — the single worst
  // thing a correctness tool can do.
  const { app, attempts, metrics } = flakyCall({
    failFirst: 99,
    error: () => new Error("permission denied for table posts"),
  });
  await assert.rejects(() => app.post(), /permission denied/);
  assert.equal(attempts(), 1, "exactly one attempt for an application error");
  assert.equal(summarise(metrics).apiFailures, 1);
  assert.equal(summarise(metrics).transportFailures, 0);
});

check("a link that never recovers is reported as transport, not as their bug", async () => {
  const { app, attempts, metrics } = flakyCall({ failFirst: 99, error: dropped });
  await assert.rejects(() => app.post());
  assert.equal(attempts(), 4, "initial attempt plus three retries");
  const s = summarise(metrics);
  assert.equal(s.transportFailures, 1);
  assert.equal(s.apiFailures, 0, "their code was never even reached");
});

check("latency excludes the failed attempts before a success", async () => {
  // Folding retry time into latency is how p50/p95 become unpublishable.
  const metrics = createMetrics();
  let n = 0;
  const app = instrument(
    {
      name: "f",
      async post() {
        n += 1;
        if (n === 1) { await new Promise((r) => setTimeout(r, 120)); throw dropped(); }
        return "ok";
      },
    },
    metrics,
    { timeoutMs: 2000, retries: 3 },
  );
  await app.post();
  const p50 = summarise(metrics).methods[0].latencyMs.p50;
  assert.ok(p50 < 100, `p50 was ${p50}ms — the failed 120ms attempt leaked into it`);
});

check("a run with only network trouble is inconclusive, not clean and not their fault", () => {
  const report = buildReport({
    ...inconclusiveShape,
    metrics: (() => {
      const m = createMetrics();
      const b = { method: "post", calls: 2, failures: 1, apiFailures: 0, transportFailures: 1,
                  retries: 3, durations: [10, 20], errors: new Map([["fetch failed", 1]]),
                  firstErrorAt: Date.now() };
      m.methods.set("post", b);
      return m;
    })(),
  });
  assert.equal(report.verdict.status, "inconclusive", "must not claim clean");
  assert.equal(report.verdict.apiFailures, 0);
  const text = renderReport(report);
  assert.ok(/Inconclusive/.test(text));
  assert.ok(/not your code|not your code\./i.test(text) || /network between/i.test(text),
    "must say plainly that this was the network");
  assert.ok(/CONNECTION/.test(text), "and show the connection quality");
});

check("a real API failure is still 'problems-found' even on a bad link", () => {
  const report = buildReport({
    ...inconclusiveShape,
    metrics: (() => {
      const m = createMetrics();
      m.methods.set("post", { method: "post", calls: 4, failures: 2, apiFailures: 1,
        transportFailures: 1, retries: 5, durations: [10, 20, 30, 40],
        errors: new Map([["permission denied", 1], ["fetch failed", 1]]), firstErrorAt: Date.now() });
      return m;
    })(),
  });
  assert.equal(report.verdict.status, "problems-found", "their bug must not be downgraded by noise");
  const text = renderReport(report);
  assert.ok(/Problems found/.test(text));
});

// --- 4g. giving up on a target that is simply gone -------------------------
// Retries fixed the flaky case and made the DEAD case worse: every call then
// cost the full deadline times every attempt. Observed on a real run — it
// stopped hanging and started grinding, 12 minutes without completing a tick.
// So a sustained outage has to end the run quickly instead.

const alwaysDown = () => {
  const metrics = createMetrics();
  let n = 0;
  const app = instrument(
    { name: "d", async post() { n += 1; throw dropped(); } },
    metrics,
    { timeoutMs: 50, retries: 3, giveUpAfter: 4 },
  );
  return { app, metrics, attempts: () => n };
};

check("the breaker opens after a run of unreachable calls", async () => {
  const { app, metrics } = alwaysDown();
  for (let i = 0; i < 6; i++) await app.post().catch(() => {});
  assert.equal(metrics.breaker.open, true);
  assert.equal(summarise(metrics).network.gaveUp, true);
});

check("once open, calls fail instantly instead of burning the deadline", async () => {
  const { app, metrics } = alwaysDown();
  while (!metrics.breaker.open) await app.post().catch(() => {});
  const started = Date.now();
  await app.post().catch(() => {});
  assert.ok(Date.now() - started < 40, "an open breaker must not wait or retry");
});

check("a single success closes the breaker again", async () => {
  // A blip in the middle of an otherwise fine run must not abort that run.
  const breaker = new CircuitBreaker({ threshold: 3 });
  breaker.recordTransportFailure();
  breaker.recordTransportFailure();
  breaker.recordSuccess();
  breaker.recordTransportFailure();
  breaker.recordTransportFailure();
  assert.equal(breaker.open, false, "non-consecutive failures must not trip it");
  assert.equal(breaker.recordTransportFailure(), true, "three in a row should");
});

check("an error the API returned proves the link is alive and resets the breaker", async () => {
  // Otherwise a genuinely broken endpoint looks like a dead network and kills
  // the run that was about to find the bug.
  const metrics = createMetrics();
  const app = instrument(
    { name: "d", async post() { throw new Error("permission denied for table posts"); } },
    metrics,
    { timeoutMs: 50, retries: 3, giveUpAfter: 3 },
  );
  for (let i = 0; i < 8; i++) await app.post().catch(() => {});
  assert.equal(metrics.breaker.open, false, "their bug must not be mistaken for an outage");
  assert.equal(summarise(metrics).apiFailures, 8);
});

check("giveUpAfter: 0 disables the breaker", async () => {
  const metrics = createMetrics();
  const app = instrument(
    { name: "d", async post() { throw dropped(); } },
    metrics,
    { timeoutMs: 30, retries: 0, giveUpAfter: 0 },
  );
  for (let i = 0; i < 10; i++) await app.post().catch(() => {});
  assert.equal(metrics.breaker.open, false);
});

check("a run cut short says so, and is never called clean", () => {
  const m = createMetrics();
  m.breaker = { open: true, openedAfter: 12 };
  m.methods.set("post", { method: "post", calls: 5, failures: 5, apiFailures: 0,
    transportFailures: 5, retries: 9, durations: [1, 1, 1, 1, 1],
    errors: new Map([["Target became unreachable", 5]]), firstErrorAt: Date.now() });
  const report = buildReport({ ...inconclusiveShape, metrics: m });
  assert.notEqual(report.verdict.status, "clean");
  assert.ok(
    report.verdict.problems.some((p) => /stopped early/i.test(p)),
    "the report must admit it covers less than it was asked to",
  );
  assert.ok(/incomplete/i.test(renderReport(report)));
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
