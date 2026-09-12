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

/**
 * The hostname inside a string, however it was written.
 *
 * Everything here is a variation a person actually types: a trailing slash, a
 * path on the end, no scheme at all, a port, capitals, stray whitespace. All of
 * them must come out as the same host, because all of them are the same
 * database.
 *
 * Returns null for a string that is not a host. That matters more than it
 * looks: the denylist is compared against every string in the target block,
 * keys and schema names included, and those must not be mistaken for hosts.
 */
function hostOf(value) {
  const s = strip(value).replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/@]*@/, "");
  const host = s.split(/[/?#]/)[0].split(":")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host.replace(/^\.+|\.+$/g, "") : null;
}

/**
 * Is this target one of the hosts the customer forbade?
 *
 * Host equality, or a subdomain of a forbidden host — so naming
 * `example.com` also stops `api.example.com`, which is what someone listing
 * their production domain means.
 *
 * It is deliberately NOT a substring test. A substring test refuses
 * `key: "k"` because some forbidden URL happens to contain the letter k, and a
 * guard that cries wolf over a single character is a guard people switch off.
 */
function sameHost(target, denied) {
  if (!target || !denied) return false;
  return target === denied || target.endsWith(`.${denied}`) || denied.endsWith(`.${target}`);
}

/** Pull every string out of a nested object, so we can scan a whole target block. */
function stringsIn(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, found));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => stringsIn(v, found));
  return found;
}

const DEFAULTS = {
  environment: "test",
  // How long any single adapter call may take before it is recorded as a
  // timeout and the run moves on. Without this a dead socket hangs the whole
  // simulation. Set 0 to disable if your adapter does legitimately long work.
  timeoutMs: 20_000,
  // Extra attempts for calls that never reached the server. Transport only —
  // an error your API actually returned is a finding and is never retried.
  retries: 3,
  // Consecutive unreachable calls before Populace declares the target down and
  // stops, instead of retrying every call for the rest of the run. 0 disables.
  giveUpAfter: 12,
  // Gap between sign-ups. Auth endpoints are throttled far harder than the rest
  // of an API — Supabase's default is 30 sign-ups per five minutes per address,
  // and 400ms is 2.5 per second. That default is right for real users, who each
  // arrive from their own address, and impossible for a simulation, where every
  // request shares one. Raise this to fit a target you do not control; a hosted
  // Supabase project needs about 10_000.
  signupStaggerMs: 400,
  // When a sign-up is refused *for being too fast*, wait and try that person
  // again rather than recording them as a failure. A rate limit says nothing
  // about the application under test, so counting it as a finding is a lie.
  // Backoff is this value times the attempt number. 0 disables retrying.
  signupRateLimitBackoffMs: 5_000,
  signupRateLimitRetries: 2,
  population: { agents: 6, cities: ["manila", "mumbai"], tickSeconds: 5, minutes: 10 },
  // Comfortably inside a 1-hour token, which is the common default.
  session: { refreshEveryMinutes: 30 },
  report: { path: "populace-report.json" },
};

export async function loadConfig({ configPath, cwd = process.cwd(), overrides = {} } = {}) {
  // Neither of these is a population setting; keep them out of that spread.
  const { reportPath: _reportPath, signupStaggerMs: _stagger, ...populationOverrides } = overrides;
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
    // --stagger wins over the config file, so a run can be paced to fit a target
    // whose rate limit is not yours to change.
    ...(overrides.signupStaggerMs ? { signupStaggerMs: overrides.signupStaggerMs } : {}),
    population: {
      ...DEFAULTS.population,
      ...(loaded.population || {}),
      ...populationOverrides,
    },
    session: { ...DEFAULTS.session, ...(loaded.session || {}) },
    report: {
      ...DEFAULTS.report,
      ...(loaded.report || {}),
      // --report wins over the config file, so a run can put its output
      // somewhere else without editing anything.
      ...(overrides.reportPath ? { path: overrides.reportPath } : {}),
    },
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
  ];

  // A denied entry that is not a host is kept as a literal, so a customer who
  // writes something unusual in there still gets an exact match rather than
  // silently nothing.
  const deniedHosts = denied.map(hostOf).filter(Boolean);
  const deniedLiterals = denied.filter((d) => !hostOf(d)).map(strip).filter(Boolean);

  if (denied.length) {
    const targets = stringsIn(config.target);
    const hit = targets.find((raw) => {
      const host = hostOf(raw);
      if (host && deniedHosts.some((d) => sameHost(host, d))) return true;
      return deniedLiterals.includes(strip(raw));
    });
    if (hit) {
      refuse(
        `The target matches a host listed in neverRunAgainst:\n    ${hostOf(hit) || strip(hit)}`,
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
