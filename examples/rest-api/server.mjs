/**
 * A small REST API, deliberately unlike the Supabase one Populace grew up on.
 *
 * The point of this file is not the server. It is the claim it lets us test:
 * that the engine is app-agnostic. Populace had only ever been pointed at one
 * real backend, and that backend was ours — a testing tool that has only tested
 * its author's own app has not been shown to be portable.
 *
 * So every architectural choice here disagrees with Buzz on purpose:
 *
 *   Buzz / Supabase          this server
 *   ────────────────────          ───────────────────────────────
 *   supabase-js client            plain fetch over HTTP
 *   UUID string ids               INTEGER ids
 *   {data, error} tuples          HTTP status codes + {error: "..."}
 *   session object on the client  Bearer token in an Authorization header
 *   list endpoints return rows    list endpoints return BARE ID ARRAYS
 *   RLS refuses in the database   the handler refuses in application code
 *
 * The bare id arrays matter most: that shape is what caught the engine reading
 * `target.id` off a string. If this file agreed with Buzz it would prove
 * nothing.
 *
 * Zero dependencies, in-memory, and it binds to 127.0.0.1 only — it is a test
 * fixture, not something to deploy.
 *
 *   node examples/rest-api/server.mjs        # starts on :8787
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8787);

/* ── storage ───────────────────────────────────────────────────────────── */
const db = {
  users: new Map(),        // id -> { id, phone, password, name, city, deleted }
  tokens: new Map(),       // token -> { userId, expiresAt }
  posts: [],               // { id, authorId, body }
  likes: new Set(),        // `${postId}:${userId}`
  comments: [],            // { id, postId, authorId, body }
  threads: [],             // { id, a, b }
  messages: [],            // { id, threadId, senderId, body }
  groups: [{ id: 1, name: "Night shift" }, { id: 2, name: "Airport runs" }],
  members: new Set(),      // `${groupId}:${userId}`
  locations: [],           // { userId, lat, lng, km }
};

let nextId = 1;
const newId = () => nextId++;                    // INTEGER ids, not UUIDs

/* Short-lived on purpose: a run longer than this must call the refresh
   endpoint, which is how adapters that forget refreshSession get caught. */
const TOKEN_TTL_MS = 15 * 60 * 1000;

function issueToken(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  db.tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { error: 401, message: "missing bearer token" };
  const entry = db.tokens.get(token);
  if (!entry) return { error: 401, message: "unknown token" };
  if (entry.expiresAt < Date.now()) return { error: 401, message: "token expired" };
  const user = db.users.get(entry.userId);
  if (!user || user.deleted) return { error: 401, message: "account no longer exists" };
  return { user, token };
}

/* ── helpers ───────────────────────────────────────────────────────────── */
const send = (res, status, body) => {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });

