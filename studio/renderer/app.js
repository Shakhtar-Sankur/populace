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
// One person is a person, one city is a city. The Run screen's summary has
// always said this correctly; the Live screen had its own two copies of the
// same sentence and neither of them did, so a single-city run announced
// itself as "1 cities" in the header and again under the map.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
  inspectConfig(file);
});



/**
 * Describe the chosen config: what it targets, and whether that is somewhere a
 * population belongs. This runs `populace doctor`, so the window cannot claim a
 * config is ready when the command line would say otherwise.
 */
async function inspectConfig(file) {
  const box = $("target-box");
  const res = await api.cli(["doctor", "--config", file, "--json"]);
  let d = null;
  try { d = JSON.parse((res.out || "").split("\n").filter((l) => l.startsWith("{")).pop()); } catch { /* below */ }
  if (!d) { box.hidden = true; return; }

  box.hidden = false;
  $("t-app").textContent = d.app || "unnamed";
  $("t-url").textContent = d.target || "not set";
  $("t-cov").textContent = `${d.coverage?.implemented?.length ?? 0}/13 methods`;

  // The environment is the field worth colouring. Anything not declared a test
  // environment is where invented people meet real ones.
  const env = $("t-env");
  env.textContent = d.environment || "not declared";
  env.className = d.environment === "test" ? "good" : "risky";

  const reach = $("t-reach");
  reach.textContent = d.reachable === null ? "not checked"
    : d.reachable ? "yes" : (d.reachError || "no");
  reach.className = d.reachable === false ? "risky" : d.reachable ? "good" : "";

  $("run-note").textContent = d.ready ? "" : `Not ready — ${(d.blockers || []).join("; ")}`;
}

// ── run: presets and the summary ────────────────────────────────────
function describeRun() {
  const n = (id) => Number($(id).value) || 0;
  const people = n("agents"), minutes = n("minutes"), tick = n("tick") || 1;
  const cities = $("cities").value.split(",").map((c) => c.trim()).filter(Boolean);
  const moments = Math.round(people * ((minutes * 60) / tick));

  $("sum-people").textContent = people.toLocaleString();
  $("sum-minutes").textContent = String(minutes);
  $("sum-tick").textContent = String(tick);
  $("sum-cities").textContent = cities.length
    ? `${cities.length} ${cities.length === 1 ? "city" : "cities"}`
    : "the config\u2019s cities";
  $("sum-moments").textContent = moments.toLocaleString();
  // The same arithmetic the engine uses in World.run(), so the two cannot drift.
  $("sum-ticks").textContent = Math.max(1, Math.round((minutes * 60) / tick)).toLocaleString();

  // A preset stays lit only while the numbers still match it.
  for (const b of document.querySelectorAll(".preset")) {
    b.classList.toggle("is-on",
      Number(b.dataset.people) === people && Number(b.dataset.minutes) === minutes
      && Number(b.dataset.tick) === tick && Number(b.dataset.engagement) === n("engagement"));
  }
}

for (const b of document.querySelectorAll(".preset")) {
  b.addEventListener("click", () => {
    $("agents").value = b.dataset.people;
    $("minutes").value = b.dataset.minutes;
    $("tick").value = b.dataset.tick;
    $("engagement").value = b.dataset.engagement;
    describeRun();
  });
}
for (const id of ["agents", "minutes", "tick", "engagement", "cities"]) {
  $(id).addEventListener("input", describeRun);
}
describeRun();

const log = (text) => {
  const el = $("log");
  // A terminal keeps everything; a window that grows without bound stops
  // scrolling smoothly. The tail is what anyone reads.
  el.textContent = (el.textContent + text).slice(-60000);
  el.scrollTop = el.scrollHeight;
};

/* -- the live screen -------------------------------------------------
   Every number here comes from the engine's own progress stream, one
   event per tick, carrying exactly what the terminal table shows. The
   window computes nothing the engine did not already know, so it still
   cannot disagree with the command line. */

const live = {
  startedAt: 0,
  totalMs: 0,
  timer: null,
  lastCalls: 0,
  lastAt: 0,
  rates: [],       // calls per second, one per tick, for the sparkline
  tick: 0, totalTicks: 0,   // exact progress, straight from the engine
  projectedMs: 0,           // how long the run looks like taking, at the current rate
  latency: {},     // last known p50/p95 per method, refreshed every few ticks
  rows: new Map(), // person name -> <tr>, so scroll position survives a tick
  dots: new Map(),   // person name -> <circle>
  trails: new Map(), // person name -> { points: [[x,y]...], el: <polyline> }
  sort: { key: null, dir: -1 },
  people: [],        // the latest tick's rows, for re-sorting on click
};

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const clockText = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
};

/**
 * Set a counter.
 *
 * Numbers count to their new value rather than snapping to it. A tick can add
 * a thousand calls, and a figure that jumps reads as a redraw while one that
 * travels reads as a measurement. Only numeric values are animated; anything
 * with other characters in it - "46/300" - is set directly.
 */
const tweens = new Map();
const lands = new Map();

