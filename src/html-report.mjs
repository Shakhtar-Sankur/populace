// Renders a run report as a single self-contained HTML file.
//
// The terminal output is for the person who started the run. This is for
// everyone else — the colleague who wasn't watching, the client who paid for
// the run, the ticket it gets attached to. It has to survive being emailed.
//
// No external anything: one file, inline CSS, no fonts or scripts fetched.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pct = (n) => `${(n * 100).toFixed(n < 0.01 && n > 0 ? 2 : 1)}%`;
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const dur = (n) => (n >= 60000 ? `${Math.round(n / 60000)}m ${Math.round((n % 60000) / 1000)}s` : `${(n / 1000).toFixed(1)}s`);

export function renderHtmlReport(report) {
  const r = report;
  const clean = r.verdict.status === "clean";
  const engineBroke = (r.engineErrors?.length ?? 0) > 0;

  // Latency bars are scaled to the slowest method, so the outlier is obvious
  // at a glance rather than requiring the reader to compare numbers.
  const slowest = Math.max(1, ...r.api.methods.map((m) => m.latencyMs.p95));

  const methodRows = r.api.methods
    .map((m) => {
      const bad = m.failures > 0;
      const width = Math.max(2, (m.latencyMs.p95 / slowest) * 100);
      const errs = m.errors
        .slice(0, 3)
        .map((e) => `<div class="err"><span class="errn">${e.count}×</span>${esc(e.message)}</div>`)
        .join("");
      return `
      <tr class="${bad ? "row-bad" : ""}">
        <td class="mono name">${bad ? '<span class="x">✖</span>' : ""}${esc(m.method)}</td>
        <td class="num">${m.calls}</td>
        <td class="num ${bad ? "fail" : "zero"}">${m.failures}</td>
        <td class="num">${ms(m.latencyMs.p50)}</td>
        <td class="num">${ms(m.latencyMs.p95)}</td>
        <td class="barcell"><div class="bar" style="width:${width.toFixed(1)}%"></div></td>
      </tr>
      ${errs ? `<tr class="errrow"><td colspan="6">${errs}</td></tr>` : ""}`;
    })
    .join("");

  const notTested = (r.coverage.notTested || [])
    .map(
      (c) =>
        `<li><span class="mono">${esc(c.method)}</span><span class="would">would have tested ${esc(c.wouldHaveTested)}</span></li>`,
    )
    .join("");

  const problems = r.verdict.problems.map((p) => `<li>${esc(p)}</li>`).join("");

  const engineBlock = engineBroke
    ? `
    <section class="panel danger">
      <h2>Populace itself failed ${r.engineErrors.length} time(s)</h2>
      <p>These failures never reached your app. They are bugs in the simulation, which
      means <strong>this run did not test everything it claims to have tested</strong>.
      Treat the results below as incomplete.</p>
      <pre class="trace">${r.engineErrors.map(esc).join("\n\n")}</pre>
    </section>`
    : "";

  const cleanupBlock = r.cleanup?.skipped
    ? `<div class="chip warn">Cleanup skipped — ${r.population.signedIn} accounts still live</div>`
    : r.cleanup?.failed?.length
      ? `<div class="chip bad">Cleanup incomplete — ${r.cleanup.failed.length} accounts could not be deleted</div>`
      : `<div class="chip ok">Cleanup complete — ${r.cleanup?.removed ?? 0} accounts removed</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Populace report — ${esc(r.run.app)}</title>
<style>
:root{
  --paper:#F4F5F7;--card:#fff;--ink:#12181D;--body:#3A454E;--muted:#6B7883;
  --rule:#DDE2E7;--accent:#A85A0B;--ok:#2C6E4C;--bad:#A63127;--warn:#9A6A08;
  --bar:#C9D4DC;--barbad:#E0A99F;
  --mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#0E1418;--card:#161E24;--ink:#E8EEF3;--body:#B0BDC7;--muted:#7B8994;
  --rule:#26323A;--accent:#E0A45C;--ok:#5FAB80;--bad:#DE7568;--warn:#D2A24E;
  --bar:#2E3A43;--barbad:#5C332C;}}
:root[data-theme="dark"]{--paper:#0E1418;--card:#161E24;--ink:#E8EEF3;--body:#B0BDC7;
  --muted:#7B8994;--rule:#26323A;--accent:#E0A45C;--ok:#5FAB80;--bad:#DE7568;
  --warn:#D2A24E;--bar:#2E3A43;--barbad:#5C332C;}
:root[data-theme="light"]{--paper:#F4F5F7;--card:#fff;--ink:#12181D;--body:#3A454E;
  --muted:#6B7883;--rule:#DDE2E7;--accent:#A85A0B;--ok:#2C6E4C;--bad:#A63127;
  --warn:#9A6A08;--bar:#C9D4DC;--barbad:#E0A99F;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--body);font-family:var(--sans);
  font-size:15.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:900px;margin:0 auto;padding:0 22px 80px}
h1,h2,h3{color:var(--ink);margin:0;text-wrap:balance}
h1{font-family:var(--mono);font-size:clamp(22px,4vw,30px);letter-spacing:-.02em}
h2{font-size:17px;font-family:var(--mono);letter-spacing:-.01em}
.mono{font-family:var(--mono)}
header{padding:44px 0 24px;border-bottom:2px solid var(--ink);display:flex;
  flex-direction:column;gap:10px}
.sub{font-family:var(--mono);font-size:12.5px;color:var(--muted)}
.verdict{margin-top:26px;padding:20px 22px;border-radius:6px;display:flex;
  flex-direction:column;gap:8px;border-left:4px solid}
.verdict.ok{background:color-mix(in srgb,var(--ok) 8%,transparent);border-color:var(--ok)}
.verdict.bad{background:color-mix(in srgb,var(--bad) 8%,transparent);border-color:var(--bad)}
.verdict h2{color:var(--ink)}
.verdict ul{margin:4px 0 0;padding-left:20px}
.stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));margin-top:26px}
.stat{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:15px 16px}
.stat .v{font-family:var(--mono);font-size:23px;color:var(--ink);font-weight:600;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums;display:block}
.stat .l{font-family:var(--mono);font-size:10px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--muted)}
section{margin-top:42px;display:flex;flex-direction:column;gap:14px}
.panel{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:20px 22px}
.panel.danger{border-color:var(--bad);border-left-width:4px}
.panel.danger h2{color:var(--bad)}
.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:6px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:600px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--rule)}
th{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted);font-weight:600}
td.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:13.5px}
td.name{font-size:13.5px;color:var(--ink);white-space:nowrap}
td.zero{color:var(--muted)}
td.fail{color:var(--bad);font-weight:600}
.x{color:var(--bad);margin-right:6px}
.barcell{width:120px}
.bar{height:7px;background:var(--bar);border-radius:4px}
.row-bad .bar{background:var(--barbad)}
tr.errrow td{padding-top:0;border-bottom:1px solid var(--rule)}
.err{font-family:var(--mono);font-size:12px;color:var(--bad);padding:3px 0 3px 26px}
.errn{color:var(--muted);margin-right:8px}
.trace{font-family:var(--mono);font-size:11.5px;white-space:pre-wrap;overflow-x:auto;
  background:var(--paper);padding:14px;border-radius:5px;margin:0;color:var(--body)}
ul.cov{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
ul.cov li{display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:14px}
ul.cov .mono{color:var(--ink);min-width:170px;font-size:13px}
.would{color:var(--muted);font-size:13.5px}
.chip{display:inline-block;font-family:var(--mono);font-size:12px;padding:7px 13px;
  border-radius:5px;border:1px solid}
.chip.ok{color:var(--ok);border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,transparent)}
.chip.bad{color:var(--bad);border-color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,transparent)}
.chip.warn{color:var(--warn);border-color:var(--warn);background:color-mix(in srgb,var(--warn) 8%,transparent)}
footer{margin-top:52px;padding-top:20px;border-top:1px solid var(--rule);
  font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:6px}
</style></head><body>
<div class="wrap">

<header>
  <h1>${esc(r.run.app)}</h1>
  <span class="sub">${esc(r.run.environment)} environment · ${r.population.signedIn} simulated people ·
    ${dur(r.run.durationMs)} · ${esc(new Date(r.run.startedAt).toUTCString())}</span>
</header>

<div class="verdict ${clean ? "ok" : "bad"}">
  <h2>${clean ? `No failures across ${r.api.calls} API calls` : "Problems found"}</h2>
  ${clean ? "" : `<ul>${problems}</ul>`}
</div>

${engineBlock}

<div class="stats">
  <div class="stat"><span class="v">${r.api.calls}</span><span class="l">API calls</span></div>
  <div class="stat"><span class="v" style="color:${r.api.failures ? "var(--bad)" : "var(--ok)"}">${r.api.failures}</span><span class="l">failed</span></div>
  <div class="stat"><span class="v">${pct(r.api.failureRate)}</span><span class="l">failure rate</span></div>
  <div class="stat"><span class="v">${r.population.signedIn}</span><span class="l">concurrent users</span></div>
  <div class="stat"><span class="v">${esc(r.coverage.label)}</span><span class="l">coverage</span></div>
</div>

<section>
  <h2>Your API under ${r.population.signedIn} concurrent users</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>Method</th><th style="text-align:right">Calls</th>
        <th style="text-align:right">Fails</th><th style="text-align:right">p50</th>
        <th style="text-align:right">p95</th><th>p95 relative</th></tr></thead>
      <tbody>${methodRows}</tbody>
    </table>
  </div>
</section>

<section>
  <h2>What the population did</h2>
  <div class="panel">
    ${r.activity.distanceKm} km travelled · ${r.activity.posts} posts ·
    ${r.activity.likes} likes · ${r.activity.comments} comments ·
    ${r.activity.messages} messages · ${r.activity.groupJoins} group joins
  </div>
</section>

${
  notTested
    ? `<section>
  <h2>Not tested — adapter implements ${esc(r.coverage.label)}</h2>
  <div class="panel"><ul class="cov">${notTested}</ul></div>
</section>`
    : ""
}

<section>
  <h2>Cleanup</h2>
  <div>${cleanupBlock}</div>
</section>

<footer>
  <span>Generated by Populace ${esc(r.populace.version)} · adapter <span class="mono">${esc(r.run.adapter)}</span></span>
  <span>Simulated people are generated from patterns. This report shows whether your app
  <strong>works</strong> — not whether anyone wants it.</span>
</footer>

</div></body></html>`;
}
