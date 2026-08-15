/**
 * `populace smoke` — prove an adapter works before spending five minutes on it.
 *
 * Written for the person who has just implemented the contract against an API
 * we have never seen. A full run takes minutes and reports on THEIR app; this
 * takes seconds and reports on THEIR ADAPTER, which is a different question and
 * the one they actually have at that moment.
 *
 * It creates ONE user, calls each implemented method once, checks what came
 * back against what the contract promises, and deletes the user again. The
 * checks are deliberately about shape and behaviour, not about the customer's
 * business rules — an adapter that returns undefined where an id was promised
 * is broken no matter whose app is behind it.
 *
 * Nothing here is a substitute for `run`. A smoke test that passes means the
 * wiring is right, not that the app is correct.
 */

import { CONTRACT, isStub } from "./contract.mjs";

/** One persona, kept identical between smoke runs so it is easy to clean up. */
export function smokePersona(prefix = "0900", n = 1) {
  return {
    name: n === 1 ? "Populace Smoke" : `Populace Smoke ${n}`,
    phone: `${prefix}00000${n}`,
    password: "SimDriver!2026",
    city: { name: "Manila", lat: 14.5995, lng: 120.9842 },
    platform: "grab",
    rate: 10,
    vehicle: "motorcycle",
  };
}

/**
 * Checks that run against whatever the adapter returned.
 *
 * Each returns a string when something is wrong, or null when it is fine. They
 * are phrased as instructions rather than complaints: someone reading this has
 * a half-written adapter and wants to know what to change.
 */
const EXPECTATIONS = {
  createUser: (value) =>
    !value || typeof value !== "object"
      ? "createUser must return the user object your other methods will receive. Return whatever you need — an id, a client, a token — but return something."
      : value.id === undefined
        ? "createUser returned an object with no `id`. Populace uses it to tell your simulated people apart in the report."
        : null,

  post: (value) =>
    value === undefined
      ? "post returned undefined. Return the new post's id, or `like` and `comment` will have nothing to act on."
      : null,

  recentPostsByOthers: (value) =>
    !Array.isArray(value)
      ? "recentPostsByOthers must return an array (empty is fine). It is the call that catches a feed leaking other people's rows."
      : null,

  openConversation: (value) =>
    value === undefined
      ? "openConversation returned undefined. Return the conversation id so sendMessage can use it."
      : null,

  listGroups: (value) =>
    !Array.isArray(value)
      ? "listGroups must return an array (empty is fine)."
      : null,

  inbox: (value) =>
    !Array.isArray(value)
      ? "inbox must return an array (empty is fine)."
      : null,
};

/**
 * Exercise every implemented method once.
 *
 * `call` is injected so this stays pure enough to test: the CLI passes a real
 * instrumented adapter, the self-test passes a fake.
 */
