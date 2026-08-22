// Turn an OpenAPI description into a filled-in adapter.
//
// Writing the adapter is the wall. Thirteen methods against someone else's API
// is the half-hour where a new user either gets a run or gives up, and it is
// the reason a tool that works has no users outside the company that wrote it.
// Most serious APIs already describe themselves; this reads that description
// and fills in what it can.
//
// It is deliberately a GUESS, and says so. Every match carries a confidence and
// the evidence behind it, and anything it is unsure of is left as the template's
// default with a TODO. A generator that quietly guessed wrong would be worse
// than no generator: the run would fail and the adapter would look finished.
//
// JSON only. Populace has no runtime dependencies and a YAML parser would be
// the first, for a convenience that `npx js-yaml` covers in one command.

import fs from "node:fs";

/**
 * What each contract method looks like in a REST API, as scoring signals.
 *
 * `verb`  the HTTP method it almost certainly is
 * `path`  words that appear in the URL, best first
 * `words` words in the operationId, summary or tags
 * `avoid` path fragments meaning this is a different endpoint in similar clothes.
 *         Checked against the PATH ONLY. An earlier version also checked the
 *         summary, which rejected `POST /conversations` because its description
 *         read "start a direct message thread" — the correct answer, thrown out
 *         by a word in its own prose.
 */
const SIGNALS = {
  createUser: {
    verb: "post",
    path: ["signup", "sign-up", "register", "registration", "auth/users", "users", "accounts"],
    words: ["signup", "register", "create user", "create account"],
    avoid: ["login", "signin", "sign-in", "refresh", "verify", "reset"],
  },
  refreshSession: {
    verb: "post",
    path: ["refresh", "token/refresh", "auth/token", "token"],
    words: ["refresh", "renew token", "access token"],
    avoid: ["revoke", "signup", "register"],
  },
  setProfile: {
    verb: "patch",
    path: ["profile", "me", "users", "account"],
    words: ["update profile", "profile", "update user", "edit"],
    avoid: ["password", "avatar", "delete", "settings/notification"],
  },
  deleteUser: {
    verb: "delete",
    path: ["users", "account", "me", "profile"],
    words: ["delete account", "delete user", "remove user", "close account"],
    avoid: ["post", "comment", "message", "group"],
  },
  reportLocation: {
    verb: "post",
    path: ["location", "locations", "position", "track", "ping", "telemetry", "gps"],
    words: ["location", "position", "track", "heartbeat", "ping"],
    avoid: [],
  },
  post: {
    verb: "post",
    path: ["posts", "feed", "statuses", "tweets", "entries"],
    words: ["create post", "new post", "publish", "compose"],
    avoid: ["comment", "like", "reply", "report"],
  },
  recentPostsByOthers: {
    verb: "get",
    path: ["feed", "posts", "timeline", "statuses", "entries"],
    words: ["feed", "timeline", "list posts", "recent"],
    avoid: ["comment", "like", "my", "mine", "draft"],
  },
  like: {
    verb: "post",
    path: ["like", "likes", "reactions", "favourite", "favorite", "upvote"],
    words: ["like", "react", "favourite", "favorite", "upvote"],
    avoid: ["unlike", "dislike", "remove"],
  },
  comment: {
    verb: "post",
    path: ["comments", "replies", "comment"],
    words: ["comment", "reply"],
    avoid: ["delete", "list", "edit"],
  },
  openConversation: {
    verb: "post",
    path: ["conversations", "threads", "chats", "dm", "rooms"],
    words: ["conversation", "thread", "start chat", "direct message", "room"],
    avoid: ["/messages", "/send", "/read", "/typing"],
  },
  sendMessage: {
    verb: "post",
    path: ["messages", "message", "send"],
    words: ["send message", "message", "post message"],
    avoid: ["/read", "/typing", "/receipts"],
  },
  listGroups: {
    verb: "get",
    path: ["groups", "communities", "channels", "teams"],
    words: ["list groups", "groups", "communities", "channels"],
    avoid: ["member", "join", "leave", "create"],
  },
  joinGroup: {
    verb: "post",
    path: ["join", "members", "membership", "subscribe"],
    words: ["join group", "join", "add member", "subscribe"],
    avoid: ["leave", "remove", "kick", "list"],
  },
};

export const CONTRACT_METHODS = Object.keys(SIGNALS);

/** Every operation in the document, flattened. */
function operations(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths || {})) {
    if (!item || typeof item !== "object") continue;
    for (const verb of ["get", "post", "put", "patch", "delete"]) {
      const op = item[verb];
      if (!op) continue;
      out.push({
        verb,
        path,
        operationId: op.operationId || "",
        summary: op.summary || "",
        description: (op.description || "").slice(0, 200),
        tags: op.tags || [],
      });
    }
  }
  return out;
}

function score(op, sig) {
  const path = op.path.toLowerCase();
  const text = `${op.operationId} ${op.summary} ${op.tags.join(" ")}`.toLowerCase();
  const why = [];
  let n = 0;

  for (const bad of sig.avoid) {
    if (path.includes(bad)) return { n: -1, why: [`excluded: path contains "${bad}"`] };
  }

  // Path is the strongest signal, and earlier entries are better matches.
  sig.path.forEach((word, i) => {
    if (path.includes(word)) {
      const points = 10 - Math.min(i, 6);
      n += points;
      why.push(`path contains "${word}"`);
    }
  });

  if (op.verb === sig.verb) { n += 4; why.push(`${op.verb.toUpperCase()} matches`); }
  // PUT and PATCH are used interchangeably for updates often enough to allow.
  else if (sig.verb === "patch" && op.verb === "put") { n += 3; why.push("PUT accepted for PATCH"); }
  else n -= 3;

  for (const word of sig.words) {
    if (text.includes(word)) { n += 3; why.push(`described as "${word}"`); }
  }

  // A shallow path is likelier to be the main resource than a deep one.
  n -= Math.max(0, op.path.split("/").filter(Boolean).length - 3);

  // Did anything about the URL itself suggest this method? A verb alone must
  // never be enough: with only that, every GET in a document matched
  // recentPostsByOthers and listGroups, so a spec containing nothing but
  // /health produced two confident-looking matches.
  const hadPathSignal = why.some((w) => w.startsWith("path contains"));

  return { n, why, hadPathSignal };
}

