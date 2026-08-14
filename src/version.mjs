// One source of truth for the version.
//
// It was written in package.json and again in report.mjs. Two copies of a
// number that must agree is a bug waiting for a release: the package says one
// thing, every report a customer keeps says another, and the mismatch surfaces
// months later when someone tries to reproduce a run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function read() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
    return { version: pkg.version, name: pkg.name };
  } catch {
    // Never let a packaging accident take down a run that is otherwise fine.
    return { version: "unknown", name: "@gigzen/populace" };
  }
}

export const { version: VERSION, name: PACKAGE_NAME } = read();
