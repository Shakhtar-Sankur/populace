# Changelog

Notable changes to Populace. Dates are the day the work landed.

This file records what *broke* as well as what was added. A changelog that
only lists features is a marketing document, and the argument for this tool is
that a report should tell you what went wrong.

Newest first. **This file has a hole in it:** `1.0.0` went to npm on 21 August
and Studio shipped 1.0.1 through 1.0.9 between the 22nd and the 24th, none of
which were written up here. Rather than reconstruct nine releases from memory
and risk getting them wrong, the gap is left visible.

## engine 1.2.0 · Studio 1.0.11 — 26 August 2026

Reported as *"the page is stuck at zero"*, twice, by someone watching a real run
— and both times it was fair.

### Fixed

- **The Live screen had no way to show the sign-up phase.** Bringing 250 people
  to life takes minutes, and for all of it the window read `tick 0/0`, zero
  calls, zero people, an empty progress bar — beside a clock already counting
  down *"28:09 left"*. The log pane scrolled names the whole time, so nothing
  was actually wrong: the engine was working and 148 accounts already existed.
  The window simply had nothing to say, because the progress stream carried no
  event until the first tick. A screen indistinguishable from a hung one is a
  run people kill.

  Putting the map on screen at launch (1.0.10) fixed the visual half of this and
  left every number at zero, which was half a fix.

### Added

- `progress.joining()` — one event per person as they sign in, carrying who and
  how far through. The count climbs, the bar tracks sign-up instead of sitting
  at zero, the panel names whoever just arrived, and the clock says
  **signing in** rather than inventing a countdown. Before any tick exists there
  is nothing to project from, so a remaining time was fabrication.

The engine moves to 1.2.0 rather than 1.1.1 because the progress stream gained
an event type. Studio bundles the engine directly, and shipping something that
calls itself 1.1.0 while differing from the 1.1.0 on npm would make the version
mean two things.

**Not yet on npm.** `@gigzen/populace@1.1.0` is the published engine; 1.2.0 ships
inside Studio 1.0.11 and needs a `npm publish` to reach anyone else.

## engine 1.1.0 · Studio 1.0.10 — 24 August 2026

Found by running 250 simulated drivers for twenty simulated minutes against a
local backend, and watching the window from behind other windows — which is how
anybody actually watches a run that long.

### Fixed

- **The Live screen froze every number whenever the window was not visible.**
  Counters were written only by a `requestAnimationFrame` tween, and Chromium
  does not run those for a hidden window, so each figure stopped at whatever it
  held when the window went behind another one. Measured during the run above:
  the screen read 86,492 API calls while the engine was reporting 131,825. The
  tick counter kept working purely by accident — `"147/600"` is not a plain
  number, so it skipped the tween and was written directly. A monitoring window
  showing stale figures beside a correct one is the exact failure this tool
  exists to find, and it would have shipped. Fixed in two places: the window no
  longer lets Electron throttle it in the background, and counters no longer
  depend on a frame ever being painted.
- **The map was an empty rectangle for the whole sign-up phase.** The coastline
  was drawn from inside the per-tick paint, so a panel headed *where they are*
  showed nothing until the first tick — about two and a half minutes at 250
  people, which reads as broken rather than as waiting. The world is now drawn
  when the window opens.
- **A rate-limited sign-up was recorded as a failure.** Auth endpoints are
  throttled far harder than the rest of an API; Supabase's default is 30
  sign-ups per five minutes per address. A 250-person run signed in 35 people
  and reported the other 215 as failures — an accusation about the app under
  test based on an error that says nothing about it. Refusals *for going too
  fast* are now waited out and retried, and each wait is announced so a pause
  cannot be mistaken for a hang. Failures carry a `throttled` flag so the two
  causes stay apart in the report. A genuine error is still never retried:
  waiting out a finding would hide it.

### Added

- `signupStaggerMs`, `signupRateLimitBackoffMs` and `signupRateLimitRetries` in
  config, with `--stagger <ms>` on the command line. The gap between sign-ups
  had been hardcoded at 400ms since the beginning, so a target throttling harder
  than 2.5 sign-ups a second could not be tested at all without editing this
  package's source. The engine's own comment anticipated the problem and then
  did not expose the control.
- `examples/buzzbuzz-local` — a self-contained config for running at a scale a
  hosted project's rate limits refuse. Self-contained on purpose: Studio passes
  a config path and no environment, so a config reading `process.env` works from
  a shell and silently targets `undefined` when launched from the desktop.
- Four self-tests covering the above; the suite is now 101 checks.

### Known

- `minutes` is *simulated* time, not wall-clock. 20 minutes at a 2-second tick
  is 600 ticks, and with 250 people a tick costs several real seconds — so that
  run took about 70 actual minutes. The field is now labelled, and the Live
  clock projects the real finish once it has measured a few ticks, but the two
  numbers still surprise people.

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
