// Renders the 9 Aug 2026 Buzz Buzz run as a self-contained SVG.
//
// Every number below is the recorded output of that run. The run itself is not
// repeatable: the project it ran against carried no data at the time and is
// production now, so it sits in `neverRunAgainst`. This file is the record.
//
//   node docs/build-run-graphic.mjs
import { writeFileSync } from "node:fs";

const RUN = {
  app: "Buzz Buzz",
  date: "9 August 2026",
  agents: 6,
  cities: "Manila + Mumbai",
  calls: 400,
  failures: 0,
  coverage: "13 / 13",
  created: 6,
  removed: 6,
  activity: "6.2 km driven · 22 posts · 59 likes · 22 comments · 21 messages · 2 group joins",
};

// method, calls, failures, p50 ms, p95 ms. null = not recorded.
const METHODS = [
  ["reportLocation", 172, 0, 414, 571],
  ["recentPostsByOthers", 61, 0, 112, 129],
  ["like", 59, 0, 108, 133],
  ["post", 22, 0, 109, 128],
  ["comment", 22, 0, 114, 141],
  ["openConversation", 21, 0, 115, 142],
  ["sendMessage", 21, 0, 113, 142],
  ["createUser", 6, 0, 436, 1600],
  ["setProfile", 6, 0, 121, 305],
  ["deleteUser", 6, 0, 130, 293],
  ["listGroups", 2, 0, null, null],
  ["joinGroup", 2, 0, null, null],
];

const sum = METHODS.reduce((a, m) => a + m[1], 0);
if (sum !== RUN.calls) throw new Error(`method calls sum to ${sum}, expected ${RUN.calls}`);

const C = {
  bg: "#0B1014", card: "#131B22", ink: "#EAF1F6", body: "#9FB0BC", muted: "#6B7C89",
  rule: "#233039", lime: "#D3FF00", ok: "#63C48D", bar: "#2C3B45",
};
// Single quotes inside: these land in double-quoted SVG attributes, and a
// double-quoted family name there ends the attribute and breaks the XML.
const MONO = "ui-monospace,'SF Mono',SFMono-Regular,'Cascadia Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const ms = (v) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);

const W = 1200;
const PAD = 48;
const ROW_H = 34;
const tableTop = 396;
const H = tableTop + 34 + METHODS.length * ROW_H + 148;

const slowest = Math.max(...METHODS.map((m) => m[4] ?? 0));
// Column right-edges. The widest method name (recentPostsByOthers) ends near
// x=240, so the numeric columns sit just past it rather than out at the margin.
const COL = { calls: 430, fails: 510, p50: 630, p95: 740 };
const BAR_X = 790;
const BAR_W = W - PAD - BAR_X;

const rows = METHODS.map(([name, calls, fails, p50, p95], i) => {
  const y = tableTop + 34 + i * ROW_H;
  const bw = p95 === null ? 0 : Math.max(2, (p95 / slowest) * BAR_W);
  return `
  <g>
    ${i % 2 ? `<rect x="${PAD - 14}" y="${y - 22}" width="${W - 2 * PAD + 28}" height="${ROW_H}" rx="5" fill="#FFFFFF" opacity="0.022"/>` : ""}
    <text x="${PAD}" y="${y}" fill="${C.ink}" font-family="${MONO}" font-size="17">${name}</text>
    <text x="${COL.calls}" y="${y}" fill="${C.body}" font-family="${MONO}" font-size="17" text-anchor="end">${calls}</text>
    <text x="${COL.fails}" y="${y}" fill="${C.ok}" font-family="${MONO}" font-size="17" text-anchor="end">${fails}</text>
    <text x="${COL.p50}" y="${y}" fill="${C.body}" font-family="${MONO}" font-size="17" text-anchor="end">${ms(p50)}</text>
    <text x="${COL.p95}" y="${y}" fill="${C.body}" font-family="${MONO}" font-size="17" text-anchor="end">${ms(p95)}</text>
    ${bw ? `<rect x="${BAR_X}" y="${y - 12}" width="${bw.toFixed(1)}" height="12" rx="3" fill="${C.bar}"/>` : ""}
  </g>`;
}).join("");

