// The run report — the thing a customer keeps after the terminal is closed.
//
// A live table is a demo. A report is a product: it says what broke, how often,
// how slow it got, what was never tested at all, and whether the accounts were
// cleaned up. It has to be honest about the last two, because a report that
// only shows successes is worse than no report — it manufactures confidence.

import fs from "node:fs";
import path from "node:path";
import { summarise } from "./instrument.mjs";
import { coverageOf } from "./contract.mjs";
import { renderHtmlReport } from "./html-report.mjs";

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

export function buildReport({ config, adapter, world, metrics, teardown, startedAt }) {
  const api = summarise(metrics);
  const coverage = coverageOf(adapter);
  const totals = world.totals();

  const engineErrors = world.engineErrors ? world.engineErrors() : [];
  const verdict = decideVerdict({ api, world, teardown, engineErrors });

  return {
    populace: { version: "0.1.0", generatedAt: new Date().toISOString() },
    run: {
      app: config.app || adapter.name || "unknown",
      adapter: config.adapter,
      environment: config.environment,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      population: config.population,
    },
    verdict,
    population: {
      requested: world.personas.length,
      signedIn: world.agents.length,
      signupFailures: world.signupFailures,
    },
    engineErrors: world.engineErrors ? world.engineErrors() : [],
    activity: {
      distanceKm: Number(totals.km.toFixed(1)),
      posts: totals.posts,
      likes: totals.likes,
      comments: totals.comments,
      messages: totals.messages,
      groupJoins: totals.groups,
    },
    api,
    coverage: {
      label: coverage.label,
      implemented: coverage.implemented.map((c) => c.method),
      notTested: coverage.missing.map((c) => ({ method: c.method, wouldHaveTested: c.exercises })),
    },
    cleanup: teardown ?? { skipped: true, note: "Agents were left in place. Run `populace clean`." },
  };
}

/**
 * Deliberately conservative. Anything unproven is called unproven, never
 * "passed" — including a run where nothing failed because nothing ran.
 */
function decideVerdict({ api, world, teardown, engineErrors = [] }) {
  const problems = [];

  // Populace's own failures come first. If the tool is broken, nothing it says
  // about the customer's API can be trusted, and a clean verdict would be a lie.
  if (engineErrors.length) {
    problems.push(
      `${engineErrors.length} failure(s) inside Populace itself — this run did not test what it claims to have tested.`,
    );
  }

  if (!world.agents.length) {
    problems.push("No agent could sign in — nothing was tested.");
  }
  if (world.signupFailures.length) {
    problems.push(`${world.signupFailures.length} of ${world.personas.length} accounts could not sign in.`);
  }
  // ANY failure is a finding. There is deliberately no tolerance threshold:
  // a percentage band means a real bug can hide under it on a short run and
  // the report will call the run clean while its own table shows the failure.
  // For a correctness tool that is the worst possible defect — it exits 0 and
  // CI waves the bug through.
  //
  // But the two kinds of failure are stated separately, because they belong to
  // different people. Blaming a customer's API for a dropped socket is how a
  // testing tool loses its credibility — and once a team decides the reports
  // cry wolf, they stop reading the real findings too.
  if (api.apiFailures > 0) {
    problems.push(
      `${api.apiFailures} of ${api.calls} API calls failed (${pct(api.apiFailureRate)}).`,
    );
  }
  if (api.transportFailures > 0) {
    problems.push(
      `${api.transportFailures} of ${api.calls} calls never reached the API after ` +
        `${api.retries} retries — the network between Populace and your server, not your code. ` +
        `These were NOT tested.`,
    );
  }
  // Stated separately and first among network problems: a run that was cut
  // short covers less than it appears to, and every number below it is drawn
  // from a shorter sample than the one that was asked for.
  if (api.network?.gaveUp) {
    problems.push(
      `Populace stopped early — the target stopped responding entirely ` +
        `(${api.network.gaveUpAfter} consecutive unreachable calls). This run is incomplete.`,
    );
  }
  if (teardown?.failed?.length) {
    problems.push(`${teardown.failed.length} simulated accounts could NOT be deleted and are still live.`);
  }
  if (api.calls === 0) {
    problems.push("No API calls were made.");
  }

  const failing = api.methods.filter((m) => m.failures > 0);

  // Three outcomes, not two. A run that found no bugs but could not reach the
  // server half the time has not proved anything, and calling it "clean" would
  // be the single most damaging lie this tool could tell. It is also not
  // "problems-found" in the customer's code — so it gets its own name.
  let status = "clean";
  if (api.apiFailures > 0 || engineErrors.length || !world.agents.length || teardown?.failed?.length) {
    status = "problems-found";
  } else if (problems.length) {
    status = "inconclusive";
  }

  return {
    status,
    problems,
    // Kept explicit so a CI job can branch on "is this my bug or my network?"
    // without re-deriving it from the prose.
    apiFailures: api.apiFailures,
    transportFailures: api.transportFailures,
    failingMethods: failing.map((m) => ({
      method: m.method,
      failureRate: Number(m.failureRate.toFixed(3)),
      apiFailures: m.apiFailures,
      transportFailures: m.transportFailures,
      topError: m.errors[0]?.message ?? null,
    })),
  };
}