function put(id, text) {
  const el = $(id);
  if (!el || el.textContent === text) return;

  const target = Number(String(text).replace(/,/g, ""));
  const from = Number(String(el.textContent).replace(/,/g, ""));

  el.classList.remove("tickup");
  void el.offsetWidth;            // restart the lift
  el.classList.add("tickup");

  // Counting is decoration, and decoration must never be the only thing that
  // writes a number. requestAnimationFrame does not run at all while the window
  // is hidden, so a tween-only write froze every figure here at whatever it held
  // when the window went behind another one. Measured on 2026-08-24 during a
  // 250-person run: the screen read 86,492 calls while the engine was reporting
  // 131,825 — beside a tick counter that stayed correct only because "147/600"
  // is not a plain number and skipped the tween entirely. A monitor disagreeing
  // with itself is the failure this product exists to find.
  const canCount = Number.isFinite(target) && Number.isFinite(from) && target !== from
    && Math.abs(target - from) > 1 && !/[^\d,]/.test(String(text))
    && !document.hidden;
  if (!canCount) { el.textContent = text; return; }

  cancelAnimationFrame(tweens.get(id));
  // Second line of defence, for a window that is throttled rather than hidden or
  // that simply drops the frames: a timer is not tied to painting, so the true
  // value lands even if no frame is ever rendered.
  clearTimeout(lands.get(id));
  lands.set(id, setTimeout(() => { el.textContent = text; lands.delete(id); }, 700));
  const started = performance.now();
  const DURATION = 420;
  const step = (now) => {
    const t = Math.min(1, (now - started) / DURATION);
    // The same easing curve the rest of the interface uses.
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased).toLocaleString("en-US");
    if (t < 1) tweens.set(id, requestAnimationFrame(step));
    else {
      tweens.delete(id);
      el.textContent = text;
      clearTimeout(lands.get(id));   // frames arrived; the timer is not needed
      lands.delete(id);
    }
  };
  tweens.set(id, requestAnimationFrame(step));
}

/* The clock and the bar run off wall time, not off ticks. The engine emits a
   tick only every simulated step, and at a one-second tick over fifteen
   minutes the old screen sat at zero for three minutes and looked frozen. */
function paintClock() {
  const elapsed = Date.now() - live.startedAt;
  $("s-elapsed").textContent = clockText(elapsed);

  // Progress is ticks, not time. It is the one number here that cannot be
  // wrong, because the engine counts it.
  if (live.totalTicks) {
    $("bar").style.width = Math.min(100, (live.tick / live.totalTicks) * 100) + "%";
  }

  // Remaining is a projection, and it is labelled as one only by being right:
  // once it runs out with ticks still to come, it stops guessing.
  // Nothing has ticked yet, so there is nothing to project from. Saying how
  // long is left would be inventing it, and a countdown beside a screen of
  // zeros is what made a sign-up phase look like a hung window.
  // Neither of these is a state where "X left" is a fact, so the clock says
  // which one it is instead of counting down towards nothing.
  if (live.stopping) { $("s-remaining").textContent = "cleaning up"; return; }
  if (live.joining) { $("s-remaining").textContent = "signing in"; return; }

  const left = live.projectedMs ? live.projectedMs - elapsed : live.totalMs - elapsed;
  const done = live.totalTicks && live.tick >= live.totalTicks;
  $("s-remaining").textContent = done ? "finishing"
    : left > 0 ? clockText(left) + " left"
    : "finishing";
}

function startClock(totalMs) {
  live.startedAt = Date.now();
  live.totalMs = totalMs;
  live.projectedMs = 0;
  live.tick = 0;
  live.totalTicks = 0;
  clearInterval(live.timer);
  live.timer = setInterval(paintClock, 1000);
  paintClock();
}
function stopClock() { clearInterval(live.timer); live.timer = null; }

/* -- the map ---------------------------------------------------------
   Equirectangular, drawn from each person's real coordinates. No
   coastlines: a graticule and the cities they are actually in is honest
   about what the data contains. */
// Cropped to the latitudes people are simulated in. A full -90..90 map spends
// half its height on Antarctica and empty Arctic, which is why the panel looked
// mostly like nothing. These must match build/make-world.mjs, which projects
// the coastline with the same numbers.
const MAP_W = 720, MAP_H = 320, LAT_MAX = 78, LAT_MIN = -58;
const projX = (lng) => ((Number(lng) + 180) / 360) * MAP_W;
const projY = (lat) => ((LAT_MAX - Number(lat)) / (LAT_MAX - LAT_MIN)) * MAP_H;
const svgEl = (name, attrs) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function drawBase(svg) {
  // Natural Earth's land outline, generated into world.js at build time. The
  // window has no network at runtime by design, so there are no map tiles to
  // fetch and nothing leaves the machine.
  if (typeof WORLD_PATH === "string") {
    svg.appendChild(svgEl("path", { class: "land", d: WORLD_PATH }));
  }

  for (let lng = -180; lng <= 180; lng += 30) {
    svg.appendChild(svgEl("line", { class: "grat", x1: projX(lng), y1: 0, x2: projX(lng), y2: MAP_H }));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    svg.appendChild(svgEl("line", {
      class: lat === 0 ? "equator" : "grat", x1: 0, y1: projY(lat), x2: MAP_W, y2: projY(lat),
    }));
  }
}

/* -- zoom and pan ----------------------------------------------------
   Twelve cities on a world map are three-pixel dots, and everyone in one
   city sits on one pixel. The projection is exact - every city lands
   within a tenth of a pixel of its real coordinates - but you cannot see
   that without getting closer. Wheel to zoom, drag to pan, double-click
   to fit. */
const view = { x: 0, y: 0, w: MAP_W, h: MAP_H };

