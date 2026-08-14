#!/usr/bin/env node
// populace — command line.
//
//   populace init          scaffold a config and a blank adapter
//   populace doctor        check config, reachability and coverage WITHOUT running
//   populace run           bring the population to life
//   populace clean         delete every account a run created

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadAdapter, loadConfig } from "./config.mjs";
import { createMetrics, instrument } from "./instrument.mjs";
import { buildReport, renderReport, writeReport } from "./report.mjs";
import { canSignInOnly } from "./contract.mjs";
import { isTransportError } from "./net.mjs";
import { diagnose } from "./diagnose.mjs";
import { World } from "./engine/world.mjs";
import { buildPersonas, CITIES } from "./engine/personas.mjs";
import { Agent } from "./engine/agent.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const command = argv[0] || "help";

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
const has = (name) => argv.includes(`--${name}`);

/**
 * A path a human can read.
 *
 * Relative is right when the file sits under the current directory and absurd
 * when it does not — running the bundled demo from elsewhere printed eight
 * levels of "../" before the real path, which reads like a bug.
 */
function displayPath(file) {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith("..") ? file : rel;
}

function overridesFromFlags() {
  const o = {};
  if (flag("agents")) o.agents = Number(flag("agents"));
  if (flag("minutes")) o.minutes = Number(flag("minutes"));
  if (flag("tick")) o.tickSeconds = Number(flag("tick"));
  if (flag("cities")) o.cities = String(flag("cities")).split(",").map((s) => s.trim()).filter(Boolean);
  if (flag("report")) o.reportPath = flag("report");
  return o;
}

async function open() {
  const config = await loadConfig({ configPath: flag("config"), overrides: overridesFromFlags() });
  for (const w of config._warnings || []) console.log(`  ⚠ ${w}`);
  const raw = await loadAdapter(config);
  return { config, raw };
}

// ---------------------------------------------------------------- init

async function init() {
  const cwd = process.cwd();
  const configFile = path.join(cwd, "populace.config.mjs");
  const adapterDir = path.join(cwd, "adapters");
  const adapterFile = path.join(adapterDir, "my-app.mjs");

  if (fs.existsSync(configFile) && !has("force")) {
    console.log(`\n  populace.config.mjs already exists. Use --force to overwrite.\n`);
    return;
  }
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.copyFileSync(path.join(here, "..", "populace.config.example.mjs"), configFile);
  if (!fs.existsSync(adapterFile) || has("force")) {
    fs.copyFileSync(path.join(here, "..", "adapters", "template.mjs"), adapterFile);
  }

  console.log(`
  Created:
    populace.config.mjs      ← point this at your TEST environment
    adapters/my-app.mjs      ← teach Populace how your app works

  Next:
    1. Fill in \`target\` and \`neverRunAgainst\` in populace.config.mjs
    2. Implement createUser and deleteUser in adapters/my-app.mjs
    3. populace doctor
`);
}

// ---------------------------------------------------------------- doctor

async function doctor() {
  const { config, raw } = await open();

  // Reachability is the only part that needs the network, so it happens here
  // and the judgement itself is made by diagnose(), which is pure and tested.
  let reachable = null;
  let reachError = "";
  if (typeof raw.healthCheck === "function") {
    try {
      await raw.healthCheck();
      reachable = true;
    } catch (error) {
      reachable = false;
      reachError = error.message;
    }
  }

  const d = diagnose({ config, adapter: raw, reachable });

  console.log(`
  Config    ${path.basename(config._file)}`);
  console.log(`  App       ${config.app || raw.name || "(unnamed)"}`);
  console.log(`  Adapter   ${config.adapter}  →  ${d.coverage.label} contract methods`);
  console.log(`  Env       ${config.environment}`);
  console.log(`  Guarded   ${d.guarded} production host(s) denied`);
  console.log(
    `  Cleanup   ${d.cleanup === "read-only"
      ? "read-only — signIn lets clean check without creating"
      : "create-then-delete — no signIn, so clean writes to your auth table"}`,
  );
  if (reachable !== null) {
    console.log(`  Reaching  ${reachable ? "✔ target responded" : `✖ ${reachError}`}`);
  }

  if (d.coverage.missing.length) {
    console.log(`
  Not implemented — these will be SKIPPED, not tested:`);
    for (const c of d.coverage.missing) {
      console.log(`    · ${c.method.padEnd(21)} ${c.required ? "(REQUIRED) " : ""}${c.exercises}`);
    }
  }

  if (!d.ready) {
    console.log(`
  ✖ Not ready — ${d.blockers.join("; ")}.
`);
    process.exitCode = 1;
  } else {
    console.log(`
  ✔ Ready. Start with:  populace run --agents 5 --minutes 3
`);
  }
}