const stat = (x, value, label, color) => `
  <text x="${x}" y="316" fill="${color}" font-family="${MONO}" font-size="40" font-weight="700">${value}</text>
  <text x="${x}" y="342" fill="${C.muted}" font-family="${SANS}" font-size="14" letter-spacing="0.06em">${label}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
  aria-label="Populace report for Buzz Buzz, 9 August 2026: no failures across 400 API calls from 6 simulated users across Manila and Mumbai.">
  <rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="15" fill="none" stroke="${C.rule}"/>

  <text x="${PAD}" y="70" fill="${C.muted}" font-family="${MONO}" font-size="15" letter-spacing="0.22em">POPULACE REPORT</text>
  <text x="${W - PAD}" y="70" fill="${C.muted}" font-family="${MONO}" font-size="15" text-anchor="end">${RUN.date}</text>
  <line x1="${PAD}" y1="92" x2="${W - PAD}" y2="92" stroke="${C.rule}"/>

  <text x="${PAD}" y="150" fill="${C.ink}" font-family="${SANS}" font-size="40" font-weight="700" letter-spacing="-0.02em">${RUN.app}</text>
  <text x="${PAD}" y="182" fill="${C.body}" font-family="${SANS}" font-size="18">${RUN.agents} simulated drivers · ${RUN.cities} · live backend, real accounts</text>

  <rect x="${PAD}" y="212" width="${W - 2 * PAD}" height="60" rx="10" fill="${C.lime}"/>
  <text x="${PAD + 26}" y="251" fill="#0B1014" font-family="${SANS}" font-size="26" font-weight="800">✔  No failures across ${RUN.calls} API calls</text>

  ${stat(PAD, RUN.calls, "API CALLS", C.ink)}
  ${stat(268, RUN.failures, "FAILURES", C.ok)}
  ${stat(488, RUN.coverage, "METHODS COVERED", C.ink)}
  ${stat(708, RUN.created, "ACCOUNTS CREATED", C.ink)}
  ${stat(928, RUN.removed, "ACCOUNTS REMOVED", C.ok)}

  <line x1="${PAD}" y1="${tableTop - 24}" x2="${W - PAD}" y2="${tableTop - 24}" stroke="${C.rule}"/>
  <text x="${PAD}" y="${tableTop}" fill="${C.muted}" font-family="${MONO}" font-size="14" letter-spacing="0.14em">METHOD</text>
  <text x="${COL.calls}" y="${tableTop}" fill="${C.muted}" font-family="${MONO}" font-size="14" letter-spacing="0.14em" text-anchor="end">CALLS</text>
  <text x="${COL.fails}" y="${tableTop}" fill="${C.muted}" font-family="${MONO}" font-size="14" letter-spacing="0.14em" text-anchor="end">FAILS</text>
  <text x="${COL.p50}" y="${tableTop}" fill="${C.muted}" font-family="${MONO}" font-size="14" letter-spacing="0.14em" text-anchor="end">P50</text>
  <text x="${COL.p95}" y="${tableTop}" fill="${C.muted}" font-family="${MONO}" font-size="14" letter-spacing="0.14em" text-anchor="end">P95</text>
  ${rows}

  <line x1="${PAD}" y1="${H - 108}" x2="${W - PAD}" y2="${H - 108}" stroke="${C.rule}"/>
  <text x="${PAD}" y="${H - 74}" fill="${C.body}" font-family="${SANS}" font-size="17">${RUN.activity}</text>
  <text x="${PAD}" y="${H - 40}" fill="${C.muted}" font-family="${SANS}" font-size="15">Six users for three minutes is a correctness run, not a load test. These are latencies under six concurrent users and nothing more.</text>
</svg>
`;

writeFileSync(new URL("./buzzbuzz-run-2026-08-09.svg", import.meta.url), svg);
console.log(`wrote docs/buzzbuzz-run-2026-08-09.svg — ${METHODS.length} methods, ${sum} calls`);