function applyView() {
  const svg = $("map");
  svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);

  // Dots and labels are in map units, so they would balloon as we zoom in.
  // Scaling them back keeps them the same size on screen at any zoom.
  const k = view.w / MAP_W;
  for (const dot of live.dots.values()) dot.setAttribute("r", Math.max(0.35, 2.6 * k));
  for (const t of live.trails.values()) t.el.setAttribute("stroke-width", Math.max(0.08, 0.6 * k));
  for (const t of svg.querySelectorAll(".label")) t.setAttribute("font-size", (8 * k).toFixed(3));
  for (const h of svg.querySelectorAll(".halo")) h.setAttribute("r", Math.max(1.2, 9 * k));
  const note = $("zoom-note");
  if (note) note.textContent = k < 0.999 ? (1 / k).toFixed(1) + "\u00d7" : "fit";
}

function zoomAt(px, py, factor) {
  const next = Math.min(MAP_W, Math.max(MAP_W / 60, view.w * factor));
  const k = next / view.w;
  // Keep whatever is under the pointer under the pointer.
  view.x = px - (px - view.x) * k;
  view.y = py - (py - view.y) * k;
  view.w = next;
  view.h = MAP_H * (next / MAP_W);
  clampView();
  applyView();
}

function clampView() {
  view.x = Math.min(Math.max(view.x, -view.w * 0.15), MAP_W - view.w * 0.85);
  view.y = Math.min(Math.max(view.y, -view.h * 0.15), MAP_H - view.h * 0.85);
}

/** Pointer position in map units. */
function atPointer(e) {
  const r = $("map").getBoundingClientRect();
  return {
    x: view.x + ((e.clientX - r.left) / r.width) * view.w,
    y: view.y + ((e.clientY - r.top) / r.height) * view.h,
  };
}

function wireMap() {
  const svg = $("map");
  if (svg.dataset.wired) return;
  svg.dataset.wired = "1";

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = atPointer(e);
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1.18 : 1 / 1.18);
  }, { passive: false });

  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    drag = { ...atPointer(e) };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("grabbing");
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = atPointer(e);
    view.x -= p.x - drag.x;
    view.y -= p.y - drag.y;
    clampView();
    applyView();
  });
  const release = (e) => {
    drag = null;
    svg.classList.remove("grabbing");
    if (e.pointerId != null && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);

  svg.addEventListener("dblclick", () => {
    view.x = 0; view.y = 0; view.w = MAP_W; view.h = MAP_H;
    applyView();
  });
}

/**
 * Draw the coastline, graticule and equator, once. Kept separate from paintMap()
 * so the world can be on screen before there is anybody standing on it.
 */
function showWorld() {
  const svg = $("map");
  if (!svg || svg.dataset.ready) return;
  drawBase(svg);
  wireMap();
  svg.dataset.ready = "1";
}

function paintMap(people) {
  const svg = $("map");
  showWorld();

  const cities = new Map();
  for (const p of people) {
    if (!cities.has(p.c)) cities.set(p.c, { lat: p.la, lng: p.lo, n: 0 });
    cities.get(p.c).n++;

    // The trail goes in before the dot so the dot always sits on top of it.
    let trail = live.trails.get(p.n);
    if (!trail) {
      trail = { points: [], el: svgEl("polyline", { class: "trail" }) };
      svg.appendChild(trail.el);
      live.trails.set(p.n, trail);
    }
    // Every tick, without a "has it moved enough" guard. At world scale a
    // driver covers about a hundredth of a pixel per tick, so any such guard
    // discards the entire trail; zoomed in twenty times it is a real path.
    // Three decimals of coordinate is roughly 100 m, which is the resolution
    // the engine reports, so this is as fine as the data honestly goes.
    const here = [projX(p.lo), projY(p.la)];
    trail.points.push(here);
    if (trail.points.length > 240) trail.points.shift();
    trail.el.setAttribute("points", trail.points.map((q) => q[0].toFixed(3) + "," + q[1].toFixed(3)).join(" "));

    let dot = live.dots.get(p.n);
    if (!dot) {
      dot = svgEl("circle", { class: "dot", r: 2.6 });
      svg.appendChild(dot);
      live.dots.set(p.n, dot);
    }
    dot.setAttribute("cx", projX(p.lo).toFixed(1));
    dot.setAttribute("cy", projY(p.la).toFixed(1));
    dot.setAttribute("fill", p.e ? "var(--crit)" : p.b ? "var(--amber)" : "var(--accent)");
    dot.setAttribute("opacity", p.b ? 0.5 : 0.95);
  }

  // Labels are drawn once. A city does not move; only the people in it do.
  if (!svg.dataset.labelled && cities.size) {
    for (const [name, c] of cities) {
      svg.appendChild(svgEl("circle", { class: "halo", cx: projX(c.lng), cy: projY(c.lat), r: 9 }));
      const label = svgEl("text", { class: "label", x: projX(c.lng) + 11, y: projY(c.lat) + 3 });
      label.textContent = name;
      svg.appendChild(label);
    }
    svg.dataset.labelled = "1";
  }
  applyView();
  $("map-note").textContent = plural(people.length, "person", "people") + " · " + plural(cities.size, "city", "cities");
}

