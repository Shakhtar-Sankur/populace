// Is there a newer Populace than the one running?
//
// A version check phones home, and a testing tool that quietly makes network
// calls you did not ask for has no business asking you to trust it with your
// staging credentials. So this one is:
//
//   · explicit          `populace update` asks; a run mentions it at most once
//                       a day, after the report, never before
//   · off with one flag POPULACE_NO_UPDATE_CHECK=1, and the CI environment
//                       variable turns it off on its own
//   · silent on failure no registry, no network, a firewall — nothing is said,
//                       because a version check is never worth an error message
//   · anonymous         a plain GET to the public registry. No identifiers, no
//                       telemetry, nothing about your app or your runs
//
// Cached in the system temp directory for a day so twenty runs make one request.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PACKAGE_NAME, VERSION } from "./version.mjs";

const REGISTRY = "https://registry.npmjs.org";
const CACHE = path.join(os.tmpdir(), "populace-update-check.json");
const DAY = 24 * 60 * 60 * 1000;

/** Off in CI, and off whenever anyone says so. */
export function checksDisabled() {
  return Boolean(process.env.POPULACE_NO_UPDATE_CHECK || process.env.CI);
}

/** -1 a is older, 0 same, 1 a is newer. Plain semver; pre-release tags ignored. */
export function compare(a, b) {
  const parts = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return 1;
    if ((x[i] || 0) < (y[i] || 0)) return -1;
  }
  return 0;
}

function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    return Date.now() - c.at < DAY ? c : null;
  } catch {
    return null;
  }
}

function writeCache(latest) {
  try {
    fs.writeFileSync(CACHE, JSON.stringify({ at: Date.now(), latest }));
  } catch {
    // A read-only temp directory is not a reason to fail anything.
  }
}

/**
 * The newest published version, or null.
 *
 * Never throws and never waits long: this runs after a report a person is
 * already reading, and a version check that delays it has cost more than it
 * is worth.
 */
export async function latestVersion({ timeoutMs = 3000, useCache = true } = {}) {
  if (checksDisabled()) return null;
  if (useCache) {
    const cached = readCache();
    if (cached) return cached.latest;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // No Accept header. The abbreviated-packument type
    // (application/vnd.npm.install-v1+json) is valid on the full packument and
    // returns 406 on /latest — which this swallowed as "could not reach the
    // registry", hiding a bug behind a reassuring message.
    const res = await fetch(`${REGISTRY}/${PACKAGE_NAME}/latest`, { signal: controller.signal });
    if (!res.ok) return null;
    const { version } = await res.json();
    if (!version) return null;
    writeCache(version);
    return version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One line for the end of a report, or null when there is nothing to say. */
export async function updateNotice(options) {
  const latest = await latestVersion(options);
  if (!latest || compare(latest, VERSION) !== 1) return null;
  return `  A newer Populace is out: ${VERSION} → ${latest}   npm i -g ${PACKAGE_NAME}`;
}

/** `populace update` — the explicit check, which always says something. */
export async function updateCommand() {
  if (checksDisabled()) {
    console.log(`
  Update checks are switched off${process.env.CI ? " (CI is set)" : " (POPULACE_NO_UPDATE_CHECK is set)"}.
  Running ${PACKAGE_NAME} ${VERSION}.
`);
    return;
  }

  console.log(`\n  Running ${PACKAGE_NAME} ${VERSION}. Asking the npm registry…`);
  const latest = await latestVersion({ timeoutMs: 10000, useCache: false });

  if (!latest) {
    console.log(`
  Could not reach the registry. That is all this means — nothing is wrong with
  your install, and Populace never needs the network to run.
`);
    return;
  }

  const d = compare(latest, VERSION);
  if (d === 1) {
    console.log(`
  ${VERSION} → ${latest} is available.

    npm i -g ${PACKAGE_NAME}
    npx ${PACKAGE_NAME}@latest run

  Turn these checks off with POPULACE_NO_UPDATE_CHECK=1.
`);
  } else if (d === 0) {
    console.log(`\n  Up to date.\n`);
  } else {
    // Running ahead of the registry: a local build, or a publish still pending.
    console.log(`
  You are running ${VERSION}; the registry has ${latest}. That means this is a
  local or unpublished build, not that anything is wrong.
`);
  }
}
