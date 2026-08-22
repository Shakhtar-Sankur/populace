// The only bridge between the window and the machine.
//
// Deliberately narrow. The renderer has no Node, no filesystem and no child
// processes — it can call exactly the functions below and nothing else. A
// testing tool that runs with your staging credentials should not also ship a
// browser window with unrestricted local access.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("populace", {
  enginePath: () => ipcRenderer.invoke("engine:path"),

  pickConfig: () => ipcRenderer.invoke("dialog:pickConfig"),
  pickSpec: () => ipcRenderer.invoke("dialog:pickSpec"),

  startRun: (opts) => ipcRenderer.invoke("run:start", opts),
  stopRun: () => ipcRenderer.invoke("run:stop"),
  readReport: (file) => ipcRenderer.invoke("report:read", file),
  cli: (args, cwd, env) => ipcRenderer.invoke("cli:run", { args, cwd, env }),

  showItem: (file) => ipcRenderer.invoke("shell:showItem", file),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  // Streams. Each returns an unsubscribe so a screen can stop listening.
  onStdout: (fn) => {
    const h = (_e, text) => fn(text);
    ipcRenderer.on("run:stdout", h);
    return () => ipcRenderer.off("run:stdout", h);
  },
  onStderr: (fn) => {
    const h = (_e, text) => fn(text);
    ipcRenderer.on("run:stderr", h);
    return () => ipcRenderer.off("run:stderr", h);
  },
  onDone: (fn) => {
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on("run:done", h);
    return () => ipcRenderer.off("run:done", h);
  },
});