/* -- throughput ----------------------------------------------------- */
function paintSpark() {
  const svg = $("spark");
  const W = 320, H = 96;
  svg.textContent = "";
  if (live.rates.length < 2) return;

  const data = live.rates.slice(-120);
  const max = Math.max(1, ...data);
  const now = data[data.length - 1];
  const x = (i) => (i / (data.length - 1)) * W;
  const y = (v) => H - (v / max) * (H - 26) - 4;
  const line = data.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");

  // A gradient needs a definition; there is nowhere else to put it.
  const defs = svgEl("defs", {});
  const grad = svgEl("linearGradient", { id: "sparkfill", x1: "0", y1: "0", x2: "0", y2: "1" });
  // Faint. The line carries the information; the fill only gives it a body,
  // and at full strength it reads as a solid block of colour instead.
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "var(--indigo)", "stop-opacity": ".22" }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "var(--indigo)", "stop-opacity": "0" }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  svg.appendChild(svgEl("polygon", { class: "fill", points: "0," + H + " " + line + " " + W + "," + H }));
  svg.appendChild(svgEl("polyline", { class: "line", points: line }));

  // The peak, so the shape has a scale rather than being a pretty squiggle.
  svg.appendChild(svgEl("line", { class: "peak", x1: 0, y1: y(max), x2: W, y2: y(max) }));
  const peak = svgEl("text", { class: "peaklabel", x: 3, y: Math.max(9, y(max) - 3) });
  peak.textContent = "peak " + Math.round(max) + "/s";
  svg.appendChild(peak);

  const dot = svgEl("circle", { cx: x(data.length - 1), cy: y(now), r: 2.2, fill: "var(--accent)" });
  svg.appendChild(dot);
}

/* -- one box per method ---------------------------------------------
   Cards are built once and updated in place. Bar widths are set as JS
   properties, never as style attributes in an HTML string: this window
   runs under `style-src 'self'`, which leaves such an attribute sitting
   in the DOM unapplied - the bars were there all along, at zero width. */
const mcards = new Map();

function paintMethods(methods) {
  const host = $("methods");
  if (!methods.length) return;
  if (host.dataset.empty !== "no") { host.textContent = ""; host.dataset.empty = "no"; }

  const max = Math.max.apply(null, methods.map((m) => m.calls).concat([1]));
  const sorted = methods.slice().sort((a, b) => b.apiFailures - a.apiFailures || b.calls - a.calls);

  sorted.forEach((m, order) => {
    let card = mcards.get(m.method);
    if (!card) {
      const el = document.createElement("div");
      el.className = "mcard";
      const head = document.createElement("div");
      head.className = "m-head";
      const name = document.createElement("span");
      name.className = "m-name";
      name.textContent = m.method;
      const calls = document.createElement("span");
      calls.className = "m-calls";
      head.append(name, calls);
      const track = document.createElement("div");
      track.className = "m-track";
      const bar = document.createElement("span");
      bar.className = "m-bar";
      track.appendChild(bar);
      const foot = document.createElement("div");
      foot.className = "m-foot";
      const fail = document.createElement("span");
      const lat = document.createElement("span");
      foot.append(fail, lat);
      el.append(head, track, foot);
      host.appendChild(el);
      card = { el, calls, bar, fail, lat };
      mcards.set(m.method, card);
    }

    const bad = m.apiFailures > 0;
    card.el.classList.toggle("bad", bad);
    card.el.style.order = String(order);          // failures float to the front
    card.calls.textContent = fmt(m.calls);
    card.bar.style.width = ((m.calls / max) * 100).toFixed(1) + "%";
    card.fail.textContent = bad ? fmt(m.apiFailures) + " failed" : "no failures";
    card.fail.className = bad ? "fail" : "";
    const l = live.latency[m.method];
    card.lat.textContent = l ? "p50 " + l.p50 + "ms \u00b7 p95 " + l.p95 + "ms" : "\u2014";
  });
}


/* -- what is failing, while it is failing ---------------------------- */
function paintFailures(methods) {
  const panel = $("failures");
  const failing = methods.filter((m) => (m.apiFailures || 0) + (m.transportFailures || 0) > 0);
  if (!failing.length) { panel.hidden = true; return; }

  panel.hidden = false;
  failing.sort((a, b) => (b.apiFailures + b.transportFailures) - (a.apiFailures + a.transportFailures));

  const total = failing.reduce((n, m) => n + m.apiFailures + m.transportFailures, 0);
  $("fail-note").textContent =
    `${total.toLocaleString()} across ${failing.length} ${failing.length === 1 ? "method" : "methods"}`;

  const body = $("fail-body");
  body.textContent = "";
  for (const m of failing) {
    const row = document.createElement("div");
    row.className = "fail-row";

    const name = document.createElement("span");
    name.className = "fm";
    name.textContent = m.method;

    const count = document.createElement("span");
    count.className = "fc";
    const api = m.apiFailures || 0, net = m.transportFailures || 0;
    count.textContent = net && api ? `${api} + ${net} net` : net ? `${net} network` : String(api);

    const msg = document.createElement("span");
    msg.className = "fx";
    // The message the engine recorded, not a paraphrase of it.
    msg.textContent = m.error ? m.error.message : "no message recorded yet";

    row.append(name, count, msg);
    body.appendChild(row);
  }
}

/* -- one row per person ---------------------------------------------
   Rows are created once and their cells updated in place. Rebuilding the
   table each tick would reset the scroll position every second, which
   makes it impossible to read. */
