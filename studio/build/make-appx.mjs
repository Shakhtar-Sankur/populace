// Build the Microsoft Store package.
//
//   node build/make-appx.mjs
//
// Two things have to be arranged before electron-builder can do it on this
// machine, and both were found the hard way.
//
// 1. The packaging tools it bundles are from 2018. On Windows 11 its makepri
//    crashes outright (access violation), and its makeappx cannot be started
//    by Node at all. The Windows SDK ships working copies of both, so the
//    toolchain is staged from there.
//
// 2. Those tools will not run from %LOCALAPPDATA%. The identical binary, same
//    SHA-256, starts from C:\ebcache and fails under AppData\Local with "the
//    application has failed to start because its side-by-side configuration is
//    incorrect" - so something on this machine blocks side-by-side loading
//    from the user cache. electron-builder's cache root is therefore moved
//    somewhere it is allowed to execute.
//
// Neither is a Populace problem, and neither is guessable from the error
// electron-builder prints, which is "spawn UNKNOWN".

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, "..");

const CACHE = process.env.ELECTRON_BUILDER_CACHE || "C:\\ebcache";
const STAGED = path.join(CACHE, "winCodeSign", "winCodeSign-2.6.0");
const TOOLS = path.join(STAGED, "windows-10", "x64");

/** The newest Windows SDK build tools on this machine. */
function sdkTools() {
  const root = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!fs.existsSync(root)) return null;
  const versions = fs.readdirSync(root)
    .filter((d) => /^10\.\d/.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const v of versions.reverse()) {
    const dir = path.join(root, v, "x64");
    if (fs.existsSync(path.join(dir, "makeappx.exe"))) return dir;
  }
  return null;
}

if (!fs.existsSync(path.join(TOOLS, "makeappx.exe"))) {
  const sdk = sdkTools();
  if (!sdk) {
    console.error(
      "The Windows SDK is not installed, so there is no makeappx.exe to package with.\n" +
      "Install it from https://developer.microsoft.com/windows/downloads/windows-sdk/ and run this again.",
    );
    process.exit(1);
  }
  console.log(`staging the SDK toolchain from ${sdk}`);
  fs.mkdirSync(TOOLS, { recursive: true });
  // The whole folder: the tools resolve private side-by-side assemblies out of
  // subdirectories beside them, so copying only the executables is not enough.
  fs.cpSync(sdk, TOOLS, { recursive: true });
}

console.log(`packaging with the cache at ${CACHE}`);
execFileSync("npx", ["electron-builder", "--win", "appx", "--publish", "never"], {
  cwd: studio,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ELECTRON_BUILDER_CACHE: CACHE },
});

const appx = fs.readdirSync(path.join(studio, "dist")).find((f) => f.endsWith(".appx"));
if (appx) {
  const { size } = fs.statSync(path.join(studio, "dist", appx));
  console.log(`\n${appx} — ${(size / 1048576).toFixed(0)} MB`);
  console.log("Unsigned on purpose: the Store signs the package on submission.");
}
