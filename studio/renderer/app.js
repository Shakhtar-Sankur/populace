// Populace Studio — the window.
//
// No framework, on purpose: this is five screens over a child process, and a
// build step would be more machinery than the thing it builds.
//
// Every number shown is either streamed from the CLI's own stdout or read from
// the report it wrote. Nothing is computed here, so the window cannot claim
// something the terminal would not.

const $ = (id) => document.getElementById(id);
const api = window.populace;

let lastReportPath = null;
let lastConfig = null;

// ── navigation ──────────────────────────────────────────────────────
function show(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("is-on", t.dataset.screen === name);
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("is-on", s.id === `screen-${name}`);
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => show(t.dataset.screen));

// Links must be opened by the main process. This window's CSP is
// `default-src 'none'`, so a plain <a> navigation is blocked rather than
// handed to a browser — which is why the footer link did nothing at all.
for (const a of document.querySelectorAll("a[href^='http']")) {
  a.addEventListener("click", (e) => { e.preventDefault(); api.openExternal(a.href); });
}

// ── engine ──────────────────────────────────────────────────────────
(async () => {
  const p = await api.enginePath();
  $("engine-state").textContent = p ? `engine ready\n${p.replace(/^.*[\\/](populace[\\/].*)$/, "$1")}` : "engine NOT found";
  $("engine-state").className = p ? "muted" : "bad";
  if (!p) $("start").disabled = true;
})();

// ── run ─────────────────────────────────────────────────────────────
$("pick-cfg").addEventListener("click", async () => {
  const file = await api.pickConfig();
  if (!file) return;
  lastConfig = file;
  $("cfg").value = file;
});

const log = (text) => {
  const el = $("log");
  // A terminal keeps everything; a window that grows without bound stops
  // scrolling smoothly. The tail is what anyone reads.
  el.textContent = (el.textContent + text).slice(-60000);
  el.scrollTop = el.scrollHeight;
};

function readTick(line) {
  // tick 360/1800 · 30 people · 682.2km · 48053p 67604l 27254c 45134m · 2 errors
  const m = line.match(/tick (\d+)\/(\d+).*?(\d+) people.*?(\d+)p (\d+)l (\d+)c (\d+)m(?:.*?(\d+) errors)?/);
  if (!m) return;
  const [, at, total, people, posts, likes, , msgs, errors] = m;
  $("s-tick").textContent = `${at}/${total}`;
  $("s-people").textContent = people;
  $("s-posts").textContent = Number(posts).toLocaleString();
  $("s-likes").textContent = Number(likes).toLocaleString();
  $("s-msgs").textContent = Number(msgs).toLocaleString();
  const err = Number(errors || 0);
  $("s-err").textContent = err;
  $("s-err").className = err ? "warn" : "ok";
  $("bar").style.width = `${Math.min(100, (Number(at) / Number(total)) * 100)}%`;
}

api.onStdout((text) => { log(text); for (const line of text.split("\n")) readTick(line); });
api.onStderr((text) => log(text));

api.onDone(async ({ code, report, error }) => {
  $("start").disabled = false;
  $("stop").disabled = true;
  $("bar").style.width = "100%";
  log(`\n— finished, exit ${code}${error ? ` (${error})` : ""} —\n`);
  $("run-note").textContent = code === 0 ? "Clean run." : "Finished with problems — see Report.";
  if (report) { lastReportPath = report; await renderReport(report); show("report"); }
});

$("start").addEventListener("click", async () => {
  if (!lastConfig) { $("run-note").textContent = "Choose a config first."; return; }
  $("log").textContent = "";
  $("bar").style.width = "0";
  $("run-note").textContent = "";
  for (const id of ["s-tick", "s-people", "s-posts", "s-likes", "s-msgs"]) $(id).textContent = "—";
  $("s-err").textContent = "0"; $("s-err").className = "ok";

  const res = await api.startRun({
    config: lastConfig,
    agents: $("agents").value,
    minutes: $("minutes").value,
    tick: $("tick").value,
    engagement: $("engagement").value,
    cities: $("cities").value.trim() || null,
  });
  if (!res.ok) { $("run-note").textContent = res.error; return; }

  $("start").disabled = true;
  $("stop").disabled = false;
  log(`$ ${res.command}\n\n`);
  show("live");
});