function paintPeople(people) {
  const body = $("people").querySelector("tbody");
  for (const p of people) {
    let tr = live.rows.get(p.n);
    if (!tr) {
      tr = document.createElement("tr");
      for (let i = 0; i < 9; i++) {
        const td = document.createElement("td");
        if (i >= 3 && i <= 7) td.className = "r";
        tr.appendChild(td);
      }
      body.appendChild(tr);
      live.rows.set(p.n, tr);
    }
    const c = tr.children;
    c[0].textContent = p.n;
    c[1].textContent = p.y ? p.c + ", " + p.y : p.c;
    c[2].textContent = p.p;
    c[3].textContent = Number(p.k).toFixed(1);
    c[4].textContent = fmt(p.o);
    c[5].textContent = fmt(p.l);
    c[6].textContent = fmt(p.m);
    c[7].textContent = p.e ? fmt(p.e) : "";
    c[7].className = p.e ? "r err" : "r";
    c[8].innerHTML = '<span class="state' + (p.b ? " break" : "") + '">' + (p.b ? "on break" : "driving") + "</span>";
  }
  // Re-appending moves existing rows rather than rebuilding them, so cell
  // updates and the scroll container both survive a sort.
  if (live.sort.key) {
    const k = live.sort.key, dir = live.sort.dir;
    const ordered = people.slice().sort((a, b) => {
      const x = a[k], y = b[k];
      const cmp = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
      return cmp * dir;
    });
    for (const q of ordered) body.appendChild(live.rows.get(q.n));
  }
  $("people-note").textContent = people.length + " rows, updated every tick";
}

for (const th of document.querySelectorAll("#people thead th[data-sort]")) {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    live.sort = { key, dir: live.sort.key === key ? -live.sort.dir : -1 };
    for (const other of document.querySelectorAll("#people thead th")) other.classList.remove("sorted", "asc");
    th.classList.add("sorted");
    th.classList.toggle("asc", live.sort.dir === 1);
    if (live.people.length) paintPeople(live.people);
  });
}

function resetLive() {
  live.rates = []; live.latency = {}; live.lastCalls = 0; live.lastAt = 0;
  live.tick = 0; live.totalTicks = 0; live.projectedMs = 0;
  live.joining = false;
  live.stopping = false;
  live.rows.clear(); live.dots.clear(); live.trails.clear(); mcards.clear();
  view.x = 0; view.y = 0; view.w = MAP_W; view.h = MAP_H;
  const map = $("map");
  map.textContent = ""; delete map.dataset.ready; delete map.dataset.labelled;
  // Put the world back immediately. drawBase() used to run only from paintMap(),
  // so the coastline waited for the first tick — and at 250 people sign-up takes
  // about two and a half minutes, during which a large panel headed "where they
  // are" was an empty rectangle. An empty panel reads as broken, not as waiting.
  showWorld();
  $("spark").textContent = "";
  $("people").querySelector("tbody").textContent = "";
  $("failures").hidden = true;
  $("methods").textContent = "Waiting for the first tick\u2026";
  $("methods").dataset.empty = "yes";
  const zeros = [["s-calls", "0"], ["s-rate", "0"], ["s-fails", "0"], ["s-people", "0"],
                 ["s-km", "0"], ["s-tick", "0/0"], ["s-posts", "0"], ["s-likes", "0"],
                 ["s-comments", "0"], ["s-msgs", "0"]];
  for (const pair of zeros) $(pair[0]).textContent = pair[1];
  $("s-fails").className = "ok";
  $("s-elapsed").textContent = "0:00";
  $("s-remaining").textContent = "\u2014";
  $("bar").style.width = "0";
}

api.onProgress((e) => {
  if (e.type === "start") {
    resetLive();
    startClock(Number(e.minutes) * 60000);
    $("pill").textContent = "running";
    $("pill").className = "pill running";
    $("live-sub").textContent = e.app + " \u00b7 " + e.environment + " \u00b7 " + plural(e.agents, "person", "people") + " · " + plural(e.cities.length, "city", "cities") + " \u00b7 engagement " + e.engagement + "\u00d7";
    live.joining = true;
    $("methods").textContent = "Signing people in\u2026 nobody has acted yet.";
    $("s-remaining").textContent = "signing in";
    return;
  }

  // Signing 250 people in takes minutes. Until this arrived the screen showed
  // nothing but zeros through all of it, with a bar at zero and a clock already
  // counting down \u2014 identical to a hung window, and reported as one.
  if (e.type === "joining") {
    live.joining = true;
    put("s-people", fmt(e.done));
    $("bar").style.width = (e.total ? (e.done / e.total) * 100 : 0).toFixed(1) + "%";
    $("s-remaining").textContent = "signing in";
    $("methods").textContent = "Signing people in \u2014 " + fmt(e.done) + " of " + fmt(e.total)
      + (e.name ? " \u00b7 " + e.name + (e.city ? " (" + e.city + ")" : "") : "");
    $("methods").dataset.empty = "yes";
    $("live-sub").dataset.phase = "joining";
    return;
  }
  if (e.type === "done") {
    stopClock();
    $("bar").style.width = "100%";
    $("s-remaining").textContent = "done";
    const pill = $("pill");
    pill.textContent = e.verdict === "clean" ? "clean" : e.verdict;
    pill.className = "pill " + (e.verdict === "clean" ? "clean" : "trouble");
    return;
  }
  if (e.type !== "tick") return;

  // Reloaded mid-run, or attached late: there was no start event to set these
  // up, and a clock stuck at zero beside a rising call count is a lie about
  // what the window knows.
  if (!live.startedAt) {
    live.startedAt = Date.now() - e.elapsedMs;
    live.totalMs = 0;   // projected from the tick rate below instead
    clearInterval(live.timer);
    live.timer = setInterval(paintClock, 1000);
    $("pill").textContent = "running";
    $("pill").className = "pill running";
  }

  live.joining = false;   // the first tick ends the sign-up phase

  const calls = e.methods.reduce((n, m) => n + m.calls, 0);
  const fails = e.methods.reduce((n, m) => n + m.apiFailures, 0);

  // Rate is measured between events rather than assumed from the tick length,
  // because a tick takes as long as the calls inside it take.
  const dt = (e.elapsedMs - live.lastAt) / 1000;
  if (dt > 0) live.rates.push(Math.max(0, (calls - live.lastCalls) / dt));
  live.lastCalls = calls;
  live.lastAt = e.elapsedMs;

  // Project the finish from how fast ticks are actually arriving, not from
  // how long they were configured to take.
  live.tick = e.tick;
  live.totalTicks = e.totalTicks;
  if (e.tick > 0) live.projectedMs = (e.elapsedMs / e.tick) * e.totalTicks;
  paintClock();

  if (e.latency) live.latency = e.latency;

  put("s-calls", fmt(calls));
  put("s-rate", String(Math.round(live.rates[live.rates.length - 1] || 0)));
  put("s-people", String(e.people.length));
  put("s-km", fmt(Math.round(e.totals.km)));
  put("s-tick", e.tick + "/" + e.totalTicks);
  put("s-posts", fmt(e.totals.posts));
  put("s-likes", fmt(e.totals.likes));
  put("s-comments", fmt(e.totals.comments));
  put("s-msgs", fmt(e.totals.messages));

  const f = $("s-fails");
  f.textContent = fmt(fails);
  f.className = fails ? "bad" : "ok";
  if (fails) { $("pill").textContent = fails + " failing"; $("pill").className = "pill trouble"; }

  live.people = e.people;
  paintMap(e.people);
  paintSpark();
  paintMethods(e.methods);
  paintFailures(e.methods);
  paintPeople(e.people);
});

