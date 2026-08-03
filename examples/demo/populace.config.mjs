// Try Populace with no backend at all:
//
//   node src/cli.mjs run --config examples/demo/populace.config.mjs --minutes 1
//
// The demo adapter fakes a small app in memory, with one slow endpoint and one
// failing one, so the report has something honest to show.

export default {
  app: "Demo App",
  adapter: "./adapters/demo.mjs",
  environment: "test",
  target: { url: "memory://demo" },
  neverRunAgainst: ["https://api.example.com"],
  population: {
    agents: 6,
    cities: ["manila", "mumbai"],
    minutes: 1,
    tickSeconds: 2,
  },
  identity: { phonePrefix: "0900" },
  report: { path: "populace-report.json" },
};
