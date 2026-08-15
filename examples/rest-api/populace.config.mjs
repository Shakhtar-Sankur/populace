/**
 * Populace against a plain REST API.
 *
 * Two terminals:
 *
 *   node examples/rest-api/server.mjs
 *   node src/cli.mjs run --config examples/rest-api/populace.config.mjs
 *
 * Nothing to sign up for and nothing to configure — the server is in this
 * repository, holds everything in memory, and forgets it all when you stop it.
 */

export default {
  app: "REST API demo",
  adapter: "./adapter.mjs",
  environment: "test",

  target: {
    url: process.env.REST_DEMO_URL || "http://127.0.0.1:8787",
  },

  // The demo server binds to loopback and has no real authentication, so it
  // cannot be a production host. The guard is here anyway: an empty denylist
  // warns loudly, and "the config I copied had nothing in it" is the likeliest
  // way someone ends up pointing this at something real.
  neverRunAgainst: [
    "https://api.example.com",
    "https://production",
  ],

  population: {
    agents: 6,
    cities: ["manila", "mumbai"],
    minutes: 2,
    tickSeconds: 3,
  },

  identity: { phonePrefix: "0700" },
  report: { path: "populace-report.json" },
};
