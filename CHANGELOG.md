# Changelog

Notable changes to Populace. Dates are the day the work landed.

This file records what *broke* as well as what was added. A changelog that
only lists features is a marketing document, and the argument for this tool is
that a report should tell you what went wrong.

## 0.1.0 — 15 August 2026

First release on npm as `@gigzen/populace`.

### The engine

- Concurrent simulated people who sign up, move through real cities, post,
  like, comment, message and join groups — as genuinely authenticated users,
  through your own API, with your own permission rules applying.
- **Zero runtime dependencies.** Adapters bring their own.
- A 13-method adapter contract; two methods required, everything else optional
  and reported as untested rather than quietly passing.
- Per-endpoint p50/p95/p99 latency, failures grouped by shape rather than by
  exact text, so one bug is one line instead of fifty.
- Deadlines on every adapter call, so a hung endpoint becomes a line in the
  report instead of a run that stops moving.
- Transport failures separated from API failures — a flaky network is not
  reported as a bug in your code.
- Three independent refusals to run against production, all exiting non-zero.

### Commands

- `demo` — the whole product against an in-memory app with a seeded defect.
  Exits non-zero, because it finds it.
- `init` — scaffolds a **working** REST adapter. `--blank` for the empty
  contract.
- `doctor` — config, reachability and coverage, without running anything.
- `smoke` — calls every implemented method once and checks the answers.
- `run`, `clean`.

### Fixed before release

- **The engine could not read a bare identifier.** It read `target.id` from
  whatever the feed returned, so an API answering `[1, 2, 3]` produced
  `undefined` on every like and join. `smoke` had always accepted both shapes,
  so such an adapter passed the smoke test and then failed on the first tick of
  a real run — the exact case smoke exists to rule out.
- **`smoke` called `createUser` with a different object than the engine.** The
  contract documents `{name, phone, persona, index}`; smoke passed a flat
  persona carrying a password the engine never supplies. An adapter written
  against either shape passed one check and failed the other.
- **`clean` under-counted.** It took its identity count from the config, so
  after `run --agents 10` against a config declaring 8, a bare `clean` checked
  only 8 and printed an all-clear. Had that run died before its own cleanup,
  two accounts would have survived the command meant to guarantee they had not.
- **A scaffolded adapter failed with a `TypeError`.** `populace doctor` on a
  fresh `init`, before setting a target, printed
  `Cannot read properties of undefined (reading 'replace')` instead of saying
  what to do.
- **`joinGroup` used an upsert.** `ON CONFLICT DO UPDATE` on a table with no
  `UPDATE` policy meant re-joining a group you were already in failed. Third
  appearance of the same upsert mistake.

### Verified

- 78 self-tests against an in-memory adapter, in CI on Node 18 and 22.
- Two architecturally unrelated backends: a Supabase app (2,030 calls at ten
  concurrent users, 0 failures) and a plain REST API with integer ids, bearer
  tokens and bare id arrays (430 calls, 0 failures).

### Known limits

- **Populace has only been pointed at backends written by its own authors.**
  The engine is demonstrably not shaped around one stack, but no third party
  has used it yet.
- Runs so far are correctness runs, not load tests. The largest was ten
  concurrent users for ten minutes.
- Populace measures what a *client* sees. A database error that is caught,
  retried, or still returns 2xx is invisible to it.
