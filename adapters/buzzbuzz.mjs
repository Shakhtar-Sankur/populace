// Adapter: Buzz — a gig-driver tracking app on Supabase.
//
// Populace's first customer, and the reference implementation. Read this
// alongside contract.md to see what a complete adapter looks like: it is ~140
// lines, and it is the ONLY file in the system that knows these table names.
//
// Every call goes through the normal client with the publishable key, as a real
// authenticated user, so row-level security and triggers apply exactly as they
// do for a real driver. No service-role key, no direct database access.

import { createClient } from "@supabase/supabase-js";

const PASSWORD = "SimDriver!2026";
// Matches the app's own phone→email scheme (SupabaseService.phoneToEmail).
const phoneToEmail = (phone) => `${String(phone).replace(/\D/g, "") || "driver"}@masaya.local`;

export function createAdapter(target) {
  const url = target.url?.replace(/\/$/, "");
  const key = target.key;

  if (!url || !key) {
    throw new Error(
      "buzzbuzz adapter needs target.url and target.key.\n" +
        "  Set BUZZBUZZ_TEST_URL and BUZZBUZZ_TEST_KEY in your environment.",
    );
  }

  return {
    name: "buzzbuzz",

    // supabase-js RETURNS network errors rather than throwing, so without this
    // a wrong URL looks identical to "that account doesn't exist" — and a run
    // would cheerfully report failures that were really a typo.
    async healthCheck() {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: key },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status >= 500) throw new Error(`server returned ${res.status}`);
    },

    /**
     * Cleanup capability: does this identity exist, without creating it?
     *
     * `clean` used to reach accounts through createUser, which signs UP when
     * the identity is absent — so tidying an already-clean project wrote a row
     * to the customer's auth table for every agent, purely to prove the table
     * was empty. This is the read-only path.
     *
     * Returns the user when present, null when definitively absent. A transport
     * failure throws, because "I could not look" must never be recorded as
     * "there was nothing there".
     */
    async signIn({ phone }) {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.signInWithPassword({
        email: phoneToEmail(phone),
        password: PASSWORD,
      });
      if (!error) return data.user ? { ...data.user, client } : null;

      // Supabase answers a non-existent account and a wrong password with the
      // same message. Both mean "no simulated account we can act on"; anything
      // else is a real fault and must surface.
      if (/invalid login credentials|email not confirmed/i.test(error.message)) return null;
      throw new Error(error.message);
    },

    async createUser({ name, phone, persona }) {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const email = phoneToEmail(phone);

      let { data, error } = await client.auth.signUp({
        email,
        password: PASSWORD,
        options: { data: { full_name: name, phone } },
      });
      if (error) {
        // Already exists from an earlier run — reuse it rather than piling up.
        const signUpError = error;
        ({ data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD }));
        if (error) {
          // Report BOTH, because the fallback's error is usually the misleading
          // one. This threw a bare "Invalid login credentials" for two nights of
          // debugging: the real cause was signUp being refused — a rate limit
          // after many runs in one hour — and the sign-in then failing simply
          // because the account had never been created. The message named the
          // symptom and hid the cause, which sent the diagnosis the wrong way
          // twice. Losing the first error to report the second is exactly the
          // fault this tool exists to catch, in our own reference adapter.
          throw new Error(`${error.message} (signup first failed: ${signUpError.message})`);
        }
      }
      if (!data.user) throw new Error("no user returned");

      // Check this. It used to be fire-and-forget, so when the profile row
      // failed to insert the run carried on and every later post and group-join
      // died on a foreign key instead — the report blamed `post` for a fault
      // that happened during signup. An unchecked error is the exact thing this
      // tool exists to catch, and it was in our own reference adapter.
      // INSERT, not upsert — mirroring the app. An upsert touches `phone`, and
      // ON CONFLICT DO UPDATE needs SELECT on the columns it touches, which
      // privacy_lockdown deliberately removes for that column. A duplicate just
      // means this persona signed up on an earlier run.
      const { error: profileError } = await client.from("profiles").insert({
        id: data.user.id,
        full_name: name,
        phone,
        updated_at: new Date().toISOString(),
      });
      if (profileError && profileError.code !== "23505") {
        throw new Error(`profile row not created: ${profileError.message}`);
      }

      return { id: data.user.id, client, persona };
    },

    // Supabase access tokens are short-lived (1 hour by default). We refresh
    // EXPLICITLY rather than letting supabase-js do it in the background:
    // autoRefreshToken is a timer we cannot see, whereas an explicit call is
    // timed and counted like everything else, so a refresh that starts failing
    // shows up in the report instead of quietly poisoning the whole run.
    async refreshSession(user) {
      const { data, error } = await user.client.auth.refreshSession();
      if (error) throw new Error(error.message);
      if (!data?.session) throw new Error("refresh returned no session");
    },

    async setProfile(user, persona) {
      await user.client.from("driver_settings").upsert({
        user_id: user.id,
        active_app: persona.platform,
        base_rate: persona.rate,
        vehicle_type: persona.vehicle ?? "car",
        share_stats: true,
        updated_at: new Date().toISOString(),
      });
    },

    async reportLocation(user, { lat, lng, distanceKm, earnings, platform }) {
      await user.client.from("worker_locations").upsert({
        user_id: user.id,
        lat,
        lng,
        accuracy: 5 + Math.random() * 8,
        active_app: platform,
        today_distance_km: Number(distanceKm.toFixed(2)),
        today_earnings: Number(earnings.toFixed(2)),
        updated_at: new Date().toISOString(),
      });
      await user.client.from("route_points").insert({
        user_id: user.id,
        lat,
        lng,
        accuracy: 8,
        active_app: platform,
        recorded_at: new Date().toISOString(),
      });
    },

    async post(user, text) {
      const { data, error } = await user.client
        .from("feed_posts")
        .insert({ user_id: user.id, body: text })
        .select("id")
        .single();
      if (error) throw error;
      return data?.id;
    },

    async recentPostsByOthers(user, limit = 10) {
      const { data } = await user.client
        .from("feed_posts")
        .select("id,user_id")
        .neq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((p) => ({ id: p.id, userId: p.user_id }));
    },

    async like(user, postId) {
      // Mirrors the app: insert, and treat a duplicate as success. post_likes
      // has no UPDATE policy, so an upsert on a repeat like is refused by RLS.
      const { error } = await user.client
        .from("post_likes")
        .insert({ post_id: postId, user_id: user.id });
      if (error && error.code !== "23505") throw error;
    },

    async comment(user, postId, text) {
      const { error } = await user.client
        .from("post_comments")
        .insert({ post_id: postId, user_id: user.id, body: text });
      if (error) throw error;
    },

    async openConversation(user, otherUserId) {
      // The function signature is start_direct_thread(p_other uuid). PostgREST
      // resolves RPCs by argument NAME, so passing other_user_id looked like a
      // missing function rather than a wrong argument.
      const { data, error } = await user.client.rpc("start_direct_thread", {
        p_other: otherUserId,
      });
      if (error) throw error;
      return data;
    },

    async sendMessage(user, conversationId, text) {
      // chat_messages.id is a text primary key the client supplies — the app
      // generates one per message, and the adapter was sending none at all.
      const { error } = await user.client.from("chat_messages").insert({
        id: `msg_${crypto.randomUUID()}`,
        thread_id: conversationId,
        sender_id: user.id,
        body: text,
        status: "sent",
      });
      if (error) throw error;
    },

    async listGroups(user) {
      const { data } = await user.client.from("groups").select("id").limit(10);
      return data ?? [];
    },

    async joinGroup(user, groupId) {
      // Mirrors the app: ignoreDuplicates so this is ON CONFLICT DO NOTHING.
      // A plain upsert takes the UPDATE path on a repeat join, and there is no
      // UPDATE policy on group_members — which is the failure this adapter
      // surfaced on a 644-call run.
      const { error } = await user.client
        .from("group_members")
        .upsert({ group_id: groupId, user_id: user.id }, { ignoreDuplicates: true });
      if (error) throw error;
    },

    async deleteUser(user) {
      // Deliberately the app's OWN delete path, so the simulation exercises it.
      const { error } = await user.client.rpc("delete_own_account");
      if (error) throw error;
    },
  };
}