// ---------------------------------------------------------------- run

async function run() {
  const { config, raw } = await open();
  const metrics = createMetrics();
  const adapter = instrument(raw, metrics, { timeoutMs: config.timeoutMs, retries: config.retries });
  const startedAt = Date.now();

  const { agents, cities, minutes, tickSeconds } = config.population;
  console.log(`\n  Bringing ${agents} people to life across ${cities.join(", ")}…\n`);

  const world = World.fromConfig(config, adapter, {
    joined: (a) => console.log(`   ✓ ${a.persona.name} (${a.persona.city.name}, ${a.persona.platform})`),
    joinFailed: (p, e) => console.log(`   ✖ ${p.name}: ${e.message}`),
    tick: (n, total, w) => render(config, n, total, w),
  });

  process.on("SIGINT", () => {
    world.stop();
    console.log(`\n  Stopping…\n`);
  });

  await world.populate();
  if (!world.agents.length) {
    console.error(`\n  ✖ Nobody could sign in. Run \`populace doctor\`, and check your test\n    environment has the same schema as production.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  Running ${world.agents.length} people for ${minutes} min…\n`);
  await new Promise((r) => setTimeout(r, 1000));
  await world.run({ minutes, tickSeconds });

  // Clean up by default. Leaving invented accounts lying around in someone
  // else's environment is the rudest thing this product could do.
  let teardown = null;
  if (!has("keep")) {
    console.log(`\n  Removing simulated accounts…`);
    teardown = await world.teardown();
  }

  metrics.endedAt = Date.now();
  const report = buildReport({ config, adapter: raw, world, metrics, teardown, startedAt });
  const files = writeReport(report, config);
  console.log(renderReport(report));
  console.log(`  Report:  ${displayPath(files.json)}`);
  console.log(`  Shareable page:  ${displayPath(files.html)}\n`);

  if (report.verdict.status !== "clean") process.exitCode = 1;
}

function render(config, tickNo, totalTicks, world) {
  // The live table is for a human watching a terminal. Piped to a file or a CI
  // job, console.clear() is a no-op, so every tick would append another full
  // copy — burying the report under thousands of lines of scrollback. Emit a
  // sparse heartbeat instead.
  if (!process.stdout.isTTY) {
    const every = Math.max(1, Math.round(totalTicks / 5));
    if (tickNo === totalTicks || tickNo % every === 0) {
      const t = world.totals();
      console.log(
        `  tick ${tickNo}/${totalTicks} · ${world.agents.length} people · ` +
          `${t.km.toFixed(1)}km · ${t.posts}p ${t.likes}l ${t.comments}c ${t.messages}m` +
          (t.errors ? ` · ${t.errors} errors` : ""),
      );
    }
    return;
  }

  const rule = "─".repeat(74);
  const rows = world.agents.map((a) => {
    const s = a.stats;
    const where = a.onBreak ? "on break" : `${a.position.lat.toFixed(3)},${a.position.lng.toFixed(3)}`;
    return (
      `  ${a.persona.name.padEnd(17).slice(0, 17)} ` +
      `${a.persona.city.name.padEnd(8)} ` +
      `${a.persona.platform.padEnd(10)} ` +
      `${a.distanceKm.toFixed(1).padStart(6)}km ` +
      `${String(s.posts).padStart(2)}p ${String(s.likes).padStart(2)}l ` +
      `${String(s.comments).padStart(2)}c ${String(s.messages).padStart(2)}m ` +
      `${s.errors ? `⚠${s.errors}` : "  "} ${where}`
    );
  });
  console.clear();
  console.log(`\n  ${config.app || "populace"} — simulated population   tick ${tickNo}/${totalTicks}`);
  console.log(`  ${config.environment} environment`);
  console.log(rule);
  console.log(rows.join("\n"));
  console.log(rule);
  const recent = world.agents
    .flatMap((a) => a.log.slice(-1).map((l) => `  ${a.persona.name.split(" ")[0]}: ${l}`))
    .slice(-8);
  console.log(recent.join("\n"));
  console.log(`\n  Ctrl-C to stop.\n`);
}

// ---------------------------------------------------------------- clean

/**
 * A failure to reach the API is not evidence that an account is gone.
 *
 * This distinction is the whole point of the function: cleanup that turns "I
 * could not look" into "there was nothing there" hands the customer a false
 * all-clear over their own database.
 */

async function clean() {
  const { config, raw } = await open();
  const count = Number(flag("agents", config.population.agents));
  // Identities are deterministic, so a fresh process can find the accounts an
  // earlier run created — including one that was killed mid-flight.
  const personas = buildPersonas(count, config.population.cities);
  const lookOnly = canSignInOnly(raw);

  // Retry transport failures here too. `clean` is the command most likely to be
  // run on a bad link — it is what you reach for after a run died — and every
  // blip leaves an identity "unverified", which is deliberately sticky: it can
  // never be reported as absent. Without retries a flaky network means the
  // all-clear never arrives even though the accounts are long gone.
  const probe = instrument(raw, createMetrics(), {
    timeoutMs: config.timeoutMs,
    retries: config.retries,
  });

  const found = [];        // existed, and we deleted it
  const absent = [];       // definitively was not there
  const unverified = [];   // could not tell — never counted as absent

  console.log(`
  Checking ${count} simulated identities…
`);
  if (!lookOnly) {
    console.log("  ! This adapter has no signIn, so an identity can only be reached");
    console.log("    by createUser — which SIGNS UP when it does not exist. Cleaning");
    console.log("    therefore creates and immediately deletes any identity that was");
    console.log("    already absent, and cannot tell you which was which.");
    console.log("    Implement signIn to make cleanup read-only. See adapters/contract.md.\n");
  }

  for (const [i, persona] of personas.entries()) {
    const agent = new Agent(persona, probe, i, config.identity || {});
    try {
      if (lookOnly) {
        const user = await agent.findAccount();
        if (!user) {
          absent.push(persona.name);
          console.log(`   · ${persona.name} — not present`);
          continue;
        }
        await agent.selfDestruct();
        found.push(persona.name);
        console.log(`   ✓ ${persona.name} — found and removed`);
      } else {
        // Fallback: create-or-sign-in, then delete. Guarantees absence
        // afterwards; proves nothing about what was there before.
        await agent.ensureAccount();
        await agent.selfDestruct();
        found.push(persona.name);
        console.log(`   ✓ ${persona.name} — absent now`);
      }
    } catch (err) {
      if (isTransportError(err)) {
        unverified.push({ name: persona.name, why: String(err?.cause?.code || err?.message || err) });
        console.log(`   ? ${persona.name} — could not reach the API`);
      } else {
        // A non-transport failure on a look-only probe means the adapter said
        // something definite; treat it as absent only when we were looking.
        absent.push(persona.name);
      }
    }
  }

  if (lookOnly) {
    console.log(`
  ${found.length} found and removed, ${absent.length} were already absent.`);
  } else {
    console.log(`
  ${found.length} identities absent now (created-then-deleted where they did not exist),`);
    console.log(`  ${absent.length} unreachable-but-not-present.`);
  }

  if (unverified.length) {
    console.log(`
  ✖ ${unverified.length} could NOT be verified:
`);
    for (const u of unverified) console.log(`      · ${u.name} — ${u.why}`);
    console.log(`
  These may still exist. Re-run clean once the API is reachable.
`);
    process.exitCode = 1;
  } else {
    console.log("");
  }
}

// ---------------------------------------------------------------- demo

/**
 * Run against the bundled demo app.
 *
 * Everything else here needs a config, an adapter and a test backend before it
 * shows you anything — which is a lot of trust to ask for from someone who has
 * not yet seen the tool work. This runs the whole product end to end against a
 * fake app that lives in this repo: no setup, no account, nothing of yours
 * touched, and a real report at the end.
 *
 * The demo app has a deliberate bug in it. Finding that bug is the point.
 */
async function demo() {
  const configPath = path.join(here, "..", "examples", "demo", "populace.config.mjs");
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(
      "The bundled demo is missing. It ships in the repository — if you installed from npm, clone the repo to run it.",
    );
  }
  console.log(`
  Running the bundled demo. No setup, no backend of yours, nothing to clean up.
  The demo app has a real bug in it — see whether the report finds it.
`);
  argv.push("--config", configPath);
  // Write the report where the person is standing, not inside the package —
  // which for an npm install would bury it in node_modules.
  argv.push("--report", path.join(process.cwd(), "populace-report.json"));
  await run();
}

// ---------------------------------------------------------------- main

const commands = { init, doctor, run, clean, demo };

if (!commands[command]) {
  console.log(`
  populace — a simulated population for testing your app

    populace demo                     see it work, against a fake app, right now
    populace init                     scaffold a config and adapter here
    populace doctor                   check everything WITHOUT running
    populace run                      bring the population to life
    populace clean                    delete accounts a run created

  Options
    --config <path>                   default ./populace.config.mjs
    --agents <n>  --minutes <n>       override the config
    --tick <seconds>                  simulated seconds per step
    --cities <a,b>                    ${Object.keys(CITIES).join(", ")}
    --report <path>                   where to write the report
    --keep                            leave accounts in place after a run
`);
} else {
  commands[command]().catch((error) => {
    console.error(error instanceof ConfigError ? `\n  ✖ ${error.message}\n` : error);
    process.exit(1);
  });
}
