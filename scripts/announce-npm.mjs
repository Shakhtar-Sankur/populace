#!/usr/bin/env node
/**
 * Flip every install instruction to npm — but only once npm actually has it.
 *
 * The site, both READMEs and the product sheet currently say clone-and-run,
 * because that is what works today. This rewrites them in one pass, and refuses
 * to touch anything until it has confirmed the package is live on the registry.
 *
 * That check is the whole point. A profile README here once told people to run
 * `npx populace demo`, which would have run an unrelated stranger's package,
 * because the instruction was written before the name was checked.
 *
 *   node scripts/announce-npm.mjs            # verify, then rewrite
 *   node scripts/announce-npm.mjs --dry-run  # show what would change
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const root = path.join(repo, "..");
const dry = process.argv.includes("--dry-run");

const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const NAME = pkg.name;

const OLD = "git clone https://github.com/Shakhtar-Sankur/populace && cd populace && node src/cli.mjs demo";
const NEW = `npx ${NAME} demo`;

// Every file that carries an install instruction a stranger might follow.
const TARGETS = [
  path.join(repo, "README.md"),
  path.join(root, "gigzen-website", "index.html"),
  path.join(root, "gigzen-website", "populace.html"),
  path.join(root, "gigzen-website", "product-sheet.html"),
  path.join(root, "portfolio-site", "index.html"),
];

async function isLive() {
  const url = `https://registry.npmjs.org/${NAME.replace("/", "%2F")}`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return { live: false, why: "not on the registry yet" };
    if (!res.ok) return { live: false, why: `registry returned ${res.status}` };
    const body = await res.json();
    const latest = body["dist-tags"]?.latest;
    if (!latest) return { live: false, why: "no published version" };
    return { live: true, version: latest };
  } catch (err) {
    return { live: false, why: `could not reach the registry (${err.cause?.code || err.message})` };
  }
}

const check = await isLive();
if (!check.live) {
  console.error(`\n  ✖ Not rewriting anything.\n`);
  console.error(`    ${NAME} is ${check.why}.`);
  console.error(`    Publish first — see PUBLISHING.md — then run this again.\n`);
  process.exit(1);
}

console.log(`\n  ${NAME}@${check.version} is live on npm.\n`);

let changed = 0;
for (const file of TARGETS) {
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = before.split(OLD).join(NEW);
  if (after === before) continue;
  const hits = before.split(OLD).length - 1;
  console.log(`   ${dry ? "would update" : "updated"}  ${path.relative(root, file)}  (${hits}×)`);
  if (!dry) fs.writeFileSync(file, after);
  changed += 1;
}

console.log(
  changed
    ? `\n  ${dry ? "Would rewrite" : "Rewrote"} ${changed} file(s). Commit, push, and check the live pages.\n`
    : `\n  Nothing to change — no file carried the old instruction.\n`,
);