api.onStdout((text) => log(text));
api.onStderr((text) => log(text));

api.onDone(async ({ code, report, error }) => {
  $("start").disabled = false;
  $("stop").disabled = true;

  // The process has exited, so the run is over whatever else happened. This is
  // the only signal that always arrives: the engine's own "done" carries a
  // verdict but is written after the report, and a run that dies during
  // sign-up never reaches it. Without this the screen sat on "running" and
  // "finishing" while the log below it said the run had failed and exited.
  stopClock();
  $("bar").style.width = "100%";
  $("s-remaining").textContent = "done";
  const pill = $("pill");
  if (/running/.test(pill.className)) {
    pill.textContent = code === 0 ? "clean" : "stopped";
    pill.className = "pill " + (code === 0 ? "clean" : "trouble");
  }

  log(`\n— finished, exit ${code}${error ? ` (${error})` : ""} —\n`);

  // A run that never produced a tick produced no numbers either, and zeroes
  // with no explanation read as a broken window rather than a failed run.
  if (!live.totalTicks) {
    $("live-sub").textContent =
      "The run ended before anyone could sign in. The log below says why, and Report has the detail.";
  }

  $("run-note").textContent = code === 0 ? "Clean run." : "Finished with problems — see Report.";
  if (report) { lastReportPath = report; await renderReport(report); show("report"); }
});

$("start").addEventListener("click", async () => {
  if (!lastConfig) { $("run-note").textContent = "Choose a config first."; return; }
  $("log").textContent = "";
  $("bar").style.width = "0";
  $("run-note").textContent = "";
  // resetLive() clears the whole screen when the start event arrives; this
  // only blanks the log so the previous run does not linger while it starts.

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
  // Said out loud rather than silently: a report that is not where somebody
  // expects it is a report they will not find.
  if (res.fellBack) {
    log(`  ${res.beside} cannot be written to, so the report goes to\n  ${res.report}\n\n`);
  }
  show("live");
});

$("stop").addEventListener("click", async () => {
  // Say what is happening, because tearing down a few hundred accounts is a few
  // hundred API calls and the window would otherwise sit still through all of
  // it — which is how the sign-up phase came to be reported as frozen twice.
  $("stop").disabled = true;
  $("pill").textContent = "stopping";
  $("pill").className = "pill running";
  $("s-remaining").textContent = "cleaning up";
  live.joining = false;
  live.stopping = true;
  log("\n— asked the run to stop; it removes its accounts before exiting —\n");
  await api.stopRun();
});

