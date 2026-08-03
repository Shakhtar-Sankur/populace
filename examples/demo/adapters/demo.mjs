// A pretend app, so Populace can be evaluated in ten seconds with no backend.
//
// It stores everything in memory and fakes plausible network latency. One
// endpoint is deliberately slow and one deliberately flaky, so the report has
// something real to say — which is the point of the demo. A demo where
// everything passes teaches you nothing about what the tool is for.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latency = (base, spread) => sleep(base + Math.random() * spread);

export function createAdapter() {
  const db = { users: new Map(), posts: [], likes: 0, comments: 0, messages: 0, groups: [{ id: "riders" }, { id: "couriers" }] };
  let likeCalls = 0;

  return {
    name: "demo",

    async healthCheck() {
      await latency(20, 30);
    },

    async createUser({ name, phone }) {
      await latency(80, 120);
      const id = `u_${phone}`;
      db.users.set(id, { id, name });
      return { id, name };
    },

    async setProfile() {
      await latency(30, 40);
    },

    async reportLocation() {
      await latency(15, 25);
    },

    async post(user, text) {
      await latency(40, 60);
      const post = { id: `p${db.posts.length}`, userId: user.id, text };
      db.posts.push(post);
      return post.id;
    },

    // Deliberately the slow one: an unindexed feed query is the single most
    // common thing a simulation like this uncovers.
    async recentPostsByOthers(user, limit = 10) {
      await latency(180, 320);
      return db.posts.filter((p) => p.userId !== user.id).slice(-limit);
    },

    // Deliberately the broken one: a permission rule that rejects some writes.
    async like() {
      await latency(25, 35);
      likeCalls += 1;
      if (likeCalls % 4 === 0) {
        throw new Error(`new row violates row-level security policy "post_likes_insert"`);
      }
      db.likes += 1;
    },

    async comment() {
      await latency(35, 45);
      db.comments += 1;
    },

    async openConversation() {
      await latency(50, 70);
      return "thread_1";
    },

    async sendMessage() {
      await latency(30, 40);
      db.messages += 1;
    },

    async listGroups() {
      await latency(25, 30);
      return db.groups;
    },

    async joinGroup() {
      await latency(40, 50);
    },

    async deleteUser(user) {
      await latency(60, 80);
      db.users.delete(user.id);
    },
  };
}