/**
 * Match each contract method to its best operation.
 *
 * Confidence is deliberately coarse. Anything below `low` is reported as no
 * match at all rather than dressed up, because a wrong path that looks
 * confident costs more to debug than an obvious blank.
 */
export function match(doc) {
  const ops = operations(doc);
  const results = {};

  for (const [method, sig] of Object.entries(SIGNALS)) {
    let best = null;
    for (const op of ops) {
      const { n, why, hadPathSignal } = score(op, sig);
      // A path signal is mandatory, not just helpful.
      if (!hadPathSignal || n < 7) continue;
      if (!best || n > best.n) best = { op, n, why };
    }
    const confidence = !best ? "none" : best.n >= 12 ? "high" : best.n >= 9 ? "medium" : "low";
    results[method] = best && confidence !== "none"
      ? { ...best, confidence }
      : { op: null, n: 0, why: ["nothing in the spec looked like this"], confidence: "none" };
  }
  return { operationCount: ops.length, results };
}

/** Read a spec from disk, refusing YAML with a sentence rather than a stack trace. */
export function load(specPath) {
  const raw = fs.readFileSync(specPath, "utf8");
  const looksYaml = /\.ya?ml$/i.test(specPath) || /^\s*(openapi|swagger)\s*:/m.test(raw);
  if (looksYaml && !raw.trimStart().startsWith("{")) {
    throw new Error(
      `${specPath} looks like YAML. Populace has no runtime dependencies, so it does not ship a\n` +
      `  YAML parser. Convert it once and point at the JSON:\n\n` +
      `    npx js-yaml ${specPath} > openapi.json\n`,
    );
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${specPath} is not valid JSON: ${error.message}`);
  }
  if (!doc.paths || typeof doc.paths !== "object") {
    throw new Error(`${specPath} has no "paths" object, so it is not an OpenAPI description.`);
  }
  return doc;
}

/**
 * Rewrite the REST template's call lines with the matched paths.
 *
 * The template is deliberately one `call(VERB, PATH, ...)` per method, so this
 * is a targeted substitution rather than code generation. Everything the
 * template already gets right — error handling, token plumbing, the refusal to
 * return quietly on failure — is left exactly as it is.
 */
/**
 * The identifier each method already has in scope, for filling path parameters.
 *
 * Without this, a matched path like /posts/{postId}/likes was written into the
 * adapter as a literal string, and the adapter then requested that URL verbatim.
 * Broken — but broken in a way that looks finished, which is the worst kind.
 */
const PATH_VAR = {
  like: "postId",
  comment: "postId",
  sendMessage: "conversationId",
  joinGroup: "groupId",
  openConversation: "otherUserId",
  setProfile: "user.id",
  deleteUser: "user.id",
  refreshSession: "user.id",
};

/** `/posts/{postId}/likes` → a template literal, or the raw string if we cannot fill it. */
function pathExpression(rawPath, method) {
  const params = [...rawPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (!params.length) return { code: JSON.stringify(rawPath), unresolved: [] };

  const variable = PATH_VAR[method];
  if (!variable) return { code: JSON.stringify(rawPath), unresolved: params };

  // One parameter is the common case and safe to fill. Two or more means a
  // nested resource whose second id this method does not have in scope, so it
  // is left visible rather than guessed at.
  if (params.length > 1) return { code: JSON.stringify(rawPath), unresolved: params.slice(1) };

  return { code: "`" + rawPath.replace(/\{[^}]+\}/, "${" + variable + "}") + "`", unresolved: [] };
}

export function fill(template, matches) {
  let out = template;
  const applied = [];
  const needsHand = [];

  for (const [method, m] of Object.entries(matches)) {
    if (!m.op) continue;
    const verb = m.op.verb.toUpperCase();
    const { code, unresolved } = pathExpression(m.op.path, method);
    if (unresolved.length) needsHand.push({ method, path: m.op.path, params: unresolved });

    // Match: await call("POST", "/posts", ...) inside `async <method>(`
    const block = new RegExp(
      `(async ${method}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,400}?call\\()"[A-Z]+",\\s*"[^"]*"`,
    );
    if (!block.test(out)) continue;
    out = out.replace(block, `$1"${verb}", ${code}`);
    applied.push({ method, verb, path: m.op.path, confidence: m.confidence, unresolved });
  }

  // A header that tells the reader exactly how much to trust what follows.
  const banner = [
    "/**",
    " * GENERATED from an OpenAPI description by `populace init --from-openapi`.",
    " *",
    " * The paths below are a best guess made by matching endpoint names against",
    " * the thirteen contract methods. They are a starting point, not a finished",
    " * adapter: request bodies, field names and response shapes are still the",
    " * template's defaults and almost certainly need editing.",
    " *",
    " * Run `populace smoke` before anything else. It exercises each method once",
    " * and names the first one that is wrong.",
    ...(needsHand.length
      ? ["  *",
         "  * Paths still containing {braces} need filling by hand - this method has no",
         "  * variable in scope for them:",
         ...needsHand.map((h) => `  *   ${h.method}: ${h.path}`)]
      : []),
    " */",
    "",
  ].join("\n");

  return { source: banner + out, applied, needsHand };
}
