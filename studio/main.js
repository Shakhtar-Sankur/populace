// Populace Studio — the desktop shell.
//
// It does not reimplement anything. Every run is the same `populace` CLI a
// person would type, spawned as a child process, and every number on screen is
// read from the report that run wrote. That means the window can never disagree
// with the terminal, and a fix in the engine arrives here for free.
//
// It also means the engine keeps its zero runtime dependencies: Electron's
// weight is entirely in this package and never reaches what ships to npm.

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

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

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
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
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

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

  const report = path.join(path.dirname(opts.config), "populace-report.json");
  args.push("--report", report);

  const child = spawn(process.execPath, [cli, ...args], {
    cwd: path.dirname(opts.config),
    // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain
    // Node, so the app has no separate Node requirement on the user's machine.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env || {}) },
  });
  current = child;

  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  child.stdout.on("data", (d) => send("run:stdout", d.toString()));
  child.stderr.on("data", (d) => send("run:stderr", d.toString()));
  child.on("close", (code) => {
    current = null;
    send("run:done", { code, report: fs.existsSync(report) ? report : null });
  });
  child.on("error", (error) => {
    current = null;
    send("run:done", { code: -1, error: error.message, report: null });
  });

  return { ok: true, report, command: `populace ${args.join(" ")}` };
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
