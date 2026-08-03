// Your adapter.
//
// Each method answers one question: "when a simulated person does this, what
// happens in MY app?" Delete the ones that don't apply — anything you leave out
// is skipped, and `populace doctor` will tell you exactly what that costs you
// in coverage.
//
// Two rules, both in adapters/contract.md:
//   1. Never point this at production.
//   2. Go through your real API. No admin keys, no direct database writes.
//      A simulation that bypasses your permission rules proves nothing about
//      whether they work.

export function createAdapter(target, config) {
  return {
    name: "my-app",

    // Optional, but `populace doctor` uses it to check the target is up before
    // you spend a run finding out that it isn't.
    async healthCheck() {
      const res = await fetch(`${target.url}/health`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`health check returned ${res.status}`);
    },

    // --- identity (createUser is REQUIRED) --------------------------------
    // Create or re-use an account. Return a handle — you'll get it back on
    // every later call, so put the session/token/client on it.
    // Re-runs should REUSE accounts, not pile up new ones.
    async createUser({ name, phone, persona, index }) {
      // const session = await signUpOrSignIn(...)
      // return { id: session.userId, session };
      throw new Error("createUser not implemented");
    },

    async setProfile(user, persona) {},

    // If your API uses expiring access tokens, IMPLEMENT THIS. Populace calls
    // it every 30 minutes (see session.refreshEveryMinutes). Without it, a run
    // longer than your token lifetime fails everywhere at once and the report
    // blames your API — and cleanup can't run either, leaving simulated
    // accounts stranded in your environment.
    async refreshSession(user) {},

    // --- the world --------------------------------------------------------
    // Called every tick with a new position and running totals. Skip it
    // entirely if your app has no location.
    async reportLocation(user, { lat, lng, distanceKm, earnings, platform }) {},

    // --- social -----------------------------------------------------------
    // Empty bodies below are treated as NOT implemented, and `populace doctor`
    // will list them as untested rather than pretending they passed. Fill in
    // the ones your app has; delete the ones it doesn't.
    async post(user, text) {
      // return postId
    },
    async recentPostsByOthers(user, limit) {
      // return [{ id, userId }]
    },
    async like(user, postId) {},
    async comment(user, postId, text) {},

    async openConversation(user, otherUserId) {
      // return conversationId
    },
    async sendMessage(user, conversationId, text) {},

    async listGroups(user) {
      // return [{ id }]
    },
    async joinGroup(user, groupId) {},

    // --- cleanup (REQUIRED) -----------------------------------------------
    // Must fully remove the account. Prefer your app's OWN delete-account path
    // so the simulation exercises it too — it is the route almost nobody tests
    // and the one regulators ask about.
    async deleteUser(user) {
      throw new Error("deleteUser not implemented");
    },
  };
}
