// Telling "your API said no" apart from "we never reached your API".
//
// This distinction is the difference between a report a customer trusts and one
// they argue with. A dropped socket is not a bug in their code, and a tool that
// reports it as one will be dismissed the first time it cries wolf. Equally, a
// 500 from their server IS their bug and must never be quietly retried away.
//
// So the rule is narrow on purpose: only failures that happened BELOW the HTTP
// layer count as transport. Anything the server actually answered — any status
// code at all — is the application's, and is reported exactly once.

const TRANSPORT = [
  "fetch failed", // undici's blanket wrapper; cause carries the detail
  "ENOTFOUND", // DNS did not resolve
  "EAI_AGAIN", // DNS temporary failure
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "UND_ERR", // undici's own timeouts (connect, headers, body)
  "socket hang up",
  "network",
  "Client network socket disconnected",
];

/**
 * True when a call failed without the server ever answering.
 *
 * Matches against `cause.code` first — undici hides the real reason there and
 * flattens everything to the message "fetch failed", which on its own tells you
 * nothing.
 */
export function isTransportError(error) {
  if (!error) return false;
  if (error.isTimeout) return true; // our own deadline: no answer arrived
  const text = String(
    error.cause?.code || error.code || error.cause?.message || error.message || error,
  );
  return TRANSPORT.some((t) => text.toLowerCase().includes(t.toLowerCase()));
}

/**
 * Exponential backoff with jitter.
 *
 * Jitter matters here more than usual: Populace runs N agents in lockstep on a
 * tick, so a blip tends to hit all of them at once. Without jitter they would
 * retry in unison and hammer an already-struggling API in synchronised waves —
 * turning a small outage into a self-inflicted load test.
 */
export function backoffMs(attempt, base = 250, cap = 4000) {
  const exponential = Math.min(cap, base * 2 ** (attempt - 1));
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops retrying once the target is clearly gone rather than merely flaky.
 *
 * Retries fix a flaky link and make a dead one agonising: every call costs the
 * full deadline times every attempt, so a run against an unreachable host
 * crawls for twenty minutes and then produces nothing. Observed exactly that —
 * the retry fix removed the hang and replaced it with a grind.
 *
 * So: after `threshold` transport failures in a row with no success in between,
 * the breaker opens. Calls then fail immediately, the run ends early, and the
 * report says the target became unreachable — in seconds instead of the best
 * part of an hour.
 *
 * Any single success closes it again. A brief outage in the middle of an
 * otherwise fine run must not abort that run; only a sustained one should.
 */
export class CircuitBreaker {
  constructor({ threshold = 12 } = {}) {
    this.threshold = threshold;
    this.consecutive = 0;
    this.open = false;
    this.openedAfter = null;
  }

  recordSuccess() {
    this.consecutive = 0;
    this.open = false;
  }

  /** @returns {boolean} true when this failure was the one that opened it. */
  recordTransportFailure() {
    if (this.threshold <= 0) return false; // disabled
    this.consecutive += 1;
    if (!this.open && this.consecutive >= this.threshold) {
      this.open = true;
      this.openedAfter = this.consecutive;
      return true;
    }
    return false;
  }

  /** An application error says the server IS answering, so the link is alive. */
  recordApiFailure() {
    this.recordSuccess();
  }
}

export class TargetUnreachableError extends Error {
  constructor(consecutive) {
    super(
      `Target became unreachable — ${consecutive} consecutive calls failed at the network ` +
        `level with no response. Stopping rather than retrying for the rest of the run.`,
    );
    this.name = "TargetUnreachableError";
    this.isTransport = true;
    this.circuitOpen = true;
  }
}
