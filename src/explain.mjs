// Turn an error message into what broke, why, and the fix.
//
// A report that says `duplicate key value violates unique constraint
// "post_likes_pkey"` has told you what happened and nothing about what to do.
// The five defects Populace found on its first run were all one mistake wearing
// different clothes, and it took a person to notice. This is that person,
// written down.
//
// Rules first, model second, and deliberately in that order. Most failures a
// simulated population provokes are a small set of recognisable shapes:
// permissions, foreign keys, expired sessions, provider quotas, sockets. A rule
// is instant, free, offline and auditable — you can read why it said what it
// said. The model is for the remainder, and gets the failures a rule could not
// name rather than all of them.
//
// The most important job here is the first question, not the last: was this
// even your application? A transport failure and a 500 look equally red in a
// terminal and mean completely different things.

/**
 * @typedef {object} Explanation
 * @property {"app"|"environment"|"harness"|"unknown"} blame  who has to fix it
 * @property {string} headline   one line: what happened
 * @property {string} why        the mechanism
 * @property {string} [fix]      what to change
 * @property {string} rule       which rule matched, so the reasoning is traceable
 */

/**
 * Ordered. The first match wins, so specific patterns precede general ones —
 * "upsert refused by RLS" has to be tested before plain "permission denied",
 * or the more useful explanation never fires.
 */
const RULES = [
  {
    rule: "rls-upsert",
    when: (t) => /42501|permission denied|row-level security/i.test(t) && /upsert|on conflict/i.test(t),
    blame: "app",
    headline: "An upsert was refused by a row-level-security policy.",
    why:
      "`INSERT … ON CONFLICT DO UPDATE` needs SELECT on every column it touches, not just " +
      "INSERT. If a privacy policy restricts reads on any one of those columns, the whole " +
      "statement is refused — and it fails silently for the owner, because their own row " +
      "already exists.",
    fix:
      "Insert plainly and treat the duplicate error as success, or widen the SELECT policy to " +
      "cover the columns the upsert writes. You cannot upsert a column you cannot select.",
  },
  {
    rule: "rls-denied",
    when: (t) => /42501|permission denied|row-level security|violates row-level/i.test(t),
    blame: "app",
    headline: "The database refused the write on permissions, not on data.",
    why:
      "A row-level-security policy rejected this call for the signed-in role. The request was " +
      "well formed; the policy did not allow it. This is invisible to whoever wrote the policy, " +
      "because their own account usually satisfies it.",
    fix:
      "Check the policy for this table against the role the app authenticates as, and confirm " +
      "there is a policy for this specific command — a table with only a SELECT policy refuses " +
      "every INSERT.",
  },
  {
    rule: "duplicate-key",
    when: (t) => /23505|duplicate key|already exists|unique constraint/i.test(t),
    blame: "app",
    headline: "The row already existed.",
    why:
      "A unique constraint rejected a second identical write. Usually this is not a bug at all: " +
      "liking a post twice, or joining a group you are already in, is a normal thing for a user " +
      "to do and the constraint is doing its job.",
    fix:
      "Decide whether this is idempotent. If it is, catch the duplicate code and return success " +
      "rather than surfacing an error the user cannot act on.",
  },
  {
    rule: "foreign-key",
    when: (t) => /23503|foreign key|violates foreign key constraint/i.test(t),
    blame: "app",
    headline: "This referenced a row that was never created.",
    why:
      "A foreign key pointed at something absent. In a simulated run the usual cause is an " +
      "earlier step that failed quietly: if profile creation is refused during signup, every " +
      "post and group-join afterwards dies on a key pointing at the row that was never written.",
    fix:
      "Look at what ran before this, not at this call. The first failure in the sequence is the " +
      "real one; this is its shadow.",
  },
  {
    rule: "schema-cache",
    when: (t) => /PGRST20[245]|schema cache|could not find the (table|column|function)/i.test(t),
    blame: "app",
    headline: "The table, column or function is not in the API's schema cache.",
    why:
      "PostgREST answers this both when an object genuinely does not exist and when it exists " +
      "with a different signature. A function called with the wrong argument names reports " +
      "exactly the same code as one that was never created.",
    fix:
      "Confirm the object exists, then confirm the call matches its signature. If a migration " +
      "was run recently, the schema cache may simply need reloading.",
  },
  {
    rule: "auth-expired",
    when: (t) => /jwt expired|token (is )?expired|invalid token|401/i.test(t),
    blame: "app",
    headline: "The session was rejected as expired or invalid.",
    why:
      "Access tokens are short-lived. A run longer than the token lifetime must refresh, or " +
      "every call after expiry fails — and the failures start abruptly partway through rather " +
      "than at the beginning, which makes them look like a load problem.",
    fix:
      "Implement `refreshSession` in the adapter and check the session lifetime against the run " +
      "length. Note when the failures began: at the token lifetime is the tell.",
  },
  {
    rule: "rate-limit",
    when: (t) => /rate limit|429|too many requests|quota/i.test(t),
    blame: "environment",
    headline: "A provider rate limit refused the call. This is not your code.",
    why:
      "The platform hosting the API applied its own throttle. Signup endpoints are the usual " +
      "one — most hosted auth services cap new accounts per hour, which caps how large a " +
      "simulated population can be regardless of what the app can handle.",
    fix:
      "Run a smaller population, spread signups further apart, or use a project without the " +
      "quota. It does not tell you anything about the app's capacity.",
  },
  {
    rule: "transport",
    when: (t) => /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR|socket hang up|network error/i.test(t),
    blame: "harness",
    headline: "The request never reached the server, so nothing about the app was tested.",
    why:
      "This failed at the socket layer on the machine running the test: no HTTP response, so no " +
      "status code. Common causes are the client exhausting ephemeral ports at high request " +
      "rates, a connection pool saturating, or a genuinely unreliable link.",
    fix:
      "Check the failure count against the request rate. A handful across a long run is noise; " +
      "a count that scales with the work means the client is the bottleneck, not the server.",
  },
  {
    rule: "unreachable",
    when: (t) => /became unreachable|consecutive calls failed at the network level/i.test(t),
    blame: "harness",
    headline: "The target stopped answering and the run gave up rather than hammering it.",
    why:
      "Enough consecutive calls failed at the network level that Populace stopped retrying. " +
      "That is the circuit breaker working: continuing would produce thousands of identical " +
      "failures and tell you nothing more than the first twelve did.",
    fix:
      "Confirm the target was up for the whole run. If it was, the link between this machine " +
      "and it is the suspect, not the app.",
  },
  {
    rule: "timeout",
    when: (t) => /timed out|ETIMEDOUT|timeout/i.test(t),
    blame: "unknown",
    headline: "The call was abandoned before the server answered.",
    why:
      "Either the endpoint is genuinely slow under this load, or the request never arrived and " +
      "the wait expired. The distinction matters and the timeout alone cannot settle it.",
    fix:
      "Compare this method's p95 with its timeout. If p95 is close to the limit the endpoint is " +
      "slow; if p95 is comfortable and a few calls still time out, suspect the connection.",
  },
  {
    rule: "server-error",
    when: (t) => /\b5\d\d\b|internal server error|502|503|504/i.test(t),
    blame: "app",
    headline: "The server accepted the request and then failed to handle it.",
    why:
      "A 5xx means the request arrived and the application broke while processing it. Under a " +
      "simulated population this is often a case the code never sees with one user: a race on " +
      "the same row, a connection pool exhausted, or an unhandled null in concurrent access.",
    fix:
      "The server's own logs for this window will name it. Check whether the failures cluster " +
      "in time — a burst points at contention, a steady trickle at a specific input.",
  },
];

