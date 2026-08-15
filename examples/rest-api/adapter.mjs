/**
 * An adapter for a plain REST API — the second one Populace has ever had, and
 * the reason the portability claim is more than a hope.
 *
 * Read this next to adapters/buzzbuzz.mjs. They share no library, no id type,
 * no error convention and no auth mechanism, and the engine cannot tell them
 * apart. That is the whole argument.
 *
 * If your API looks like this one — HTTP, JSON, a bearer token — you can copy
 * this file and change the URLs.
 */

export function createAdapter(target) {
  const base = target.url.replace(/\/$/, "");

  /**
   * The contract hands an adapter a name, a phone and a persona — never a
   * password. Choosing one is the adapter's job, exactly as the Buzz Buzz
   * reference adapter does, because only you know what your API will accept.
   *
   * A constant is right here: identities are deterministic so that a re-run
   * signs back in rather than piling up new accounts, and that only works if
   * the credential is stable too.
   */
  const PASSWORD = "PopulaceDemo!2026";

  /**
   * One place where HTTP becomes either a value or a thrown Error.
   *
   * Populace groups failures by shape, so the message must describe the fault
   * and not the request: "409 on /likes" tells you which endpoint is unhappy,
   * whereas including the post id would make every occurrence unique and turn
   * one bug into fifty lines in the report.
   */
  async function call(method, path, { token, body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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
      // Never swallow this. An adapter that returns on failure makes the report
      // blame a later method for an earlier fault — the exact defect Populace's
      // own first run found in its own reference adapter.
      throw new Error(`${res.status} on ${method} ${path}: ${detail}`);
    }
    return payload;
  }

  return {
    name: "rest-api-demo",

    async healthCheck() {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`health check returned ${res.status}`);
    },

    // ── identity ────────────────────────────────────────────────────────
    // Signature per adapters/contract.md: { name, phone, persona, index }.
    async createUser({ name, phone }) {
      const out = await call("POST", "/auth/signup", {
        body: { phone, password: PASSWORD, name },
      });
      // The handle is whatever later calls need. Here that is an integer id and
      // a token; for Buzz Buzz it was a UUID and a client object. The engine
      // only ever reads `.id`.
      return { id: out.id, token: out.token };
    },

    // Lets `populace clean` check for leftovers without creating accounts to
    // find out whether they exist.
    async signIn({ phone }) {
      try {
        const out = await call("POST", "/auth/signin", {
          body: { phone, password: PASSWORD },
        });
        return { id: out.id, token: out.token };
      } catch (error) {
        if (/^401/.test(error.message)) return null;   // genuinely not there
        throw error;                                    // anything else is real
      }
    },

    // The server issues 15-minute tokens. Without this a run longer than that
    // collapses at once, the report blames the API, and cleanup cannot even
    // delete its own accounts.
    async refreshSession(user) {
      const out = await call("POST", "/auth/refresh", { token: user.token });
      user.token = out.token;
      return user;
    },

    async setProfile(user, persona) {
      await call("PATCH", "/me", {
        token: user.token,
        body: { name: persona.name, city: persona.city?.name },
      });
    },

    async deleteUser(user) {
      await call("DELETE", "/me", { token: user.token });
    },

    // ── movement ────────────────────────────────────────────────────────
    async reportLocation(user, { lat, lng, distanceKm }) {
      await call("POST", "/locations", {
        token: user.token,
        body: { lat, lng, km: distanceKm },
      });
    },

    // ── social ──────────────────────────────────────────────────────────
    async post(user, body) {
      const out = await call("POST", "/posts", { token: user.token, body: { body } });
      return out.id;                     // the engine needs this for like/comment
    },

    // Returns bare integer ids, not row objects. Perfectly legal under the
    // contract, and the shape that used to break the engine.
    async recentPostsByOthers(user) {
      return await call("GET", "/posts/others", { token: user.token });
    },

    async like(user, postId) {
      await call("POST", "/likes", { token: user.token, body: { postId } });
    },

    async comment(user, postId, body) {
      await call("POST", "/comments", { token: user.token, body: { postId, body } });
    },

    // ── messaging ───────────────────────────────────────────────────────
    async openConversation(user, otherUserId) {
      const out = await call("POST", "/threads", {
        token: user.token,
        body: { otherUserId },
      });
      return out.id;
    },

    async sendMessage(user, threadId, body) {
      await call("POST", "/messages", { token: user.token, body: { threadId, body } });
    },

    // ── groups ──────────────────────────────────────────────────────────
    async listGroups(user) {
      return await call("GET", "/groups", { token: user.token });
    },

    async joinGroup(user, groupId) {
      await call("POST", "/groups/join", { token: user.token, body: { groupId } });
    },
  };
}
