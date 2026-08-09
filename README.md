# Populace

**A simulated population that uses your app through its real API — so you can test what needs more than one person.**

You cannot test presence, live sync, read receipts, notification fan-out, or
"does deleting this remove it for everyone" while being only one human. And a
social app with nobody in it tells you nothing about how it feels to use.

Populace gives you a few dozen believable people who sign up, move around, post,
like, comment, message each other and join groups — as **real authenticated
users**, through **your own API**, with **your own permission rules applying**.
Then it hands you a report on what broke.

```
  POPULACE REPORT — Demo App
  test · 6 people · 80.6s
────────────────────────────────────────────────────────────────────────
  ✖ Problems found:
      · 3.8% of API calls failed.
────────────────────────────────────────────────────────────────────────
  YOUR API UNDER 6 CONCURRENT USERS
    method                  calls  fails      p50      p95
    ✖like                      55     13     47ms     63ms
        ↳ 13× new row violates row-level security policy "post_likes_insert"
     reportLocation           132      0     31ms     47ms
     recentPostsByOthers       57      0    374ms    467ms
     ...
  ✔ Cleanup complete — 6 accounts removed.
```

Two things that report found without being told where to look: a permission rule
that rejects one in four writes, and a feed query running 8× slower than every
other endpoint.

---

## Try it in ten seconds

No backend, no signup, nothing of yours touched — the demo adapter fakes a small
app in memory.

```bash
populace demo
```

The demo app has a real bug in it: a row-level-security policy that rejects
likes. Watch the report find it, name the policy, and exit non-zero. That exit
code is the whole point — the run fails your build rather than telling you it
went fine.

Two files land in whatever directory you ran it from: `populace-report.json` for
CI, and `populace-report.html`, which is one self-contained page you can email
to someone who was not watching your terminal.

---

## Point it at your own app

```bash
populace init      # scaffolds populace.config.mjs + adapters/my-app.mjs
populace doctor    # checks config, reachability and coverage WITHOUT running
populace run
populace clean     # removes every account a run created
```

You write **one adapter** — thirteen small methods, each answering "how does
this happen in my app?". Two are required (`createUser`, `deleteUser`);
everything else is optional and anything you skip is reported as untested rather
than quietly passing. Full spec in [adapters/contract.md](adapters/contract.md),
and [adapters/buzzbuzz.mjs](adapters/buzzbuzz.mjs) is a complete real-world
example in ~150 lines.

`populace doctor` on a fresh scaffold says `2/13` and refuses to run — a method
that exists but does nothing is not coverage.

**If your API uses expiring tokens, implement `refreshSession`.** Without it,
any run longer than your token lifetime collapses at once and the report blames
your API for what were really expired tokens — and the run cannot even delete
its own accounts, stranding simulated users in your environment. See it happen:
`node examples/token-expiry/expiry-demo.mjs`

---

## The safety guard

Populace creates real accounts and writes real rows. Pointed at production it
would put invented people in front of paying customers. So it refuses to start
in three independent ways:

1. **`environment` must declare a non-production value.** Opt in, never assumed.
2. **`neverRunAgainst` is checked against every string in your target** — however
   deeply nested. One match and the run is refused; no flag overrides it.
3. **An empty denylist warns loudly**, because "I forgot to fill that in" is the
   likeliest version of this mistake.

Refusals exit non-zero, so CI catches them too.

The same principle runs through the contract: **go through the front door**. Use
the API your app actually uses — not admin keys, not service-role credentials,
not direct database writes. A simulation that bypasses your permission rules
proves nothing about whether they work, and permission bugs are exactly what a
multi-user simulation is best at finding.

---

## What you get

- **A populated app** instead of an empty one — the cold-start problem, solved for demos and for judging your own UX
- **Multi-user paths exercised** without recruiting humans: presence, receipts, realtime fan-out, membership counts
- **Permission rules tested by users who genuinely have different identities**
- **Latency per endpoint** (p50/p95/p99/max) under N concurrent users
- **Failures grouped by shape**, not exact text, so one bug is one line rather than fifty
- **Account deletion actually tested** — the path almost nobody exercises and the one regulators ask about
- **`populace-report.json`** for CI; the run exits non-zero when problems are found
- **`populace-report.html`** beside it — one self-contained file, no scripts and nothing
  fetched from the network, for the people who were not watching the terminal

---

## What it will not tell you

**Whether people want your product.** These people are generated from patterns.
They will never surprise you the way a real customer does, they cannot tell you
your onboarding is confusing or your pricing is wrong, and they are least
accurate for exactly the users least represented online.

Use Populace to prove your app **works**. Use real people to decide what to
**build**. A report full of green ticks means your API held up — not that anyone
wants what you made.

---

## Design notes

- **The engine never learns your app.** `src/engine/` knows how to be a person;
  everything app-specific lives in an adapter. If app logic ever leaks into the
  engine, Populace has collapsed back into a test script.
- **Zero runtime dependencies.** Adapters bring their own.
- **Deterministic identities.** Agent *n* always gets the same phone number, so
  re-runs reuse accounts instead of piling up new ones — and `populace clean`
  can find them after a run that crashed halfway.
- **Cheap by default.** Scripted agents cost nothing, so hundreds can run at
  once. If you later want genuinely emergent conversation, put an LLM behind a
  tier — a handful of expensive agents among many cheap ones, the way games vary
  NPC detail.
- **Concurrent, not sequential.** Everyone acts at once, because sequential
  agents never surface a race condition.

```bash
npm test   # runs the whole product against an in-memory app — no backend needed
```
