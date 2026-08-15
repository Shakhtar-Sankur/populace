# Populace against a plain REST API

The reason this directory exists: Populace had only ever been pointed at one
real backend, and that backend was ours. A testing tool that has only tested its
author's own app has not been shown to be portable — it has been shown to work
once.

This is a second backend, deliberately unlike the first, with nothing to sign up
for.

```bash
node examples/rest-api/server.mjs                                   # terminal 1
node src/cli.mjs run --config examples/rest-api/populace.config.mjs # terminal 2
```

## Result

```
POPULACE REPORT — REST API demo
test · 6 people · 124.7s
────────────────────────────────────────────────────
✔ No failures across 430 API calls.
────────────────────────────────────────────────────
4 km · 21 posts · 64 likes · 25 comments · 26 messages · 2 joins
✔ Cleanup complete — 6 accounts removed.
```

13/13 contract methods, every one exercised.

## Why this proves something

The server disagrees with Buzz Buzz on every axis that could hide an assumption:

| | Buzz Buzz | this server |
|---|---|---|
| transport | `supabase-js` client | plain `fetch` |
| ids | UUID strings | **integers** |
| errors | `{data, error}` tuples | HTTP status + `{error}` |
| auth | session on a client object | **bearer token in a header** |
| list endpoints | rows | **bare id arrays** |
| enforcement | row-level security, in the database | application code, in the handler |

The engine cannot tell them apart. That is the claim, and this is the test of it.

## Two bugs this found in Populace itself

Neither was theoretical. Both were found by pointing the tool at something new,
and both would have hit the first stranger who tried it.

**1. The engine could not read a bare id.** It did `target.id` on whatever
`recentPostsByOthers` returned, so an API answering with `[1, 2, 3]` produced
`undefined` on every `like`. `smoke` had always been tolerant of both shapes —
so an adapter like this one **passed the smoke test and then failed on the first
tick of a real run**, which is exactly the case smoke exists to rule out.

**2. `smoke` called `createUser` with a different object than the engine.** The
contract documents `{name, phone, persona, index}`; smoke passed a flat persona
that also carried a `password`. An adapter written against either shape passed
one check and failed the other. This one only became visible because a run and
a smoke test disagreed about the same new backend.

Both are now pinned by self-tests — including one that fails if smoke and the
engine ever drift apart on that argument again.

## Using it for your own API

If your backend speaks HTTP and JSON, copy `adapter.mjs` and change the URLs.
The parts worth keeping:

- **One `call()` helper** that turns a non-2xx into a thrown `Error`. Never
  return quietly on failure — a swallowed error makes the report blame a later
  method for an earlier fault.
- **Error messages that describe the fault, not the request.** `409 on POST
  /likes` groups into one line; including the post id turns one bug into fifty.
- **`signIn`**, so `populace clean` can check for leftovers without creating
  accounts to find out whether they exist.
- **`refreshSession`**, if your tokens expire. This server's last 15 minutes on
  purpose: an adapter that skips it collapses on a longer run and the report
  blames the API.
- **A password constant.** The contract never hands you one, because only you
  know what your API accepts. It must be stable, or re-runs create new accounts
  instead of reusing them.

The server binds to `127.0.0.1` and holds everything in memory. It is a fixture,
not something to deploy.
