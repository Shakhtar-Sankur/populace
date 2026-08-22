// The model layer: explanations for failures no rule could name.
//
// Deliberately the SECOND thing tried, never the first. src/explain.mjs handles
// the recognisable shapes — permissions, foreign keys, quotas, sockets — with
// rules that are instant, free, offline and auditable. This is for the
// remainder, and it only ever sees the remainder.
//
// Raw fetch rather than @anthropic-ai/sdk, and that is a deliberate trade. The
// SDK is the better tool in almost any other project; here it would be
// Populace's first runtime dependency, and "zero dependencies" is not a
// slogan — it is why `npx @gigzen/populace` works with nothing to install.
// One POST is a fair price for keeping that true.
//
// WHAT IS SENT, exactly:
//   · the method name        e.g. "sendMessage"
//   · the error message      e.g. "TypeError: fetch failed"
//   · how many times         e.g. 17
//   · p50/p95 for that method
// Nothing else. No target URL, no keys, no tokens, no request bodies, no
// simulated users' content. Everything sent is printed first when --verbose is
// on, because a tool that quietly ships your data somewhere is not one you
// should trust with your staging credentials.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const VERSION = "2023-06-01";

/** The key, from the environment or the config. Never written to disk by us. */
export function apiKey(config) {
  return process.env.ANTHROPIC_API_KEY || config?.ai?.apiKey || null;
}

export const isConfigured = (config) => Boolean(apiKey(config));

const SYSTEM = `You explain failures from a load-testing tool called Populace, which drives an
application through its own API as a population of simulated users.

You are the fallback. A rule engine already handled every failure it recognised —
row-level security, foreign keys, expired sessions, provider rate limits, socket
errors. What reaches you is what it could not name.

For each failure, answer three things:
  headline  one sentence: what happened. No preamble.
  why       two or three sentences: the mechanism. What would produce this?
  fix       one or two sentences: what to change. Concrete.
  blame     exactly one of: app | environment | harness | unknown
            app         the application under test is at fault
            environment the platform or provider refused it (quotas, limits)
            harness     it never reached the server (sockets, DNS, the client)
            unknown     you genuinely cannot tell

Rules you must follow:
- If you cannot tell, say so and use blame "unknown". A confident wrong cause
  costs more to debug than an honest blank.
- Never invent a status code, table name, policy name or line number that was
  not in the input.
- Prefer the boring explanation. Under concurrency, most failures are
  contention, permissions, or a resource limit — not exotic.

Reply with JSON only, no prose around it:
{"explanations":[{"method":"...","headline":"...","why":"...","fix":"...","blame":"..."}]}`;

/**
 * Ask the model about failures the rules could not name.
 *
 * Returns [] on any problem — a missing key, a refusal, a network error, a
 * malformed reply. This is an enhancement to a report that is already complete
 * and useful; it must never be the reason a run fails or a report is not
 * written.
 */
export async function explainWithAI(unexplained, { config, verbose = false, timeoutMs = 30000 } = {}) {
  const key = apiKey(config);
  if (!key || !unexplained?.length) return [];

  const payload = unexplained.map((e) => ({
    method: e.method,
    error: String(e.message ?? "").slice(0, 500),
    occurrences: e.count ?? 1,
    p50ms: e.p50 ?? null,
    p95ms: e.p95 ?? null,
  }));

  if (verbose) {
    console.log("\n  Sending to the model — this is everything, nothing else leaves this machine:");
    console.log(JSON.stringify(payload, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        // Effort low: this is a small, bounded task on a handful of short
        // strings, and a CLI that pauses for twenty seconds to explain an
        // error is a CLI people turn off.
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{
          role: "user",
          content:
            `Failures a rule engine could not classify:\n\n${JSON.stringify(payload, null, 2)}\n\n` +
            `Explain each one.`,
        }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail(res.status === 401
        ? "the API key was rejected"
        : res.status === 429
          ? "rate limited by the API"
          : `the API returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }

    const data = await res.json();

    // A safety refusal is a normal outcome, not a crash.
    if (data.stop_reason === "refusal") return fail("the model declined to answer");

    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return fail("the reply was not JSON");

    const parsed = JSON.parse(json[0]);
    const BLAME = new Set(["app", "environment", "harness", "unknown"]);

    return (parsed.explanations || []).map((e) => ({
      method: String(e.method ?? "unknown"),
      headline: String(e.headline ?? "").trim(),
      why: String(e.why ?? "").trim(),
      fix: e.fix ? String(e.fix).trim() : undefined,
      // An unrecognised blame value becomes "unknown" rather than being trusted.
      blame: BLAME.has(e.blame) ? e.blame : "unknown",
      rule: "model",
      source: "model",
    })).filter((e) => e.headline);
  } catch (error) {
    return fail(error.name === "AbortError" ? `no reply within ${timeoutMs / 1000}s` : error.message);
  } finally {
    clearTimeout(timer);
  }

  function fail(why) {
    console.log(`  (the model layer was skipped — ${why})`);
    return [];
  }
}
