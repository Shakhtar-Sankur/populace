# Contributing

## Run it first

```bash
node src/selftest.mjs        # 78 checks, no backend needed
node src/cli.mjs demo        # the whole product against a fake app
```

`demo` **exits non-zero on purpose** — the demo app has a seeded defect and
Populace is supposed to find it. A clean exit there is the failure case.

## The one rule that matters

**The engine must never learn your app.** `src/engine/` knows how to be a
person; everything app-specific lives in an adapter. If app logic leaks into
the engine, Populace has collapsed back into a test script.

Two things follow from that:

- **No runtime dependencies.** CI installs nothing. If the suite ever needs
  `npm ci` to pass, that claim is broken.
- **No assumptions about ids, errors or auth.** They have already bitten us:
  the engine once read `target.id` from a list that contained bare integers.
  `examples/rest-api/` exists to catch exactly this, and it disagrees with the
  Supabase adapter on every axis it can.

## A report may never claim more than it earned

This is the product's whole argument, so changes here get the most scrutiny:

- An unimplemented method is **untested**, never **passed**.
- A failure to reach the API is **not** evidence that an account is gone.
- Retry time never folds into latency; it would make p50/p95 unpublishable.
- A bug inside Populace is reported, not swallowed.

## Tests

Add a check to `src/selftest.mjs` for anything you fix. Then **verify the check
fails with your fix reverted** — a regression test that cannot fail proves
nothing, and we have shipped one of those before.

CI runs the suite plus the demo, checks the HTML report stays self-contained,
and asserts a fresh scaffold refuses to run *and explains why*. That last one
previously passed on the exit code alone while the tool printed a raw
`TypeError`, which is why it now asserts the message too.

## Style

Match the file you are in. Comments explain **why**, especially when the
obvious thing is wrong — most comments in this codebase exist because
something surprising happened, and the next person deserves to know what.
