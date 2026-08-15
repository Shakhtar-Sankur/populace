/**
 * Adapter template — REST API with a bearer token.
 *
 * This is not a sketch. It is the adapter from examples/rest-api/, which has
 * been run against a live server: 430 API calls, 0 failures, 13/13 methods.
 * Every URL and field name below is marked EDIT — change those and the wiring
 * around them already works.
 *
 * Start it up and see for yourself before you change anything:
 *
 *   node examples/rest-api/server.mjs
 *   populace smoke --config examples/rest-api/populace.config.mjs
 *
 * Two rules, both in adapters/contract.md:
 *   1. Never point this at production.
 *   2. Go through your real API. No admin keys, no direct database writes — a
 *      simulation that bypasses your permission rules proves nothing about
 *      whether they work.
 */

export function createAdapter(target, config) {
  const base = target.url.replace(/\/$/, "");

  /**
   * The contract hands you a name, a phone and a persona — never a password.
   * Choosing one is your job, because only you know what your API accepts.
   *
   * It must be STABLE. Identities are deterministic so that a re-run signs
   * back into the same accounts instead of piling up new ones, and that only
   * works if the credential is stable too.
   */
  const PASSWORD = "PopulaceSim!2026";           // EDIT if your rules differ

  /**
   * One place where HTTP becomes either a value or a thrown Error.
   *
   * Two things here matter more than they look:
   *
   * NEVER RETURN QUIETLY ON FAILURE. An adapter that swallows an error makes
   * the report blame a later method for an earlier fault. Populace's own first
   * run found exactly that bug in its own reference adapter: the report said
   * "post failed 14 times" when the truth was "the profile row was never
   * created".
   *
   * DESCRIBE THE FAULT, NOT THE REQUEST. Failures are grouped by shape, so
   * "409 on POST /likes" collapses into one line. Put the post id in the
   * message and one bug becomes fifty.
   */
  async function call(method, path, { token, body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),   // EDIT: header scheme
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 204) return undefined;

    const text = await res.text();
    let payload;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }

    if (!res.ok) {
      const detail = payload?.error || text.slice(0, 120) || "no body";
      throw new Error(`${res.status} on ${method} ${path}: ${detail}`);
    }
    return payload;
  }

  return {
    name: "my-app",                                             // EDIT

    // doctor calls this, so an unreachable target is caught before you spend
    // a run finding out.
    async healthCheck() {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) });   // EDIT
      if (!res.ok) throw new Error(`health check returned ${res.status}`);
    },

    // ── identity ────────────────────────────────────────────────────────
    // REQUIRED. The argument is exactly this shape; see adapters/contract.md.
    // Return a HANDLE — you get it back as `user` on every later call, so put
    // the token, session or client on it. The engine only ever reads `.id`.
    async createUser({ name, phone, persona, index }) {
      const out = await call("POST", "/auth/signup", {          // EDIT
        body: { phone, password: PASSWORD, name },              // EDIT: field names
      });
      return { id: out.id, token: out.token };                  // EDIT: response shape
    },

    // Optional but worth it: lets `populace clean` check for leftover accounts
    // without CREATING them to find out whether they exist. Return null when
    // the account genuinely is not there, and throw for anything else — the
    // difference is what stops "I could not look" being reported as "nothing
    // was there".
    async signIn({ phone }) {
      try {
        const out = await call("POST", "/auth/signin", {        // EDIT
          body: { phone, password: PASSWORD },
        });
        return { id: out.id, token: out.token };
      } catch (error) {
        if (/^401/.test(error.message)) return null;
        throw error;
      }
    },

    // IMPLEMENT THIS IF YOUR TOKENS EXPIRE. Populace calls it periodically.
    // Without it, any run longer than your token lifetime collapses all at
    // once, the report blames your API for what were really expired tokens,
    // and cleanup cannot delete its own accounts — leaving simulated people
    // in your environment.
    async refreshSession(user) {
      const out = await call("POST", "/auth/refresh", { token: user.token });   // EDIT
      user.token = out.token;
      return user;
    },

    async setProfile(user, persona) {
      await call("PATCH", "/me", {                              // EDIT
        token: user.token,
        body: { name: persona.name, city: persona.city?.name },
      });
    },

    // REQUIRED. The path almost nobody exercises, and the one regulators ask
    // about.
    async deleteUser(user) {
      await call("DELETE", "/me", { token: user.token });       // EDIT
    },

    // ── movement ────────────────────────────────────────────────────────
    // Usually the heaviest sustained write load an app takes. Delete if your
    // product has no location.
    async reportLocation(user, { lat, lng, distanceKm, earnings, platform }) {
      await call("POST", "/locations", {                        // EDIT
        token: user.token,
        body: { lat, lng, km: distanceKm },
      });
    },

    // ── social ──────────────────────────────────────────────────────────
    // Must return the new post's id, or `like` and `comment` have nothing to
    // act on.
    async post(user, text) {
      const out = await call("POST", "/posts", { token: user.token, body: { body: text } });  // EDIT
      return out.id;
    },

    // Return an array. Objects with an `id`, or bare ids — both are accepted.
    // This is the call that catches a feed leaking other people's rows.
    async recentPostsByOthers(user, limit) {
      return await call("GET", "/posts/others", { token: user.token });          // EDIT
    },

    async like(user, postId) {
      await call("POST", "/likes", { token: user.token, body: { postId } });     // EDIT
    },

    async comment(user, postId, text) {
      await call("POST", "/comments", { token: user.token, body: { postId, body: text } });   // EDIT
    },

    // ── messaging ───────────────────────────────────────────────────────
    async openConversation(user, otherUserId) {
      const out = await call("POST", "/threads", {              // EDIT
        token: user.token,
        body: { otherUserId },
      });
      return out.id;                                            // conversation id
    },

    async sendMessage(user, conversationId, text) {
      await call("POST", "/messages", {                         // EDIT
        token: user.token,
        body: { threadId: conversationId, body: text },
      });
    },

    // ── groups ──────────────────────────────────────────────────────────
    async listGroups(user) {
      return await call("GET", "/groups", { token: user.token });               // EDIT
    },

    async joinGroup(user, groupId) {
      await call("POST", "/groups/join", { token: user.token, body: { groupId } });  // EDIT
    },
  };
}
