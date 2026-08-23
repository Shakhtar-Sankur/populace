// Populace Studio — the desktop shell.
//
// It does not reimplement anything. Every run is the same `populace` CLI a
// person would type, spawned as a child process, and every number on screen is
// read from the report that run wrote. That means the window can never disagree
// with the terminal, and a fix in the engine arrives here for free.
//
// It also means the engine keeps its zero runtime dependencies: Electron's
// weight is entirely in this package and never reaches what ships to npm.

const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Must match src/progress.mjs. Duplicated rather than imported because the
// engine is ESM and loaded as a child process, never linked into this one.
const PROGRESS_PREFIX = "@@populace@@";

let win = null;
let current = null; // the running child, so it can be stopped

/**
 * Where the engine lives.
 *
 * Packaged, it sits in resources next to the app. In development it is the
 * sibling checkout. Both are checked rather than assumed, because a missing
 * engine should say so in a sentence instead of failing on spawn.
 */
function enginePath() {
  const candidates = [
    path.join(process.resourcesPath || "", "populace", "src", "cli.mjs"),
    path.join(__dirname, "..", "src", "cli.mjs"),
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

/**
 * Where the window was last time.
 *
 * Kept beside the application's own settings rather than anywhere the user has
 * to think about. A corrupt or missing file is not an error worth reporting -
 * it just means this is the first run.
 */
function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function savedWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
    if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;
    // A window remembered on a monitor that is no longer attached would open
    // off-screen, where it cannot be found or moved.
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x < b.x + b.width && saved.x + saved.width > b.x
          && saved.y < b.y + b.height && saved.y + saved.height > b.y;
    });
    return visible ? saved : { ...saved, x: undefined, y: undefined };
  } catch {
    return null;
  }
}

function rememberWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // A read-only profile is not a reason to fail on the way out.
  }
}

