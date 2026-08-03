# Writing an adapter

The engine knows how to be a *person*: where they go, how chatty they are, when
they take a break, who they talk to. It knows nothing about your app.

An **adapter** is the translation layer. For each thing a simulated person can
do, it answers one question: *"how does that happen in my product?"*

```js
export function createAdapter(target, config) {
  return { name: "your-app", /* methods below */ };
}
```

`target` is whatever you put in `target` in `populace.config.mjs`.

---

## The contract

Thirteen methods. Two are required; the rest are optional, and anything you
leave out is skipped rather than failing. A read-only app can implement three
and get a useful run.

| Method | | What it exercises in your app |
|---|---|---|
| `createUser({name, phone, persona, index})` | **required** | sign-up, sign-in, first-contact |
| `setProfile(user, persona)` | | the settings a new user configures |
| `refreshSession(user)` | **read this** | token refresh — see below |
| `reportLocation(user, {lat, lng, distanceKm, earnings, platform})` | | high-frequency writes — the heaviest sustained load most apps take |
| `post(user, text)` → `postId` | | content creation |
| `recentPostsByOthers(user, limit)` → `[{id, userId}]` | | feed reads under concurrent writes, and whether permissions leak |
| `like(user, postId)` | | high-contention writes on shared rows |
| `comment(user, postId, text)` | | nested content and its notifications |
| `openConversation(user, otherUserId)` → `conversationId` | | conversation creation between accounts that have never met |
| `sendMessage(user, conversationId, text)` | | delivery, ordering, receipts, realtime fan-out |
| `listGroups(user)` → `[{id}]` | | shared-resource reads |
| `joinGroup(user, groupId)` | | membership writes and counter accuracy |
| `deleteUser(user)` | **required** | account deletion and cascade |
| `healthCheck()` | optional | lets `populace doctor` verify the target before a run |

`createUser` returns a **handle** — put the session, token or client on it. You
get that same object back as `user` on every later call.

---

## Two rules

**1. Never point an adapter at production.**

Populace refuses in three independent ways — `environment` must declare a
non-production value, `neverRunAgainst` is checked against every string in your
target, and an empty denylist warns loudly. Your adapter should fail loudly too.
Simulated people appearing to real users is deception, not testing.

**2. Go through the front door.**

Use the same API your app uses. Not admin keys, not service-role credentials,
not direct database writes. A simulation that bypasses your permission rules
proves nothing about whether they work — and permission bugs are exactly what a
multi-user simulation is best at finding.

The same applies to `deleteUser`: prefer your app's own delete-account path over
a hard delete. It is the route almost nobody tests and the one regulators ask
about.

---

## Sessions expire — implement `refreshSession`

If your API uses short-lived access tokens (most do), implement this. It is
optional only because some APIs don't need it.

Populace calls it every 30 minutes by default — tune with
`session.refreshEveryMinutes`. If it throws, the agent signs in again from
scratch rather than going quietly dead.

Skipping it on an app with a 1-hour token means any run longer than an hour
collapses at once, and the report blames **your API** for failures that were
really expired tokens. Worse: `deleteUser` needs a live session too, so the run
cannot clean up after itself and leaves simulated accounts stranded in your
environment.

Measured on a pretend app with a 3-second token, same population, same duration:

| | no `refreshSession` | with it |
|---|---|---|
| API calls failed | 45 of 65 (**69%**) | 0 of 90 (**0%**) |
| location writes accepted | 9 | 48 |
| accounts left behind | **4** | 0 |

Reproduce it yourself: `node examples/token-expiry/expiry-demo.mjs`

---

## Re-runs

Identities are deterministic — agent *n* always gets the same phone number.
`createUser` should therefore **sign in** if the account already exists rather
than creating a second one. This is what lets `populace clean` find and remove
accounts after a run that crashed halfway.

---

## What you get back

A `populace-report.json` and a terminal summary:

- every failure, grouped by shape rather than exact text, with counts
- p50 / p95 / p99 / max latency per method under N concurrent users
- which contract methods you did **not** implement, and what each would have tested
- whether cleanup actually succeeded

---

## What it will not tell you

Whether people *want* your product. Simulated users are generated from patterns;
they will not surprise you the way a real customer does, and they are least
accurate for exactly the users least represented online.

Use Populace to prove your app **works**. Use real people to decide what to
**build**.
