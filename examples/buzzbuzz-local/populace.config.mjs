// Buzz against the local Supabase stack, at a scale the hosted project refuses.
//
// Why this file exists rather than reusing examples/buzzbuzz:
//
// The hosted test project applies Supabase's default auth rate limit of 30 sign
// ups per five minutes per IP address. Measured on 2026-08-24: a 250-driver run
// signs in 35 people and every remaining identity fails with "Request rate limit
// reached". That limit is correct for real users, who each arrive from their own
// address. A load test is the one case where every request shares a single IP,
// so it is the one case the limit cannot accommodate.
//
// The local stack raises it in supabase/config.toml, which a hosted project
// cannot do from a file. So large runs belong here.
//
// Everything is self-contained: no environment variables. Studio passes a config
// path and nothing else, so a config that reads process.env works from a shell
// and silently targets `undefined` when launched from Explorer.
//
// Start the backend first, from i-want-to-make-one-app:
//   npx supabase start
//
// Then either pick this file in Populace Studio, or:
//   node src/cli.mjs run --config examples/buzzbuzz-local/populace.config.mjs

export default {
  app: "Buzz",
  adapter: "../../adapters/buzzbuzz.mjs",
  environment: "test",

  // The local stack's fixed development address and publishable key. These are
  // the same on every machine that runs `supabase start` — they are not secrets
  // and nothing outside this computer can reach them.
  target: {
    url: "http://127.0.0.1:54321",
    key: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
  },

  // Kept identical to examples/buzzbuzz. A local run is no reason to relax the
  // guard: if one of these ever appears in `target.url` above, refuse to start.
  neverRunAgainst: [
    "https://rqzuuvlougzhynckvqzd.supabase.co",
    "https://ypdaetbeexyepswyhbui.supabase.co",
  ],

  population: {
    agents: 250,
    // The same twenty-five cities as the 200-driver run of 23 August, so head
    // count is the only variable that changed between the two.
    cities: [
      "manila", "mumbai", "delhi", "jakarta", "saopaulo",
      "mexicocity", "bogota", "lima", "lagos", "nairobi",
      "accra", "cairo", "johannesburg", "istanbul", "dubai",
      "riyadh", "moscow", "kyiv", "warsaw", "madrid",
      "almaty", "tashkent", "baku", "casablanca", "amman",
    ],
    minutes: 20,
    tickSeconds: 2,
    engagement: 4,
  },

  identity: { phonePrefix: "0900" },
  report: { path: "populace-report.json" },
};
