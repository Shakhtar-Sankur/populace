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
