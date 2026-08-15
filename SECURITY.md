# Security

## Reporting

Email **sankur.kundu.tw@gmail.com** with "Populace security" in the subject.
Please do not open a public issue for anything exploitable. Expect a first
response within a few days; this is currently maintained by one person, and
saying so is more useful than promising an SLA that will not be met.

## What Populace does on your systems

It is worth being precise, because this tool **creates real accounts and writes
real rows**.

- It signs up users, posts content, sends messages and joins groups through
  **your API**, as genuinely authenticated users.
- It deletes every account it created, and `populace clean` finds any left
  behind by a run that died.
- It goes through the front door only: **no admin keys, no service-role
  credentials, no direct database writes.** A simulation that bypasses your
  permission rules proves nothing about whether they work.

## Never point it at production

Three independent guards, all exiting non-zero:

1. `environment` must declare a non-production value. Opt in, never assumed.
2. `neverRunAgainst` is checked against every string in your target, however
   deeply nested. One match and the run is refused — **no flag overrides it**.
3. An empty denylist warns loudly, because "I forgot to fill that in" is the
   likeliest version of this mistake.

## Credentials

Populace never asks for, stores or transmits credentials beyond the target
config you supply. Keep that config out of version control. The `key` in an
adapter target should be a **publishable/anon key** — the same one your client
app ships — never a service-role key.
