// Build the Windows installers, with the application's own identity on them.
//
//   node build/make-installers.mjs
//
// Why this exists rather than a plain `electron-builder --win`.
//
// electron-builder stamps the icon and version resources onto the executable
// with rcedit, in a step gated by `signAndEditExecutable`. That step first
// unpacks its winCodeSign bundle, which contains macOS symlinks
// (darwin/10.12/lib/libssl.dylib). Windows refuses to create symbolic links
// without SeCreateSymbolicLink - Developer Mode or an elevated shell - so
// extraction fails and the whole build dies, on a machine that is not signing
// anything and does not want a single file from darwin/.
//
// Turning the flag off gets a build. It also silently drops the stamping, and
// the result is an application that reports itself to Windows as:
//
//     ProductName  Electron        CompanyName  GitHub, Inc.
//     FileVersion  43.4.1
//
// That is what Task Manager shows, what the file properties dialog shows, and
// what Windows quotes back in security prompts. Shipping it would mean handing
// people a binary that does not know its own name.
//
// Pre-extracting the bundle by hand does not help: electron-builder unpacks to
// a freshly randomised directory on every run and never sees it.
//
// So the stamping happens here instead, in three steps: package the app, run
// rcedit ourselves against the one file that needs it, then build the
// installers from that already-prepared directory. rcedit is lifted out of the
// same bundle electron-builder downloads, minus the macOS half it chokes on.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(studio, "package.json"), "utf8"));
const unpacked = path.join(studio, "dist", "win-unpacked");
const exe = path.join(unpacked, `${pkg.build.productName}.exe`);

const run = (cmd, args, label) => {
  console.log(`\n── ${label}`);
  execFileSync(cmd, args, { cwd: studio, stdio: "inherit", shell: process.platform === "win32" });
};

/**
 * rcedit, extracted from electron-builder's own cache.
 *
 * `-xr!darwin` is the whole trick: the macOS payload is the only part that
 * cannot be unpacked here, and nothing in it is wanted on Windows.
 */
function rcedit() {
  const cache = path.join(os.homedir(), "AppData", "Local", "electron-builder", "Cache", "winCodeSign");
  const found = fs.existsSync(cache)
    ? fs.readdirSync(cache)
        .map((d) => path.join(cache, d, "rcedit-x64.exe"))
        .find((p) => fs.existsSync(p))
    : null;
  if (found) return found;

  const archive = fs.existsSync(cache) && fs.readdirSync(cache).find((f) => f.endsWith(".7z"));
  if (!archive) {
    throw new Error(
      "rcedit was not found and there is no winCodeSign archive to take it from.\n" +
      "Run `npx electron-builder --win --dir` once to populate the cache, then run this again.",
    );
  }

  const dest = path.join(cache, path.basename(archive, ".7z"));
  const sevenZip = path.join(studio, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  console.log(`── extracting rcedit from ${path.basename(archive)} (skipping darwin/)`);
  execFileSync(sevenZip, ["x", path.join(cache, archive), `-o${dest}`, "-xr!darwin", "-y"], { stdio: "ignore" });

  const tool = path.join(dest, "rcedit-x64.exe");
  if (!fs.existsSync(tool)) throw new Error(`no rcedit-x64.exe inside ${archive}`);
  return tool;
}

// 1. The application directory, without any stamping.
run("npx", ["electron-builder", "--win", "--dir"], "packaging the application");

// 2. Its identity. Everything Windows reads about a program lives here.
const tool = rcedit();
console.log(`\n── stamping ${path.basename(exe)}`);
execFileSync(tool, [
  exe,
  "--set-icon", path.join(here, "icon.ico"),
  "--set-version-string", "ProductName", pkg.build.productName,
  "--set-version-string", "FileDescription", pkg.build.productName,
  "--set-version-string", "CompanyName", pkg.author,
  "--set-version-string", "LegalCopyright", `Copyright (C) 2026 ${pkg.author}`,
  "--set-version-string", "InternalName", pkg.build.productName,
  "--set-version-string", "OriginalFilename", `${pkg.build.productName}.exe`,
  "--set-file-version", pkg.version,
  "--set-product-version", pkg.version,
], { stdio: "inherit" });

// 3. The installers, built around the executable we just stamped.
run("npx", ["electron-builder", "--win", "--prepackaged", "dist/win-unpacked"], "building the installers");

console.log(`\nBuilt ${pkg.build.productName} ${pkg.version}:`);
for (const f of fs.readdirSync(path.join(studio, "dist")).filter((f) => f.endsWith(".exe"))) {
  const { size } = fs.statSync(path.join(studio, "dist", f));
  console.log(`  ${f}  ${(size / 1048576).toFixed(0)} MB`);
}
