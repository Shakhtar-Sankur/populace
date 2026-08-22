#!/usr/bin/env node
// Turns a run's JSON report into a GitHub Actions job summary and step outputs.
//
// Exists so a result is visible in the pull request itself. The HTML report is
// better, but reaching it means downloading an artifact and opening it, which
// in practice means nobody looks. A table in the summary is read.
//
// Reads:  POPULACE_REPORT   path to the JSON report
//         POPULACE_SUMMARY  "false" to skip writing the summary
//         GITHUB_OUTPUT / GITHUB_STEP_SUMMARY  supplied by the runner
//
// Never throws on a missing or unreadable report. This runs with `if: always()`
// after a run that may have died, and a crash here would replace the real
// failure with a confusing one.

import fs from "node:fs";
import path from "node:path";
import { explainReport, verdictLine } from "./explain.mjs";

const reportPath = process.env.POPULACE_REPORT || "populace-report.json";
const wantSummary = process.env.POPULACE_SUMMARY !== "false";

const out = (k, v) => {
  if (!process.env.GITHUB_OUTPUT) return;
  // Multi-line-safe, and a value containing "=" cannot corrupt the file.
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__POPULACE__\n${v}\n__POPULACE__\n`);
};
const summary = (md) => {
  if (!wantSummary || !process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
};

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  const why = error.code === "ENOENT" ? "no report was written" : error.message;
  console.log(`No usable report at ${reportPath}: ${why}`);
  out("verdict", "no-report");
  out("calls", "0");
  out("api-failures", "0");
  out("transport-failures", "0");
  out("report-json", "");
  out("report-html", "");
  summary(`### Populace\n\nNo report at \`${reportPath}\` — ${why}. The run did not get far enough to write one.`);
  process.exit(0);
}

const api = report.api || {};
const verdict = report.verdict?.status || "unknown";
const apiFailures = api.apiFailures ?? 0;
const transport = api.transportFailures ?? 0;
const htmlPath = reportPath.replace(/\.json$/, ".html");

out("verdict", verdict);
out("calls", String(api.calls ?? 0));
out("api-failures", String(apiFailures));
out("transport-failures", String(transport));
out("report-json", reportPath);
out("report-html", fs.existsSync(htmlPath) ? htmlPath : "");

const n = (v) => Number(v ?? 0).toLocaleString("en-US");
const ms = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

const BADGE = {
  clean: "✅ **Clean**",
  "problems-found": "❌ **Problems found**",
  inconclusive: "⚠️ **Inconclusive**",
};

const pop = report.run?.population || {};
const lines = [];

lines.push(`## Populace — ${report.run?.app || "run"}`);
lines.push("");
lines.push(`${BADGE[verdict] || `**${verdict}**`} · ${n(api.calls)} API calls · **${n(apiFailures)} API failures**`);
lines.push("");

// The distinction that matters most, stated before the table rather than after.
if (verdict === "inconclusive") {
  lines.push(
    `> ${n(transport)} call${transport === 1 ? "" : "s"} never reached your API, so ` +
    `${transport === 1 ? "it was" : "they were"} not tested. That is the network between the ` +
    `runner and your server, not your code — but Populace will not call a run clean when it ` +
    `could not make every call.`,
  );
  lines.push("");
}

lines.push(
  `${pop.agents ?? "?"} simulated users · ${pop.minutes ?? "?"} min · ` +
  `${(pop.cities || []).length} cities · coverage ${report.coverage?.label || "?"} · ` +
  `${report.cleanup?.removed ?? 0}/${report.population?.signedIn ?? 0} accounts removed`,
);
lines.push("");

const methods = api.methods || [];
if (methods.length) {
  lines.push("| Method | Calls | API fails | Network | p50 | p95 |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const m of methods) {
    const bad = (m.apiFailures ?? 0) > 0;
    lines.push(
      `| ${bad ? "**" : ""}\`${m.method}\`${bad ? "**" : ""} | ${n(m.calls)} | ` +
      `${m.apiFailures ?? 0} | ${m.transportFailures ?? 0} | ` +
      `${ms(m.latencyMs?.p50)} | ${ms(m.latencyMs?.p95)} |`,
    );
  }
  lines.push("");
}

// What broke, why and the fix - not just the raw message. A reviewer reading a
// pull request should not have to know what 23503 means.
const explained = explainReport(report);
if (explained.length) {
  const BLAME = { app: "your app", environment: "the platform", harness: "the test client", unknown: "unclassified" };
  lines.push(`**${verdictLine(explained)}**`);
  lines.push("");
  for (const e of explained.slice(0, 5)) {
    lines.push(`<details><summary><b>${e.method}</b> × ${e.count} — ${e.headline} <em>(${BLAME[e.blame]})</em></summary>`);
    lines.push("");
    lines.push(e.why);
    if (e.fix) { lines.push(""); lines.push(`**Fix.** ${e.fix}`); }
    lines.push("");
    lines.push(`<sub><code>${e.message}</code></sub>`);
    lines.push("</details>");
  }
  lines.push("");
}

// What the population did, and the only removal claim that is ours to make.
//
// This used to say the activity itself was "all removed afterwards". Populace
// removes accounts; what happens to the rows they wrote is the application's
// decision. Gitea proved the difference - every simulated account was purged,
// and all 337 issues stayed in the repository reattributed to a ghost user. A
// tool whose whole argument is that it says only what it verified cannot make
// a cleanup claim it never checked.
const a = report.activity;
if (a) {
  const removed = report.cleanup?.removed ?? 0;
  const made = report.population?.signedIn ?? 0;
  lines.push(
    `<sub>${n(a.posts)} posts · ${n(a.likes)} likes · ${n(a.comments)} comments · ` +
    `${n(a.messages)} messages · ${Number(a.distanceKm ?? 0).toFixed(1)} km — from ` +
    `${n(removed)} of ${n(made)} accounts since removed. Whether your app keeps what ` +
    `a deleted account wrote is your app's behaviour, not something Populace changes.</sub>`,
  );
}

summary(lines.join("\n"));
console.log(`${verdict} — ${n(api.calls)} calls, ${apiFailures} API failures, ${transport} transport`);
