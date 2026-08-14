// populace.config.mjs
//
// Everything Populace needs to know about your app lives here and in your
// adapter. Nothing about your app should ever end up inside the engine.

export default {
  app: "My App",

  // Where the translation between "a person did something" and "your API"
  // lives. See adapters/contract.md.
  adapter: "./adapters/my-app.mjs",

  // Populace only runs against non-production environments, and it checks.
  // Lying here is possible; it is also entirely on you.
  environment: "test",

  // Handed to createAdapter(). Put whatever your adapter needs — URLs, keys,
  // a base path. Read secrets from process.env rather than committing them.
  target: {
    url: process.env.MY_APP_TEST_URL,
    key: process.env.MY_APP_TEST_KEY,
  },

  // The safety net that matters most. List every production host you own.
  // If `target` ever resolves to one of these, Populace refuses to start —
  // no flag overrides it.
  neverRunAgainst: [
    // "https://api.myapp.com",
    // "https://xxxxxxxx.supabase.co",
  ],

  // How long any single call into your adapter may take before Populace stops
  // waiting, records it as a timeout, and lets the other agents carry on.
  //
  // Without a deadline one unresponsive endpoint freezes the whole simulation
  // and you get no report at all — the run just stops moving. With one, a slow
  // endpoint shows up in the report as a timeout, which is a finding.
  //
  // Raise it if your API is legitimately slow; set 0 to disable it entirely if
  // your adapter does long work on purpose (a batch import, say).
  timeoutMs: 20_000,

  population: {
    agents: 8,
    cities: ["manila", "mumbai"], // manila · mumbai · delhi · jakarta · bangkok
    minutes: 10,
    tickSeconds: 5,
  },

  // Simulated accounts share a phone prefix so they are always identifiable —
  // and so `populace clean` can find them after a crashed run.
  identity: {
    phonePrefix: "0900",
  },

  // How often to call your adapter's refreshSession(). Keep this comfortably
  // inside your access-token lifetime; the default suits a 1-hour token.
  session: {
    refreshEveryMinutes: 30,
  },

  report: {
    path: "populace-report.json",
  },
};
