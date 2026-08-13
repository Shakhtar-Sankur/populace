// One simulated person.
//
// This file knows how to BE someone — where they move, how often they post,
// when they take a break, who they talk to. It knows nothing about any
// particular app: every action goes through an adapter (adapters/contract.md).
//
// That separation is the product. Pointing the simulation at a different app
// means writing one adapter, not editing this file. If app-specific logic ever
// creeps in here, Populace has quietly collapsed back into a test script.

import { advance, buildRoute, haversineKm } from "./geo.mjs";
import { chatterFor, replyLine } from "./personas.mjs";

const chance = (p) => Math.random() < p;
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Agent {
  constructor(persona, adapter, index, options = {}) {
    this.persona = persona;
    this.adapter = adapter;
    this.index = index;

    // Deterministic identity per agent, so re-runs REUSE accounts rather than
    // leaving a trail of abandoned ones across a customer's test environment.
    const prefix = options.phonePrefix ?? "0900";
    this.phone = `${prefix}${String(1000000 + index).slice(-7)}`;

    this.route = buildRoute(persona.city, index + 1);
    this.legIndex = 0;
    this.progressKm = 0;
    this.position = this.route[0];
    this.distanceKm = 0;
    this.earnings = 0;
    this.onBreak = false;
    this.log = [];
    this.stats = { posts: 0, likes: 0, comments: 0, messages: 0, groups: 0, reauths: 0, errors: 0 };
    // Failures that did not come from the adapter — i.e. bugs in this engine.
    this.engineErrors = [];

    // Access tokens expire. A run longer than the token lifetime would see
    // every agent start failing at once — and a customer would reasonably read
    // that as THEIR API collapsing under load. Lying to someone about their own
    // system is the worst failure this product could have, so sessions are
    // refreshed on a cadence well inside any normal expiry.
    this.refreshEveryMs = options.refreshEveryMs ?? 30 * 60 * 1000;
    this.lastRefreshAt = Date.now();
  }

  note(what) {
    this.log.push(what);
    if (this.log.length > 6) this.log.shift();
  }

  /** Only call adapter methods the adapter actually implements. */
  can(method) {
    return typeof this.adapter[method] === "function";
  }

  /**
   * Ask whether this person's account exists, WITHOUT creating it.
   *
   *   user      — it exists, and we are now signed in as them
   *   null      — it definitively does not exist
   *   undefined — the adapter cannot tell us (no signIn capability)
   *
   * The three-way answer matters: cleanup must never turn "I could not look"
   * into "there was nothing there".
   */
  async findAccount() {
    if (!this.can("signIn")) return undefined;
    const user = await this.adapter.signIn({
      name: this.persona.name,
      phone: this.phone,
      persona: this.persona,
      index: this.index,
    });
    this.user = user || null;
    return user || null;
  }

  async ensureAccount() {
    this.user = await this.adapter.createUser({
      name: this.persona.name,
      phone: this.phone,
      persona: this.persona,
      index: this.index,
    });
    if (this.can("setProfile")) await this.adapter.setProfile(this.user, this.persona);
    this.lastRefreshAt = Date.now();
    this.note("signed in");
    return this.user.id;
  }

  /**
   * Keep this person's session alive.
   *
   * Two layers on purpose. A refresh is cheap and usual; re-authenticating from
   * scratch is the fallback for when the refresh token itself has gone. An
   * agent that silently 401s for the rest of a run still LOOKS busy in the
   * table while testing nothing at all, which is the failure mode this exists
   * to prevent.
   */
  async ensureFreshSession() {
    if (!this.can("refreshSession") || !this.user) return;
    if (Date.now() - this.lastRefreshAt < this.refreshEveryMs) return;

    this.lastRefreshAt = Date.now();
    try {
      await this.adapter.refreshSession(this.user);
      this.note("refreshed session");
    } catch {
      await this.ensureAccount();
      this.stats.reauths += 1;
      this.note("re-authenticated");
    }
  }

  /** One step of a life: move a little, then maybe do something social. */
  async tick(secondsPerTick, world) {
    try {
      // Before anything else — including while on a break, since a break can
      // easily outlast a token.
      await this.ensureFreshSession();

      if (this.onBreak) {
        if (chance(0.35)) {
          this.onBreak = false;
          this.note("back on the road");
        }
        return;
      }
      if (chance(this.persona.breakiness)) {
        this.onBreak = true;
        this.note("taking a break");
        return;
      }

      // --- move ---
      const km = (this.persona.speedKmh / 3600) * secondsPerTick;
      const next = advance(this.route, this.legIndex, this.progressKm, km);
      this.distanceKm += haversineKm(this.position, next.position);
      this.earnings = this.distanceKm * this.persona.rate;
      this.position = next.position;
      this.legIndex = next.legIndex;
      this.progressKm = next.progressKm;

      if (this.can("reportLocation")) {
        await this.adapter.reportLocation(this.user, {
          lat: this.position.lat,
          lng: this.position.lng,
          distanceKm: this.distanceKm,
          earnings: this.earnings,
          platform: this.persona.platform,
        });
      }

      // --- social ---
      if (chance(this.persona.postiness)) await this.post();
      if (chance(this.persona.likeliness)) await this.reactToSomeone();
      if (chance(this.persona.chattiness)) await this.chat(world);
      if (chance(0.02)) await this.joinAGroup();
    } catch (error) {
      // An adapter failure is expected material: the instrumentation wrapper has
      // already recorded it, and one person's app breaking should not end
      // everyone else's shift.
      //
      // An UNTAGGED failure never reached the adapter, so it is a bug in this
      // engine. Swallowing it silently would let Populace break and still print
      // a clean report — the same defect as the failure-rate tolerance band that
      // was removed from the verdict, and worse here, because the tool would be
      // vouching for an app it never actually exercised.
      this.stats.errors += 1;
      if (!error?.fromAdapter) {
        this.engineErrors.push(String(error?.stack || error?.message || error).slice(0, 300));
      }
      this.note(`error: ${String(error.message || error).slice(0, 60)}`);
    }
  }

  async post() {
    if (!this.can("post")) return;
    const body = chatterFor(this.persona.cityKey, this.stats.posts + this.index);
    await this.adapter.post(this.user, body);
    this.stats.posts += 1;
    this.note(`posted: ${body.slice(0, 34)}…`);
  }

  async reactToSomeone() {
    if (!this.can("recentPostsByOthers") || !this.can("like")) return;
    const posts = await this.adapter.recentPostsByOthers(this.user, 10);
    if (!posts?.length) return;
    const target = pickOne(posts);
    await this.adapter.like(this.user, target.id);
    this.stats.likes += 1;

    if (chance(0.4) && this.can("comment")) {
      const body = replyLine(this.stats.comments + this.index);
      await this.adapter.comment(this.user, target.id, body);
      this.stats.comments += 1;
      this.note(`commented "${body.slice(0, 22)}…"`);
    } else {
      this.note("liked a post");
    }
  }

  async chat(world) {
    if (!this.can("openConversation") || !this.can("sendMessage")) return;
    const others = world.agents.filter((a) => a.user && a.user.id !== this.user.id);
    if (!others.length) return;
    const other = pickOne(others);

    const conversationId = await this.adapter.openConversation(this.user, other.user.id);
    if (!conversationId) return;
    await this.adapter.sendMessage(this.user, conversationId, replyLine(this.stats.messages + this.index));
    this.stats.messages += 1;
    this.note(`messaged ${other.persona.name.split(" ")[0]}`);
  }

  async joinAGroup() {
    if (!this.can("listGroups") || !this.can("joinGroup")) return;
    const groups = await this.adapter.listGroups(this.user);
    if (!groups?.length) return;
    const group = pickOne(groups);
    await this.adapter.joinGroup(this.user, group.id);
    this.stats.groups += 1;
    this.note(`joined ${group.id}`);
  }

  /**
   * Delete this person's account, and say whether that actually happened.
   *
   * It used to return undefined on the two paths where it does nothing — no
   * deleteUser on the adapter, or no account to delete — which teardown counted
   * as a successful removal. A run could therefore report "Cleanup complete —
   * 6 accounts removed" having deleted none of them. The caller has to be able
   * to tell "done" from "there was nothing to do".
   */
  async selfDestruct() {
    if (!this.can("deleteUser")) return { deleted: false, why: "adapter has no deleteUser" };
    if (!this.user) return { deleted: false, why: "no account to delete" };
    await this.adapter.deleteUser(this.user);
    return { deleted: true };
  }
}
