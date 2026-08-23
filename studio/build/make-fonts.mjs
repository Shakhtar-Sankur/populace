// Copy the two typefaces the interface uses into the app.
//
//   node build/make-fonts.mjs
//
// Bundled rather than linked. The window runs under `default-src 'none'` with
// `font-src 'self'`, so there is nothing to fetch at runtime - which is also
// the honest arrangement for a tool that runs against somebody's staging
// environment: no request leaves the machine, including for a font.
//
// Latin subsets only. Inter's full variable set is thirty files across Greek,
// Cyrillic and Vietnamese; the interface is English and the simulated people's
// names render from the system stack when they need a script Inter's latin
// subset does not carry.
//
// Inter and JetBrains Mono are both SIL Open Font Licence, which permits
// bundling. Their licences are copied alongside the files.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, "..");
const out = path.join(studio, "renderer", "fonts");
fs.mkdirSync(out, { recursive: true });

const WANTED = [
  ["@fontsource-variable/inter", "files/inter-latin-opsz-normal.woff2", "inter-var.woff2"],
  ["@fontsource/jetbrains-mono", "files/jetbrains-mono-latin-400-normal.woff2", "mono-400.woff2"],
  ["@fontsource/jetbrains-mono", "files/jetbrains-mono-latin-600-normal.woff2", "mono-600.woff2"],
];

let copied = 0;
for (const [pkg, from, to] of WANTED) {
  const src = path.join(studio, "node_modules", pkg, from);
  if (!fs.existsSync(src)) {
    console.error(`missing ${src}\nRun: npm install --save-dev ${pkg}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(out, to));
  copied++;
}

// The licences travel with the files, which is the condition of using them.
for (const [pkg, name] of [["@fontsource-variable/inter", "Inter-LICENSE.txt"],
                           ["@fontsource/jetbrains-mono", "JetBrainsMono-LICENSE.txt"]]) {
  const dir = path.join(studio, "node_modules", pkg);
  const found = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  if (found) fs.copyFileSync(path.join(dir, found), path.join(out, name));
}

const total = fs.readdirSync(out)
  .filter((f) => f.endsWith(".woff2"))
  .reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log(`fonts — ${copied} files, ${(total / 1024).toFixed(0)} KB`);
