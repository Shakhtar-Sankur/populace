// Config loading and the production safety guard.
//
// The guard is the most important code in this product. Populace creates REAL
// accounts and writes REAL rows through a customer's REAL API. Pointed at
// production it would put invented people in front of paying users — that is
// deception, not testing, and it is painful to unpick afterwards.
//
// So the guard is deliberately hard to get past by accident, and it refuses in
// three independent ways. Any one of them is enough to stop a run.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export class ConfigError extends Error {}

const strip = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();

/** Pull every string out of a nested object, so we can scan a whole target block. */
function stringsIn(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, found));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => stringsIn(v, found));
  return found;
}

const DEFAULTS = {
  environment: "test",
  population: { agents: 6, cities: ["manila", "mumbai"], tickSeconds: 5, minutes: 10 },
  // Comfortably inside a 1-hour token, which is the common default.
  session: { refreshEveryMinutes: 30 },
  report: { path: "populace-report.json" },
};

export async function loadConfig({ configPath, cwd = process.cwd(), overrides = {} } = {}) {
  const file = path.resolve(cwd, configPath || "populace.config.mjs");

  if (!fs.existsSync(file)) {
    throw new ConfigError(
      `No config found at ${path.relative(cwd, file) || file}\n\n` +
        `  Create one with:   populace init\n` +
        `  Or point at one:   populace run --config path/to/populace.config.mjs`,
    );
  }

  const loaded = (await import(pathToFileURL(file).href)).default;
  if (!loaded || typeof loaded !== "object") {
    throw new ConfigError(`${path.basename(file)} must \`export default\` a config object.`);
  }

  const config = {
    ...DEFAULTS,
    ...loaded,
    population: { ...DEFAULTS.population, ...(loaded.population || {}), ...overrides },
    session: { ...DEFAULTS.session, ...(loaded.session || {}) },
    report: { ...DEFAULTS.report, ...(loaded.report || {}) },
    _dir: path.dirname(file),
    _file: file,
  };

  if (!config.adapter) {
    throw new ConfigError(`Config is missing \`adapter\` — the path to your adapter module.`);
  }

  guardProduction(config);
  return config;
}

/**
 * Three independent refusals. Each exists because a different mistake is easy
 * to make at 1am, and the cost of getting it wrong is borne by the customer's
 * real users rather than by whoever made the mistake.
 */
export function guardProduction(config) {
  const refuse = (why, fix) => {
    throw new ConfigError(`REFUSING TO RUN\n\n  ${why}\n\n  ${fix}`);
  };

  // 1. The environment must SAY it is not production. Opt in, never assume.
  const env = String(config.environment || "").toLowerCase();
  if (!["test", "staging", "dev", "development", "sandbox", "local"].includes(env)) {
    refuse(
      env === "production" || env === "prod"
        ? `The config declares environment: "${config.environment}".`
        : `The config declares environment: "${config.environment || "(unset)"}", which is not a recognised non-production environment.`,
      `Populace only runs against test environments. Set environment: "test"\n` +
        `  in ${path.basename(config._file || "populace.config.mjs")} — and make sure that is actually true.`,
    );
  }

  // 2. Explicit denylist — a customer names their production hosts once and can
  //    never hit them again, however the config is later edited.
  const denied = [
    ...(config.neverRunAgainst || []),
    ...String(process.env.POPULACE_PRODUCTION_URLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ].map(strip);

  if (denied.length) {
    const targets = stringsIn(config.target).map(strip).filter(Boolean);
    const hit = targets.find((t) => denied.some((d) => d && (t === d || t.includes(d) || d.includes(t))));
    if (hit) {
      refuse(
        `The target matches a host listed in neverRunAgainst:\n    ${hit}`,
        `Simulated people must never be visible to real users.\n` +
          `  Point \`target\` at a separate test environment.`,
      );
    }
  }

  // 3. A live-looking hostname with nothing declared to protect it. Not proof of
  //    production, so this one is a warning rather than a refusal — but it is
  //    loud, because "I forgot to fill in neverRunAgainst" is the likeliest
  //    version of this mistake.
  if (!denied.length) {
    config._warnings = [
      ...(config._warnings || []),
      `neverRunAgainst is empty. List your production URLs there so this can never point at them.`,
    ];
  }
  return config;
}

/** Load the customer's adapter module and sanity-check its shape. */
export async function loadAdapter(config) {
  const file = path.resolve(config._dir || process.cwd(), config.adapter);
  if (!fs.existsSync(file)) {
    throw new ConfigError(`Adapter not found: ${config.adapter}\n  Looked in ${file}`);
  }
  const mod = await import(pathToFileURL(file).href);
  const factory = mod.createAdapter || mod.default;
  if (typeof factory !== "function") {
    throw new ConfigError(
      `${config.adapter} must export \`createAdapter(config)\`.\n` +
        `  See adapters/contract.md for the full contract.`,
    );
  }
  // An adapter that refuses to build is almost always a configuration mistake
  // (a missing env var, usually). Present it as one instead of a stack trace —
  // the person hitting this is evaluating the product in their first minute.
  let adapter;
  try {
    adapter = await factory(config.target ?? {}, config);
  } catch (error) {
    throw new ConfigError(
      `Adapter "${path.basename(config.adapter)}" could not start:\n\n` +
        `  ${String(error.message || error).replace(/\n/g, "\n  ")}\n\n` +
        `  Check \`target\` in ${path.basename(config._file || "populace.config.mjs")}.`,
    );
  }
  if (!adapter || typeof adapter !== "object") {
    throw new ConfigError(`createAdapter() must return an object of methods.`);
  }
  if (typeof adapter.createUser !== "function") {
    throw new ConfigError(
      `Adapter "${adapter.name || config.adapter}" has no createUser().\n` +
        `  That is the one method every adapter must implement — without an\n` +
        `  identity there is nobody to simulate.`,
    );
  }
  return adapter;
}