/* ── routes ────────────────────────────────────────────────────────────── */
const routes = {
  "GET /health": async () => [200, { ok: true }],

  "POST /auth/signup": async (_req, body) => {
    if (!body.phone || !body.password) return [400, { error: "phone and password required" }];
    // Deterministic identities mean re-runs re-use accounts rather than piling
    // up new ones, so signup on an existing phone is a sign-in.
    const existing = [...db.users.values()].find((u) => u.phone === body.phone && !u.deleted);
    if (existing) {
      if (existing.password !== body.password) return [401, { error: "wrong password" }];
      return [200, { id: existing.id, token: issueToken(existing.id) }];
    }
    const id = newId();
    db.users.set(id, { id, phone: body.phone, password: body.password, name: body.name || "", deleted: false });
    return [201, { id, token: issueToken(id) }];
  },

  "POST /auth/signin": async (_req, body) => {
    const user = [...db.users.values()].find((u) => u.phone === body.phone && !u.deleted);
    if (!user || user.password !== body.password) return [401, { error: "invalid credentials" }];
    return [200, { id: user.id, token: issueToken(user.id) }];
  },

  "POST /auth/refresh": async (req) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const entry = token && db.tokens.get(token);
    // An EXPIRED token can still be refreshed; an unknown one cannot.
    if (!entry) return [401, { error: "unknown token" }];
    db.tokens.delete(token);
    return [200, { token: issueToken(entry.userId) }];
  },

  "PATCH /me": async (req, body, auth) => {
    auth.user.name = body.name ?? auth.user.name;
    auth.user.city = body.city ?? auth.user.city;
    return [200, { id: auth.user.id }];
  },

  "DELETE /me": async (_req, _body, auth) => {
    auth.user.deleted = true;
    for (const [t, e] of db.tokens) if (e.userId === auth.user.id) db.tokens.delete(t);
    return [204, undefined];
  },

  "POST /locations": async (_req, body, auth) => {
    if (typeof body.lat !== "number" || typeof body.lng !== "number") {
      return [400, { error: "lat and lng must be numbers" }];
    }
    db.locations.push({ userId: auth.user.id, lat: body.lat, lng: body.lng, km: body.km ?? 0 });
    return [201, { ok: true }];
  },

  "POST /posts": async (_req, body, auth) => {
    if (!body.body) return [400, { error: "body required" }];
    const id = newId();
    db.posts.push({ id, authorId: auth.user.id, body: body.body });
    return [201, { id }];
  },

  // Bare ids, not objects. This is the shape that caught the engine.
  "GET /posts/others": async (_req, _body, auth) =>
    [200, db.posts.filter((p) => p.authorId !== auth.user.id).slice(-10).map((p) => p.id)],

  "POST /likes": async (_req, body, auth) => {
    const post = db.posts.find((p) => p.id === body.postId);
    if (!post) return [404, { error: "no such post" }];
    const key = `${body.postId}:${auth.user.id}`;
    // Liking twice is a no-op, not an error. The Supabase version got this
    // wrong via upsert, and any port of that mistake would show up here.
    db.likes.add(key);
    return [201, { ok: true }];
  },

  "POST /comments": async (_req, body, auth) => {
    const post = db.posts.find((p) => p.id === body.postId);
    if (!post) return [404, { error: "no such post" }];
    const id = newId();
    db.comments.push({ id, postId: body.postId, authorId: auth.user.id, body: body.body });
    return [201, { id }];
  },

  "POST /threads": async (_req, body, auth) => {
    const other = Number(body.otherUserId);
    if (!Number.isInteger(other)) return [400, { error: "otherUserId must be an integer" }];
    if (other === auth.user.id) return [400, { error: "cannot open a thread with yourself" }];
    if (!db.users.has(other)) return [404, { error: "no such user" }];
    const found = db.threads.find(
      (t) => (t.a === auth.user.id && t.b === other) || (t.a === other && t.b === auth.user.id),
    );
    if (found) return [200, { id: found.id }];
    const id = newId();
    db.threads.push({ id, a: auth.user.id, b: other });
    return [201, { id }];
  },

  "POST /messages": async (_req, body, auth) => {
    const thread = db.threads.find((t) => t.id === Number(body.threadId));
    if (!thread) return [404, { error: "no such thread" }];
    // Refused in application code rather than by a database policy — a
    // different enforcement point from Buzz, deliberately.
    if (thread.a !== auth.user.id && thread.b !== auth.user.id) {
      return [403, { error: "not a participant in this thread" }];
    }
    const id = newId();
    db.messages.push({ id, threadId: thread.id, senderId: auth.user.id, body: body.body });
    return [201, { id }];
  },

  "GET /groups": async () => [200, db.groups.map((g) => g.id)],   // bare ids again

  "POST /groups/join": async (_req, body, auth) => {
    const group = db.groups.find((g) => g.id === Number(body.groupId));
    if (!group) return [404, { error: "no such group" }];
    db.members.add(`${group.id}:${auth.user.id}`);   // idempotent, like /likes
    return [201, { ok: true }];
  },
};

const PUBLIC = new Set(["GET /health", "POST /auth/signup", "POST /auth/signin", "POST /auth/refresh"]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (!handler) return send(res, 404, { error: `no route for ${key}` });

  try {
    const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : {};
    let auth = null;
    if (!PUBLIC.has(key)) {
      auth = authenticate(req);
      if (auth.error) return send(res, auth.error, { error: auth.message });
    }
    const [status, payload] = await handler(req, body, auth);
    send(res, status, payload);
  } catch (error) {
    send(res, 400, { error: error.message });
  }
});

// 127.0.0.1, never 0.0.0.0: this has no real authentication and must not be
// reachable from another machine.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`  demo REST API on http://127.0.0.1:${PORT}`);
  console.log(`  integer ids · bearer tokens · bare id arrays · ${TOKEN_TTL_MS / 60000}min token TTL`);
});

export { server, db };