/** Explain one error message. */
export function explain(message, context = {}) {
  const text = String(message ?? "");
  for (const r of RULES) {
    if (r.when(text)) {
      return { blame: r.blame, headline: r.headline, why: r.why, fix: r.fix, rule: r.rule };
    }
  }
  return {
    blame: "unknown",
    headline: "No rule recognised this failure.",
    why: `Populace has no pattern for "${text.slice(0, 120)}".`,
    fix: context.method
      ? `Check what \`${context.method}\` sends against what the API expects.`
      : undefined,
    rule: "none",
  };
}

/**
 * Explain every distinct failure in a report.
 *
 * Ordered by how many calls each affected, because the one that happened a
 * thousand times is worth reading before the one that happened once.
 */
export function explainReport(report) {
  const out = [];
  for (const m of report?.api?.methods || []) {
    for (const e of m.errors || []) {
      const message = typeof e === "string" ? e : e.message;
      const count = typeof e === "string" ? 1 : e.count ?? 1;
      out.push({ method: m.method, message, count, ...explain(message, { method: m.method }) });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * One-line summary of who has to act, for the top of a report.
 *
 * The distinction this draws is the whole point: a run can be red with nothing
 * wrong in the application, and saying so plainly is more useful than any
 * amount of per-error detail.
 */
export function verdictLine(explanations) {
  const n = (b) => explanations.filter((e) => e.blame === b).reduce((a, e) => a + e.count, 0);
  const app = n("app"), env = n("environment"), harness = n("harness"), unknown = n("unknown");
  if (!explanations.length) return "Nothing failed.";

  const notApp = [];
  if (harness) notApp.push(`${harness} never reached the server`);
  if (env) notApp.push(`${env} refused by the platform`);

  // An unclassified failure must never be counted as "not the app". Doing that
  // turns "we could not tell" into an all-clear, which is the exact overreach
  // this module exists to prevent.
  if (app === 0) {
    if (unknown === 0) return `No application failures — ${notApp.join(", ")}.`;
    return `No confirmed application failures` +
      (notApp.length ? ` (${notApp.join(", ")})` : "") +
      `, but ${unknown} could not be classified.`;
  }

  return `${app} failure${app === 1 ? "" : "s"} in the application` +
    (notApp.length ? `, plus ${notApp.join(" and ")}` : "") +
    (unknown ? `, and ${unknown} unclassified` : "") + ".";
}
