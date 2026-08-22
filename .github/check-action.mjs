// Checks that action.yml is a well-formed composite action and, more
// importantly, that no input is interpolated into a shell block.
//
// A workflow input is attacker-controllable on a fork pull request. Pasting
// `${{ inputs.cities }}` straight into `run:` is a shell injection; passing it
// through `env:` and reading `$POPULACE_CITIES` is not. That is easy to get
// right once and easy to undo later without noticing, so it is asserted.
//
// This lives in a file rather than inline in the workflow because the first
// version was a `node -e` one-liner whose backslashes had to survive Python,
// YAML and the shell, and it did not.
//
//   node .github/check-action.mjs

import fs from "node:fs";

const y = fs.readFileSync("action.yml", "utf8");
const problems = [];

for (const need of ["using: composite", "name: Populace", "outputs:", "inputs:"]) {
  if (!y.includes(need)) problems.push(`action.yml is missing "${need}"`);
}

// Walk the `run: |` blocks by indentation. The naive version split on the first
// "run: |" and scanned to end of file, which flagged
// `working-directory: ${{ inputs.working-directory }}` on a later step — a
// legitimate use — and failed a clean action.
const lines = y.split("\n");
let indent = null;
lines.forEach((line, i) => {
  const open = line.match(/^(\s*)run:\s*\|/);
  if (indent === null) {
    if (open) indent = open[1].length;
    return;
  }
  const isBlank = line.trim() === "";
  const depth = line.match(/^\s*/)[0].length;
  if (!isBlank && depth <= indent) {
    indent = open ? open[1].length : null;
    return;
  }
  if (/\$\{\{\s*inputs\./.test(line)) {
    problems.push(`line ${i + 1}: an input is interpolated inside a run block — pass it through env instead\n    ${line.trim()}`);
  }
});

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log("action.yml is well formed, and every input reaches the shell through env.");