export async function smoke({ adapter, persona = smokePersona(), onStep = () => {} }) {
  const results = [];
  const record = (method, status, detail = "") => {
    results.push({ method, status, detail });
    onStep({ method, status, detail });
  };

  const implemented = (name) =>
    typeof adapter[name] === "function" && !isStub(adapter[name]);

  // Nothing can be attempted without an identity, so this failure is fatal
  // rather than one line in a list.
  if (!implemented("createUser")) {
    record("createUser", "fail", "not implemented — it is the one method every adapter must have");
    return { results, user: null, fatal: true };
  }

  let user;
  try {
    user = await adapter.createUser(persona);
    const problem = EXPECTATIONS.createUser(user);
    record("createUser", problem ? "fail" : "ok", problem ?? "");
    if (problem) return { results, user: null, fatal: true };
  } catch (error) {
    record("createUser", "fail", error.message);
    return { results, user: null, fatal: true };
  }

  // A conversation needs two people. Opening one with yourself is not a
  // weaker version of the test — most backends refuse it outright, and Buzz
  // Buzz's start_direct_thread raises "Invalid direct thread" on me = p_other,
  // which is correct behaviour being reported as an adapter fault.
  //
  // So a counterpart is created when, and only when, the adapter implements
  // conversations. Any adapter without them pays nothing for this.
  let partner = null;
  if (implemented("openConversation")) {
    try {
      partner = await adapter.createUser(smokePersona(persona.phone.slice(0, 4), 2));
    } catch (error) {
      record("openConversation", "skip",
        `needs a second account and one could not be created: ${error.message}`);
    }
  }

  // Everything the persona might need, in an order where later calls can use
  // what earlier ones returned.
  let postId;
  let conversationId;

  for (const entry of CONTRACT) {
    const name = entry.method;
    if (name === "createUser" || name === "deleteUser") continue;   // handled separately
    if (!implemented(name)) {
      record(name, "skip", entry.exercises);
      continue;
    }

    try {
      let value;
      switch (name) {
        case "setProfile":       value = await adapter.setProfile(user, persona); break;
        case "refreshSession":   value = await adapter.refreshSession(user); break;
        case "reportLocation":
          value = await adapter.reportLocation(user, {
            lat: persona.city.lat, lng: persona.city.lng,
            distanceKm: 1.2, earnings: 12, platform: persona.platform,
          });
          break;
        case "post":             value = await adapter.post(user, "Populace smoke test"); postId = value; break;
        case "recentPostsByOthers": value = await adapter.recentPostsByOthers(user, 5); break;
        case "like":
          if (postId === undefined) { record(name, "skip", "no post id — `post` did not return one"); continue; }
          value = await adapter.like(user, postId);
          break;
        case "comment":
          if (postId === undefined) { record(name, "skip", "no post id — `post` did not return one"); continue; }
          value = await adapter.comment(user, postId, "smoke");
          break;
        case "openConversation":
          if (!partner) { record(name, "skip", "no second account"); continue; }
          // partner.id, not partner. The contract's second argument is an id,
          // and passing the whole user object put a live Supabase client into
          // an RPC body — supabase-js serialises that body, so the adapter died
          // with "Converting circular structure to JSON" and the report blamed
          // the adapter for a fault in this file.
          value = await adapter.openConversation(user, partner.id);
          conversationId = value;
          break;
        case "sendMessage":
          if (conversationId === undefined) { record(name, "skip", "no conversation id"); continue; }
          value = await adapter.sendMessage(user, conversationId, "smoke");
          break;
        case "inbox":            value = await adapter.inbox(user); break;
        case "listGroups":       value = await adapter.listGroups(user); break;
        case "joinGroup": {
          const groups = implemented("listGroups") ? await adapter.listGroups(user) : [];
          const first = Array.isArray(groups) && groups[0];
          if (!first) { record(name, "skip", "no group to join"); continue; }
          value = await adapter.joinGroup(user, first.id ?? first);
          break;
        }
        default:                 record(name, "skip", "not exercised by smoke"); continue;
      }

      const problem = EXPECTATIONS[name]?.(value);
      record(name, problem ? "fail" : "ok", problem ?? "");
    } catch (error) {
      record(name, "fail", error.message);
    }
  }

  // Always last, and always attempted — a smoke test that leaves an account
  // behind in someone else's project is a bad first impression.
  if (implemented("deleteUser")) {
    try {
      await adapter.deleteUser(user);
      // The counterpart is removed on the same pass. Leaving it behind would
      // be worse than never creating it.
      if (partner) await adapter.deleteUser(partner);
      record("deleteUser", "ok");
    } catch (error) {
      record("deleteUser", "fail", error.message);
    }
  } else {
    record("deleteUser", "skip",
      "not implemented — the smoke account stays behind. Run `populace clean` to remove it.");
  }

  return { results, user, fatal: false };
}

/** Render for a terminal. Failures first: they are why someone ran this. */
export function renderSmoke(results) {
  const L = [];
  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip");
  const ok = results.filter((r) => r.status === "ok");

  L.push("");
  if (failed.length) {
    L.push(`  ✖ ${failed.length} method(s) need attention:`);
    L.push("");
    for (const r of failed) {
      L.push(`      ${r.method}`);
      L.push(`        ${r.detail}`);
      L.push("");
    }
  } else {
    L.push(`  ✔ ${ok.length} method(s) answered correctly.`);
    L.push("");
  }

  if (ok.length && failed.length) L.push(`  Working: ${ok.map((r) => r.method).join(", ")}`);
  if (skipped.length) {
    L.push("");
    L.push(`  Not implemented — these will be skipped in a run, not tested:`);
    for (const r of skipped) L.push(`    · ${r.method.padEnd(21)} ${r.detail}`);
  }

  L.push("");
  L.push(
    failed.length
      ? "  Fix the above, then run `populace smoke` again. A full run is only worth"
      : "  Wiring looks right. Next:  populace run --agents 5 --minutes 3",
  );
  if (failed.length) L.push("  starting once these answer.");
  L.push("");
  return L.join("\n");
}
