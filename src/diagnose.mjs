// What `populace doctor` decides, separated from how it prints.
//
// The decision used to live inside the command, interleaved with console.log
// and process.exitCode, which meant the one thing that stops a customer running
// a useless simulation — "are you actually ready?" — could not be tested
// without spawning a process and matching strings. This is the judgement on its
// own, as data.

import { canSignInOnly, coverageOf } from "./contract.mjs";

/**
 * @param {object}  o
 * @param {object}  o.config      loaded config
 * @param {object}  o.adapter     the raw adapter
 * @param {boolean|null} o.reachable  true / false / null when not checked
 * @returns {{coverage, cleanup, guarded, blockers: string[], ready: boolean}}
 */
export function diagnose({ config, adapter, reachable = null }) {
  const coverage = coverageOf(adapter);
  const blockers = [];

  // Order matters only for the message; both are reported when both apply.
  if (reachable === false) blockers.push("the target is unreachable");

  const missingRequired = coverage.missing.filter((c) => c.required);
  if (missingRequired.length) {
    blockers.push(
      `${missingRequired.map((c) => c.method).join(" and ")} ` +
        `${missingRequired.length > 1 ? "are" : "is"} required`,
    );
  }

  return {
    coverage,
    cleanup: canSignInOnly(adapter) ? "read-only" : "create-then-delete",
    guarded: (config?.neverRunAgainst || []).length,
    blockers,
    ready: blockers.length === 0,
  };
}