// ── report ──────────────────────────────────────────────────────────
const ms = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function renderReport(file) {
  const res = await api.readReport(file);
  const body = $("report-body");
  if (!res.ok) {
    body.textContent = "";
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Could not read the report \u2014 " + res.error;
    body.appendChild(e);
    return;
  }

  const r = res.report;
  const clean = r.verdict?.status === "clean";
  const methods = (r.api?.methods || []).slice();
  const cov = r.coverage || {};
  const implemented = cov.implemented || [];
  const notTested = cov.notTested || [];
  const made = r.population?.signedIn ?? 0;
  const removed = r.cleanup?.removed ?? 0;
  const mins = Math.round((r.run?.durationMs ?? 0) / 60000);

  // Latency is the one thing a table hides. p95 sorted descending says, at a
  // glance, which call would be the first to hurt under more load.
  const byP95 = methods.slice().sort((a, b) => (b.latencyMs?.p95 ?? 0) - (a.latencyMs?.p95 ?? 0));
  const worst = Math.max(1, ...byP95.map((m) => m.latencyMs?.p95 ?? 0));

  const bars = byP95.map((m) => {
    const p50 = m.latencyMs?.p50 ?? 0, p95 = m.latencyMs?.p95 ?? 0;
    return `<div class="lat">
      <span class="lat-name">${esc(m.method)}</span>
      <span class="lat-track">
        <span class="lat-p95" data-w="${((p95 / worst) * 100).toFixed(1)}"></span>
        <span class="lat-p50" data-w="${((p50 / worst) * 100).toFixed(1)}"></span>
      </span>
      <span class="lat-val">${ms(p50)} <i>/</i> ${ms(p95)}</span>
    </div>`;
  }).join("");

  const rows = methods.map((m) => `
    <tr>
      <td class="mono">${esc(m.method)}</td>
      <td class="r">${Number(m.calls).toLocaleString()}</td>
      <td class="r ${m.apiFailures ? "err" : ""}">${m.apiFailures ?? 0}</td>
      <td class="r ${m.transportFailures ? "warn" : ""}">${m.transportFailures ?? 0}</td>
      <td class="r">${ms(m.latencyMs?.p50)}</td>
      <td class="r">${ms(m.latencyMs?.p95)}</td>
      <td class="r">${ms(m.latencyMs?.max)}</td>
    </tr>`).join("");

  // Thirteen slots, filled or not. The gap is the point: a run that never
  // called refreshSession has not tested token expiry, whatever else it proved.
  const slots = CONTRACT.map((name) => {
    const on = implemented.includes(name);
    const gap = notTested.find((c) => c.method === name);
    return `<span class="slot${on ? " on" : ""}${gap ? " gap" : ""}" title="${esc(gap ? gap.wouldHaveTested : name)}">${esc(name)}</span>`;
  }).join("");

  const gaps = notTested.map((c) =>
    `<li><code>${esc(c.method)}</code> \u2014 ${esc(c.wouldHaveTested)}</li>`).join("");

  const act = r.activity || {};

  body.innerHTML = `
    <div class="panel verdict-panel ${clean ? "is-clean" : "is-trouble"}">
      <div class="verdict-row">
        <span class="verdict-mark">${clean ? "\u2713" : "\u26a0"}</span>
        <div>
          <h2 class="verdict-title">${clean ? "Clean run" : esc(r.verdict?.status ?? "unknown")}</h2>
          <p class="muted">${esc(r.run?.app ?? "your app")} \u00b7 ${esc(r.run?.environment ?? "?")} environment
            \u00b7 ${new Date(r.run?.startedAt ?? Date.now()).toLocaleString()}</p>
        </div>
      </div>
      <p class="verdict-line">${clean
        ? "Every call this run made reached your API and was answered. Coverage was " + esc(cov.label ?? "?") + "."
        : (r.verdict?.problems || []).map(esc).join(" ") || "See the failures below."}</p>
    </div>

    <div class="stats report-stats">
      <div class="stat"><b>${Number(r.api?.calls ?? 0).toLocaleString()}</b><span>API calls</span></div>
      <div class="stat"><b class="${r.api?.apiFailures ? "bad" : "ok"}">${r.api?.apiFailures ?? 0}</b><span>API failures</span></div>
      <div class="stat"><b class="${r.api?.transportFailures ? "warn" : ""}">${r.api?.transportFailures ?? 0}</b><span>network</span></div>
      <div class="stat"><b>${made}</b><span>${made === 1 ? "person" : "people"}</span></div>
      <div class="stat"><b>${mins}</b><span>${mins === 1 ? "minute" : "minutes"}</span></div>
      <div class="stat"><b class="${removed === made ? "ok" : "bad"}">${removed}/${made}</b><span>removed</span></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Latency by method</h2><span class="muted">p50 solid, p95 faint \u00b7 worst first</span></div>
      <div class="lats">${bars || '<p class="muted">No calls were recorded.</p>'}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Every method</h2><span class="muted">${methods.length} of ${implemented.length} implemented methods were called this run</span></div>
      <div class="tablewrap">
        <table class="people">
          <thead><tr><th>Method</th><th class="r">calls</th><th class="r">API fails</th>
            <th class="r">network</th><th class="r">p50</th><th class="r">p95</th><th class="r">max</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="grid2-about">
      <div class="panel">
        <div class="panel-head"><h2>Coverage</h2><span class="muted">${esc(cov.label ?? "?")}</span></div>
        <div class="slots">${slots}</div>
        ${gaps ? `<p class="muted spaced"><b>Not tested</b> \u2014 and what that leaves unknown:</p><ul class="gaps">${gaps}</ul>` : ""}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>What they did</h2><span class="muted">and what became of them</span></div>
        <div class="mini">
          <div><b>${Number(act.posts ?? 0).toLocaleString()}</b><span>posts</span></div>
          <div><b>${Number(act.likes ?? 0).toLocaleString()}</b><span>likes</span></div>
          <div><b>${Number(act.comments ?? 0).toLocaleString()}</b><span>comments</span></div>
          <div><b>${Number(act.messages ?? 0).toLocaleString()}</b><span>messages</span></div>
        </div>
        <p class="muted spaced">${Number(act.distanceKm ?? 0).toFixed(1)} km driven.
          ${removed === made
            ? `All ${made} accounts were removed afterwards.`
            : `<b class="bad">${made - removed} of ${made} accounts were left behind.</b>`}
          What your app keeps of what a deleted account wrote is your app's behaviour.</p>
      </div>
    </div>

    <div class="actions spaced-lg">
      <button id="open-html" class="btn primary" type="button">Open the shareable page</button>
      <button id="go-explain" class="btn" type="button">Explain the failures</button>
    </div>`;

  // Widths are set here, not in the markup: style attributes are discarded
  // under `style-src 'self'`.
  for (const el of body.querySelectorAll("[data-w]")) el.style.width = el.dataset.w + "%";

  $("open-html").addEventListener("click", () => api.showItem(file.replace(/\.json$/, ".html")));
  $("go-explain").addEventListener("click", () => { show("explain"); $("do-explain").click(); });
}

