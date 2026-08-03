// Programmatic entry point, for driving Populace from a CI job or a UI rather
// than the terminal.
//
//   import { simulate } from "populace";
//   const report = await simulate({ configPath: "./populace.config.mjs" });
//   if (report.verdict.status !== "clean") process.exit(1);

import { loadAdapter, loadConfig } from "./config.mjs";
import { createMetrics, instrument } from "./instrument.mjs";
import { buildReport } from "./report.mjs";
import { World } from "./engine/world.mjs";

export { loadConfig, loadAdapter, ConfigError } from "./config.mjs";
export { CONTRACT, coverageOf } from "./contract.mjs";
export { buildReport, renderReport, writeReport } from "./report.mjs";
export { createMetrics, instrument, summarise } from "./instrument.mjs";
export { World } from "./engine/world.mjs";
export { Agent } from "./engine/agent.mjs";
export { buildPersonas, CITIES } from "./engine/personas.mjs";

export async function simulate({ configPath, overrides = {}, on = {}, cleanup = true } = {}) {
  const config = await loadConfig({ configPath, overrides });
  const raw = await loadAdapter(config);
  const metrics = createMetrics();
  const adapter = instrument(raw, metrics);
  const startedAt = Date.now();

  const world = World.fromConfig(config, adapter, on);
  await world.populate();
  await world.run(config.population);

  const teardown = cleanup ? await world.teardown() : null;
  metrics.endedAt = Date.now();

  return buildReport({ config, adapter: raw, world, metrics, teardown, startedAt });
}