$("stop").addEventListener("click", async () => {
  await api.stopRun();
  log("\n— asked the run to stop; it removes its accounts before exiting —\n");
});

// ── report ──────────────────────────────────────────────────────────
const ms = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function renderReport(file) {
  const res = await api.readReport(file);
  const body = $("report-body");
  if (!res.ok) { body.innerHTML = `<div class="empty">Could not read the report — ${esc(res.error)}</div>`; return; }

  const r = res.report;
  const clean = r.verdict?.status === "clean";
  const rows = (r.api?.methods || []).map((m) => `
    <tr>
      <td>${esc(m.method)}</td>
      <td>${Number(m.calls).toLocaleString()}</td>
      <td class="${m.apiFailures ? "bad" : "ok"}">${m.apiFailures ?? 0}</td>
      <td class="${m.transportFailures ? "warn" : ""}">${m.transportFailures ?? 0}</td>
      <td>${ms(m.latencyMs?.p50)}</td>
      <td>${ms(m.latencyMs?.p95)}</td>
    </tr>`).join("");

  const notTested = (r.coverage?.notTested || []).map((c) =>
    `<li><code>${esc(c.method)}</code> — ${esc(c.wouldHaveTested)}</li>`).join("");

  body.innerHTML = `
    <div class="verdict ${clean ? "clean" : "other"}">${clean ? "✓ Clean" : "⚠ " + esc(r.verdict?.status ?? "unknown")}
      &nbsp;·&nbsp; ${Number(r.api?.calls ?? 0).toLocaleString()} calls &nbsp;·&nbsp;
      ${r.api?.apiFailures ?? 0} API failures</div>
    <p class="muted">${r.population?.signedIn ?? 0} people · ${r.run?.population?.minutes ?? "?"} min ·
      ${(r.run?.population?.cities || []).length} cities · coverage ${esc(r.coverage?.label ?? "?")} ·
      ${r.cleanup?.removed ?? 0}/${r.population?.signedIn ?? 0} accounts removed</p>
    <table>
      <thead><tr><th>Method</th><th>Calls</th><th>API fails</th><th>Network</th><th>p50</th><th>p95</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${notTested ? `<p class="muted" style="margin-top:14px"><b>Not tested</b> — the adapter implements ${esc(r.coverage.label)}:</p><ul class="muted">${notTested}</ul>` : ""}
    <div class="actions" style="margin-top:16px">
      <button id="open-html" class="btn" type="button">Open the shareable page</button>
      <button id="go-explain" class="btn" type="button">Explain the failures</button>
    </div>`;

  $("open-html").addEventListener("click", () => api.showItem(file.replace(/\.json$/, ".html")));
  $("go-explain").addEventListener("click", () => { show("explain"); $("do-explain").click(); });
}

// ── explain ─────────────────────────────────────────────────────────
$("do-explain").addEventListener("click", async () => {
  if (!lastReportPath) { $("explain-out").textContent = "No report yet — finish a run first."; return; }
  $("explain-out").textContent = "Working…";
  const res = await api.cli(["explain", "--file", lastReportPath]);
  $("explain-out").textContent = res.out.trim() || "(nothing came back)";
});

// ── updates ─────────────────────────────────────────────────────────
$("do-update").addEventListener("click", async () => {
  $("update-out").textContent = "Asking the registry…";
  const res = await api.cli(["update"]);
  $("update-out").textContent = res.out.trim() || "(nothing came back)";
});

$("pick-spec").addEventListener("click", async () => {
  const spec = await api.pickSpec();
  if (!spec) return;
  $("spec-note").textContent = "Reading…";
  $("spec-out").textContent = "";
  // Scaffolds beside the spec, so nothing is written anywhere surprising.
  const cwd = spec.replace(/[\\/][^\\/]+$/, "");
  const res = await api.cli(["init", "--from-openapi", spec, "--force"], cwd);
  $("spec-note").textContent = res.ok ? "Done — written next to the spec." : "Finished with problems.";
  $("spec-out").textContent = res.out.trim();
});