/** The contract, in the order a person meets it. */
const CONTRACT = [
  "createUser", "setProfile", "refreshSession", "reportLocation", "post",
  "recentPostsByOthers", "like", "comment", "openConversation", "sendMessage",
  "listGroups", "joinGroup", "deleteUser",
];

const BLAME = {
  app:         { label: "Your app", tone: "app",  note: "A defect in the software under test." },
  environment: { label: "The platform", tone: "env", note: "The database, the host or the network it runs on." },
  harness:     { label: "The test client", tone: "harness", note: "Populace itself, or the adapter." },
  unknown:     { label: "Unclassified", tone: "unknown", note: "No rule matched. Read the message and judge it yourself." },
};

$("do-explain").addEventListener("click", async () => {
  const host = $("explain-body");
  if (!lastReportPath) {
    host.textContent = "";
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No report yet. Finish a run first.";
    host.appendChild(e);
    return;
  }

  host.textContent = "";
  const wait = document.createElement("div");
  wait.className = "empty";
  wait.textContent = "Working out what happened\u2026";
  host.appendChild(wait);

  // The text form too, in the fold below, so the window and the terminal can
  // be compared line for line by anyone who wants to.
  api.cli(["explain", "--file", lastReportPath]).then((t) => {
    $("explain-out").textContent = (t.out || "").trim() || "(nothing came back)";
  });

  const res = await api.cli(["explain", "--file", lastReportPath, "--json"]);
  let data = null;
  try { data = JSON.parse((res.out || "").trim().split("\n").filter((l) => l.startsWith("{")).pop()); } catch { /* handled below */ }

  host.textContent = "";
  if (!data) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Could not read the explanation. The raw output is in the fold below.";
    host.appendChild(e);
    return;
  }

  if (!data.explained.length) {
    const e = document.createElement("div");
    e.className = "empty ok-empty";
    e.textContent = "Nothing failed in this run, so there is nothing to explain.";
    host.appendChild(e);
    return;
  }

  const groups = new Map();
  for (const item of data.explained) {
    const key = BLAME[item.blame] ? item.blame : "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  // Your app first: it is the only group the person reading this can fix today.
  const order = ["app", "environment", "harness", "unknown"];

  const parts = [`<p class="verdict-line strong">${esc(data.verdict || "")}</p>`];
  for (const key of order) {
    const items = groups.get(key);
    if (!items) continue;
    const b = BLAME[key];
    parts.push(`<div class="panel blame ${b.tone}">
      <div class="panel-head">
        <h2>${esc(b.label)}</h2>
        <span class="muted">${esc(b.note)}</span>
      </div>
      ${items.map((e) => `
        <div class="cause">
          <div class="cause-head">
            <code>${esc(e.method)}</code>
            <span class="times">\u00d7 ${Number(e.count ?? 1).toLocaleString()}</span>
            ${e.source === "model" ? '<span class="by-model">explained by the model</span>' : ""}
          </div>
          <p class="cause-head-line">${esc(e.headline || "")}</p>
          <p class="cause-why">${esc(e.why || "")}</p>
          ${e.fix ? `<p class="cause-fix"><b>Fix.</b> ${esc(e.fix)}</p>` : ""}
          ${e.message ? `<pre class="cause-msg">${esc(e.message)}</pre>` : ""}
        </div>`).join("")}
    </div>`);
  }
  host.innerHTML = parts.join("");
});

// ── this application's own version ──────────────────────────────────
(async () => {
  try {
    const v = await api.appVersion();
    $("app-version").textContent = v;
    $("about-version").textContent = v;
    $("privacy-version").textContent = v;
  } catch { /* both stay as a dash */ }

  // A Store copy updates through the Store. Offering a second way would be
  // both against Store policy and a good way to end up with two versions of
  // the same program on one machine.
  try {
    if ((await api.distribution()) === "store") {
      $("do-app-update").hidden = true;
      $("app-update-note").textContent = "Updates arrive through the Microsoft Store.";
      $("app-update-out").textContent =
        "This copy was installed from the Microsoft Store, so Windows keeps it up to date.";
    }
  } catch { /* a standalone build answers normally */ }
})();

$("do-app-update").addEventListener("click", async () => {
  const out = $("app-update-out");
  const link = $("get-update");
  link.hidden = true;
  out.textContent = "Asking GitHub\u2026";

  const r = await api.checkAppUpdate();
  if (!r.ok) {
    // Not "up to date": the check did not happen, and saying otherwise would
    // be a claim we did not earn.
    out.textContent = `Could not check \u2014 ${r.error}.\nYou are running ${r.current}. Nothing is wrong with this install.`;
    return;
  }
  if (r.managed === "store") {
    out.textContent = "This copy was installed from the Microsoft Store, so Windows keeps it up to date.";
    return;
  }
  if (!r.latest) { out.textContent = `You are running ${r.current}. No published Studio release was found.`; return; }

  if (r.newer) {
    out.textContent = `${r.current} \u2192 ${r.latest} is available.\n\n${r.notes}`.trim();
    link.hidden = false;
    link.dataset.url = r.url;
    $("app-update-note").textContent = "Downloads from the release page. Windows will warn about the unsigned installer.";
  } else {
    out.textContent = `Up to date \u2014 ${r.current} is the newest release.`;
    $("app-update-note").textContent = "Checked against the public release list.";
  }
});

$("get-update").addEventListener("click", (e) => {
  e.preventDefault();
  if (e.currentTarget.dataset.url) api.openExternal(e.currentTarget.dataset.url);
});

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

// The world is on screen from the moment the window opens, not from the first
// tick. Runs last, after drawBase and wireMap exist.
showWorld();