export function writeReport(report, config) {
  const file = path.resolve(config._dir || process.cwd(), config.report?.path || "populace-report.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  // The HTML twin is what actually gets shared — emailed to a colleague,
  // attached to a ticket, sent to whoever paid for the run. The JSON is for
  // machines; this is for people who weren't watching the terminal.
  const html = file.replace(/\.json$/, "") + ".html";
  fs.writeFileSync(html, renderHtmlReport(report));
  return { json: file, html };
}

export function renderReport(report) {
  const L = [];
  const rule = "─".repeat(72);

  L.push("");
  L.push(`  POPULACE REPORT — ${report.run.app}`);
  L.push(`  ${report.run.environment} · ${report.population.signedIn} people · ${ms(report.run.durationMs)}`);
  L.push(rule);

  // Verdict first. Someone reading this in CI should not have to scroll.
  // The "no failures" claim is derived from the COUNT, never from the verdict
  // alone — so this line can never contradict the table printed below it.
  if (report.verdict.status === "clean" && report.api.failures === 0) {
    L.push(`  ✔ No failures across ${report.api.calls} API calls.`);
  } else if (report.verdict.status === "inconclusive") {
    // Deliberately not "✖". Nothing is known to be wrong with their code — the
    // run simply could not prove otherwise, and saying so plainly is the point.
    L.push(`  ⚠ Inconclusive — your API did not fail, but the run could not complete:`);
    for (const p of report.verdict.problems) L.push(`      · ${p}`);
  } else {
    L.push(`  ✖ Problems found:`);
    for (const p of report.verdict.problems) L.push(`      · ${p}`);
  }

  // Connection quality, whenever it was anything other than perfect. A reader
  // comparing two runs needs to know whether the latency below was measured
  // over a good link or a bad one.
  const net = report.api.network;
  if (net && !net.healthy) {
    L.push("");
    L.push(
      `  CONNECTION — ${net.retries} retried attempt(s), ` +
        `${pct(net.retryRate)} of all attempts; ${net.transportFailures} never got through.`,
    );
    L.push(`    Latency below is measured on successful attempts only, so it is not inflated by these.`);
  }
  L.push(rule);

  L.push(`  ACTIVITY`);
  const a = report.activity;
  L.push(
    `    ${a.distanceKm} km driven · ${a.posts} posts · ${a.likes} likes · ` +
      `${a.comments} comments · ${a.messages} messages · ${a.groupJoins} joins`,
  );
  L.push("");

  L.push(`  YOUR API UNDER ${report.population.signedIn} CONCURRENT USERS`);
  L.push(`    ${"method".padEnd(22)}${"calls".padStart(7)}${"fails".padStart(7)}${"p50".padStart(9)}${"p95".padStart(9)}`);
  for (const m of report.api.methods) {
    const flag = m.failures ? " ✖" : "  ";
    L.push(
      `   ${flag}${m.method.padEnd(21)}${String(m.calls).padStart(7)}${String(m.failures).padStart(7)}` +
        `${ms(m.latencyMs.p50).padStart(9)}${ms(m.latencyMs.p95).padStart(9)}`,
    );
    for (const e of m.errors.slice(0, 3)) {
      L.push(`        ↳ ${e.count}× ${e.message}`);
    }
  }
  L.push("");

  if (report.coverage.notTested.length) {
    L.push(`  NOT TESTED — adapter implements ${report.coverage.label}`);
    for (const c of report.coverage.notTested) {
      L.push(`    · ${c.method.padEnd(21)} would have tested ${c.wouldHaveTested}`);
    }
    L.push("");
  }

  if (report.cleanup?.skipped) {
    L.push(`  ⚠ CLEANUP SKIPPED — ${report.population.signedIn} simulated accounts are still live.`);
    L.push(`    Remove them with:  populace clean`);
  } else if (report.cleanup?.failed?.length) {
    L.push(`  ⚠ CLEANUP INCOMPLETE — ${report.cleanup.failed.length} accounts could not be deleted:`);
    for (const f of report.cleanup.failed.slice(0, 5)) L.push(`      · ${f.name}: ${f.error}`);
  } else if (report.cleanup?.notDeleted?.length) {
    // Not a failure, and not a success either. Saying "complete" here would be
    // claiming to have removed accounts that were never touched.
    L.push(
      `  ⚠ Cleanup partial — ${report.cleanup.removed} removed, ` +
        `${report.cleanup.notDeleted.length} had nothing to delete:`,
    );
    for (const n of report.cleanup.notDeleted.slice(0, 5)) L.push(`      · ${n.name}: ${n.why}`);
  } else {
    L.push(`  ✔ Cleanup complete — ${report.cleanup.removed} accounts removed.`);
  }

  L.push(rule);
  L.push("");
  return L.join("\n");
}