function createWindow() {
  const saved = savedWindowState();
  // No memory yet: take most of the work area rather than a fixed size that
  // leaves a third of a laptop screen empty.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const first = {
    width: Math.min(1440, Math.round(area.width * 0.9)),
    height: Math.min(940, Math.round(area.height * 0.9)),
  };

  win = new BrowserWindow({
    width: saved?.width ?? first.width,
    height: saved?.height ?? first.height,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f2f4f0",
    title: "Populace Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // The renderer never gets Node. Everything privileged goes through the
      // narrow IPC surface below, which is the whole reason preload exists.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (saved?.maximized) win.maximize();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  for (const event of ["resize", "move", "maximize", "unmaximize"]) win.on(event, rememberWindowState);
  win.on("close", rememberWindowState);

  // Links open in the real browser, never inside the app frame.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  stopRun();
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------- IPC

ipcMain.handle("engine:path", () => enginePath());

ipcMain.handle("dialog:pickConfig", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose a populace.config.mjs",
    properties: ["openFile"],
    filters: [{ name: "Populace config", extensions: ["mjs", "js"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:pickSpec", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose an OpenAPI description (JSON)",
    properties: ["openFile"],
    filters: [{ name: "OpenAPI", extensions: ["json"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("shell:showItem", (_e, file) => { if (file) shell.showItemInFolder(file); });
ipcMain.handle("shell:openExternal", (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });


/**
 * Is there a newer Populace Studio?
 *
 * One anonymous GET to the public releases API. Nothing about the machine, the
 * app under test or any run is sent, and a failure is reported as a failure
 * rather than as "up to date" - claiming to be current when the check never
 * happened is the kind of small lie this product exists to avoid.
 */
ipcMain.handle("app:checkUpdate", async () => {
  const current = app.getVersion();
  if (process.windowsStore) {
    return { ok: true, current, latest: null, managed: "store" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("https://api.github.com/repos/Shakhtar-Sankur/populace/releases?per_page=30", {
      signal: controller.signal,
      headers: { accept: "application/vnd.github+json", "user-agent": `populace-studio/${current}` },
    });
    if (!res.ok) return { ok: false, current, error: `GitHub answered ${res.status}` };

    const releases = await res.json();
    const studio = releases
      .filter((r) => !r.draft && typeof r.tag_name === "string" && r.tag_name.startsWith("studio-v"))
      .map((r) => ({ version: r.tag_name.replace(/^studio-v/, ""), url: r.html_url, notes: r.body || "", at: r.published_at }))
      .sort((a, b) => compareVersions(b.version, a.version));

    if (!studio.length) return { ok: true, current, latest: null };
    const newest = studio[0];
    return {
      ok: true,
      current,
      latest: newest.version,
      newer: compareVersions(newest.version, current) > 0,
      url: newest.url,
      notes: newest.notes.split("\n").slice(0, 6).join("\n"),
      at: newest.at,
    };
  } catch (error) {
    return { ok: false, current, error: error.name === "AbortError" ? "the request timed out" : error.message };
  } finally {
    clearTimeout(timer);
  }
});

/** Plain numeric semver. Pre-release tags are ignored; we do not publish them. */
function compareVersions(a, b) {
  const parts = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return 1;
    if ((x[i] || 0) < (y[i] || 0)) return -1;
  }
  return 0;
}

ipcMain.handle("app:version", () => app.getVersion());

/**
 * Which copy of this application is running.
 *
 * Electron sets process.windowsStore on packages installed from the Microsoft
 * Store. Those update through the Store, so the application must not offer its
 * own download of an executable - both because the Store forbids it and
 * because two update paths for one program is how people end up running a
 * version nobody can account for.
 */
ipcMain.handle("app:distribution", () => (process.windowsStore ? "store" : "standalone"));

ipcMain.handle("report:read", (_e, file) => {
  try { return { ok: true, report: JSON.parse(fs.readFileSync(file, "utf8")) }; }
  catch (error) { return { ok: false, error: error.message }; }
});

/**
 * Run the CLI and stream its output to the window.
 *
 * stdout goes through as-is. Nothing is parsed for progress beyond the tick
 * lines the CLI already prints, so the live view cannot drift from what the
 * terminal shows.
 */
/**
 * Where this run's report can actually be written.
 *
 * Next to the config, which is what somebody expects, unless that folder is not
 * writable - and the first thing a new user does is Choose... into the examples
 * shipped inside the app, which live under Program Files. The run then did all
 * its work and died on the last line with a raw EPERM stack trace.
 *
 * Writability is tested by writing, not by asking. fs.accessSync(W_OK) reports
 * success on Windows directories it cannot actually be written to, because the
 * permission model it maps onto is not the one Windows uses.
 */
function reportPathFor(configPath) {
  const beside = path.dirname(configPath);
  const probe = path.join(beside, `.populace-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return { file: path.join(beside, "populace-report.json"), fellBack: false };
  } catch {
    // Named after the config's folder, so runs from different projects do not
    // overwrite each other in the fallback location.
    const dir = path.join(app.getPath("documents"), "Populace", path.basename(beside));
    fs.mkdirSync(dir, { recursive: true });
    return { file: path.join(dir, "populace-report.json"), fellBack: true, beside };
  }
}

ipcMain.handle("run:start", (_e, opts) => {
  if (current) return { ok: false, error: "A run is already going." };

  const cli = enginePath();
  if (!cli) return { ok: false, error: "The Populace engine was not found next to this app." };
  if (!opts?.config) return { ok: false, error: "Choose a config file first." };

  const args = ["run", "--config", opts.config];
  for (const [flag, value] of [
    ["agents", opts.agents], ["minutes", opts.minutes],
    ["tick", opts.tick], ["engagement", opts.engagement],
  ]) if (value) args.push(`--${flag}`, String(value));
  if (opts.cities) args.push("--cities", opts.cities);

  let target;
  try {
    target = reportPathFor(opts.config);
  } catch (error) {
    return { ok: false, error: `Nowhere to write the report: ${error.message}` };
  }
  const report = target.file;
  args.push("--report", report);
  args.push("--progress", "json");

  // The moment the run began. Anything at the report path older than this
  // belongs to somebody else's run - the examples folder ships a report from
  // ours - and showing it as this run's result would be the one lie this
  // product exists to avoid.
  const startedAt = Date.now();

  const child = spawn(process.execPath, [cli, ...args], {
    cwd: path.dirname(report),
    // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain
    // Node, so the app has no separate Node requirement on the user's machine.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env || {}) },
  });
  current = child;

  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

  // Progress events arrive interleaved with ordinary output on the same stream,
  // one JSON object per line behind a prefix. They are split out here so the
  // log stays readable and the window gets structured data.
  //
  // Buffered by line rather than by chunk: a 100-person tick is several
  // kilobytes and arrives split across reads, so parsing whatever a chunk
  // happens to contain would throw on most of them.
  let pending = "";
  child.stdout.on("data", (d) => {
    pending += d.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";     // keep the unterminated remainder
    let text = "";
    for (const line of lines) {
      if (line.startsWith(PROGRESS_PREFIX)) {
        try { send("run:progress", JSON.parse(line.slice(PROGRESS_PREFIX.length))); }
        catch { /* a truncated event is not worth interrupting a run over */ }
      } else {
        text += `${line}\n`;
      }
    }
    if (text) send("run:stdout", text);
  });
  child.stderr.on("data", (d) => send("run:stderr", d.toString()));
  child.on("close", (code) => {
    current = null;
    let fresh = null;
    try {
      if (fs.statSync(report).mtimeMs >= startedAt - 1000) fresh = report;
    } catch {
      // No report written at all, which the exit code already explains.
    }
    send("run:done", { code, report: fresh });
  });
  child.on("error", (error) => {
    current = null;
    send("run:done", { code: -1, error: error.message, report: null });
  });

  return { ok: true, report, fellBack: target.fellBack, beside: target.beside, command: `populace ${args.join(" ")}` };
});

function stopRun() {
  if (!current) return false;
  // The CLI cleans up its accounts on exit; killing the tree would strand them,
  // so this asks it to stop rather than removing it.
  try { current.kill("SIGTERM"); } catch {}
  return true;
}
ipcMain.handle("run:stop", () => ({ ok: stopRun() }));

/** One-shot CLI commands (update, explain, init --from-openapi) as text. */
ipcMain.handle("cli:run", async (_e, { args, cwd, env }) => {
  const cli = enginePath();
  if (!cli) return { ok: false, out: "The Populace engine was not found next to this app." };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: cwd || app.getPath("documents"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(env || {}) },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ ok: code === 0, code, out }));
    child.on("error", (error) => resolve({ ok: false, code: -1, out: error.message }));
  });
});
