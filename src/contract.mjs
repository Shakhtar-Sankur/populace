// The adapter contract, as data.
//
// Kept here rather than only in prose so that `populace doctor` can tell a
// customer exactly which parts of their app the simulation will and will not
// exercise — before they spend a run finding out.

export const CONTRACT = [
  {
    method: "createUser",
    required: true,
    group: "identity",
    exercises: "sign-up, sign-in, and whatever your app does on first contact with a new account",
  },
  {
    method: "setProfile",
    group: "identity",
    exercises: "the settings a new user configures before they start",
  },
  {
    method: "refreshSession",
    group: "identity",
    exercises: "token refresh — without it, any run longer than your token lifetime collapses and looks like your API failing",
  },
  {
    method: "reportLocation",
    group: "world",
    exercises: "high-frequency writes — the heaviest sustained load most apps take",
  },
  { method: "post", group: "social", exercises: "user-generated content creation" },
  {
    method: "recentPostsByOthers",
    group: "social",
    exercises: "feed reads under concurrent writes, and whether your permission rules leak",
  },
  { method: "like", group: "social", exercises: "high-contention writes on shared rows" },
  { method: "comment", group: "social", exercises: "nested content and its notifications" },
  {
    method: "openConversation",
    group: "messaging",
    exercises: "conversation creation between two accounts that have never met",
  },
  {
    method: "sendMessage",
    group: "messaging",
    exercises: "delivery, ordering, receipts, and realtime fan-out",
  },
  { method: "listGroups", group: "groups", exercises: "shared-resource reads" },
  { method: "joinGroup", group: "groups", exercises: "membership writes and counter accuracy" },
  {
    method: "deleteUser",
    required: true,
    group: "cleanup",
    exercises: "account deletion and cascade — the path almost nobody tests",
  },
];

export const CONTRACT_METHODS = CONTRACT.map((c) => c.method);

/**
 * A method that exists but does nothing is NOT coverage.
 *
 * Without this, a freshly scaffolded adapter reports 12/12 and produces a
 * clean run while testing absolutely nothing — the worst possible outcome for
 * a tool whose entire value is telling you the truth about your app.
 */
export function isStub(fn) {
  if (typeof fn !== "function") return true;
  const src = Function.prototype.toString.call(fn);
  const open = src.indexOf("{");
  const close = src.lastIndexOf("}");
  if (open === -1 || close <= open) return false; // concise arrow — real code
  const body = src
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
  if (!body) return true;
  return /^throw\s+new\s+\w*Error\s*\(\s*(["'`]).*not implemented.*\1\s*\)\s*;?$/i.test(body);
}

export function coverageOf(adapter) {
  const implemented = [];
  const missing = [];
  for (const entry of CONTRACT) {
    const fn = adapter?.[entry.method];
    (typeof fn === "function" && !isStub(fn) ? implemented : missing).push(entry);
  }
  return {
    implemented,
    missing,
    ratio: implemented.length / CONTRACT.length,
    label: `${implemented.length}/${CONTRACT.length}`,
  };
}
