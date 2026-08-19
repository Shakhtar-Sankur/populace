// Populace's first customer: Buzz, a gig-driver tracking app.
//
// Run it — PowerShell (Windows):
//   $env:BUZZBUZZ_TEST_URL="https://<your-TEST-project>.supabase.co"
//   $env:BUZZBUZZ_TEST_KEY="<test project publishable key>"
//   node src/cli.mjs run --config examples/buzzbuzz/populace.config.mjs
//
// Run it — bash/zsh (macOS, Linux):
//   BUZZBUZZ_TEST_URL=... BUZZBUZZ_TEST_KEY=... \
//     node src/cli.mjs run --config examples/buzzbuzz/populace.config.mjs
//
// The test project needs the same schema as production. Run these against it:
//   schema.sql · social_features.sql · groups.sql · direct_messages.sql
//   realtime.sql · fix_chat_rls.sql · user_content_control.sql
//   work_apps_global.sql · privacy_lockdown.sql
// …and turn OFF Authentication → Providers → Email → "Confirm email",
// otherwise nobody can sign in after signing up.

export default {
  app: "Buzz",
  adapter: "../../adapters/buzzbuzz.mjs",
  environment: "test",

  target: {
    url: process.env.BUZZBUZZ_TEST_URL,
    key: process.env.BUZZBUZZ_TEST_KEY,
  },

  // Buzz's LIVE project. If BUZZBUZZ_TEST_URL is ever set to this by
  // accident, Populace refuses to start. Real drivers must never see invented
  // people on their map.
  // Both of these are real. rqzuuvlougzhynckvqzd is the original project, which
  // is still running; ypdaetbeexyepswyhbui became production on 2026-08-09.
  // The clean run recorded against the latter happened while it was empty and
  // had no real drivers on it — that window has closed, and it must not be
  // simulated against again.
  neverRunAgainst: [
    "https://rqzuuvlougzhynckvqzd.supabase.co",
    "https://ypdaetbeexyepswyhbui.supabase.co",
  ],

  population: {
    agents: 8,
    cities: ["manila", "mumbai"],
    minutes: 10,
    tickSeconds: 5,
  },

  identity: { phonePrefix: "0900" },
  report: { path: "populace-report.json" },
};
