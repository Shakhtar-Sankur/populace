// Adapter: Buzz Buzz — a gig-driver tracking app on Supabase.
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
        ({ data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD }));
        if (error) throw new Error(error.message);
      }
      if (!data.user) throw new Error("no user returned");

      await client.from("profiles").upsert({
        id: data.user.id,
        full_name: name,
        phone,
        updated_at: new Date().toISOString(),
      });

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
      const { error } = await user.client
        .from("post_likes")
        .upsert({ post_id: postId, user_id: user.id });
      if (error) throw error;
    },

    async comment(user, postId, text) {
      const { error } = await user.client
        .from("post_comments")
        .insert({ post_id: postId, user_id: user.id, body: text });
      if (error) throw error;
    },

    async openConversation(user, otherUserId) {
      const { data, error } = await user.client.rpc("start_direct_thread", {
        other_user_id: otherUserId,
      });
      if (error) throw error;
      return data;
    },

    async sendMessage(user, conversationId, text) {
      const { error } = await user.client.from("chat_messages").insert({
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
      const { error } = await user.client
        .from("group_members")
        .upsert({ group_id: groupId, user_id: user.id });
      if (error) throw error;
    },

    async deleteUser(user) {
      // Deliberately the app's OWN delete path, so the simulation exercises it.
      const { error } = await user.client.rpc("delete_own_account");
      if (error) throw error;
    },
  };
}
