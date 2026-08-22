// Renders the 21 Aug 2026 Buzz run as a self-contained SVG.
//
// Every number below is the recorded output of that run.
//
// This is the largest run that was clean end to end, and the choice is
// deliberate. A later run put 300 drivers through 1,401,435 calls with zero API
// failures, but one call never reached the server — a socket exhausted on the
// test machine — so Populace marked it inconclusive. A graphic of that run
// headlining "0 failures" would need an asterisk to be true. This one needs
// none: 0 API failures, 0 transport failures, 0 retries, verdict clean.
//
//   node docs/build-run-graphic.mjs
import { writeFileSync } from "node:fs";

const RUN = {
  app: "Buzz",
  date: "21 August 2026",
  agents: 200,
  cities: "20 cities in 11 countries",
  calls: 932455,
  failures: 0,
  coverage: "13 / 13",
  created: 200,
  removed: 200,
  activity: "2,271 km · 81,672 posts · 172,660 likes · 76,034 messages",
};

// method, calls, failures, p50 ms, p95 ms. null = not recorded.
const METHODS = [
  ["reportLocation", 272553, 0, 369, 868],
  ["recentPostsByOthers", 172660, 0, 152, 455],
  ["like", 172660, 0, 122, 359],
  ["post", 81672, 0, 165, 476],
  ["openConversation", 76034, 0, 93, 348],
  ["sendMessage", 76034, 0, 62, 269],
  ["comment", 69064, 0, 85, 277],
  ["listGroups", 5389, 0, 71, 307],
  ["joinGroup", 5389, 0, 42, 243],
  ["refreshSession", 400, 0, 224, 305],
  ["createUser", 200, 0, 153, 177],
  ["setProfile", 200, 0, 16, 22],
  ["deleteUser", 200, 0, 41, 70],
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

const n = (v) => v.toLocaleString("en-US");
const ms = (v) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);

// The Gigzen mark, same single path as the app (src/components/GigzenMark.tsx)
// and the company site, so the three cannot drift apart. Native viewBox is
// 0 0 64 64; 30/64 renders it at 30px.
const MARK_D =
  "M33.19 2 L60.1 14.82 L48.54 20.68 L33.66 13.4 L16.25 23.06 L15.14 23.85 L15.14 40.15 " +
  "L33.19 47.91 L49.02 39.84 L49.34 38.73 L48.54 38.25 L30.34 33.66 L30.5 30.97 L44.43 24.01 " +
  "L61.05 29.86 L61.05 46.64 L33.5 62 L2.95 46.64 L2.95 17.51 L33.03 2.16 Z";
// Optically centred on the wordmark rather than hung from the same y. GIGZEN is
// all caps at 21px on a 63 baseline, so its caps run roughly 48–63 and centre on
// 55.5; a 30px mark centred there starts at 55.5 - 15.
const MARK_SIZE = 30;
const WORDMARK_BASELINE = 63;
const WORDMARK_CAP_TOP = WORDMARK_BASELINE - 15;
const MARK_TOP = (WORDMARK_CAP_TOP + WORDMARK_BASELINE) / 2 - MARK_SIZE / 2;
const GIGZEN_MARK =
  `<g transform="translate(48,${MARK_TOP}) scale(${(MARK_SIZE / 64).toFixed(5)})" fill="#D3FF00"><path d="${MARK_D}"/></g>`;

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
  aria-label="Populace report for ${RUN.app}, ${RUN.date}: no failures across ${n(RUN.calls)} API calls from ${RUN.agents} simulated users across ${RUN.cities.replace(" + ", " and ")}.">
  <rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="15" fill="none" stroke="${C.rule}"/>

  ${GIGZEN_MARK}
  <text x="${PAD + 42}" y="63" fill="${C.ink}" font-family="${SANS}" font-size="21" font-weight="800" letter-spacing="0.14em">GIGZEN</text>
  <text x="${W - PAD}" y="63" fill="${C.muted}" font-family="${MONO}" font-size="15" letter-spacing="0.18em" text-anchor="end">POPULACE REPORT · ${RUN.date.toUpperCase()}</text>
  <line x1="${PAD}" y1="92" x2="${W - PAD}" y2="92" stroke="${C.rule}"/>

  <text x="${PAD}" y="150" fill="${C.ink}" font-family="${SANS}" font-size="40" font-weight="700" letter-spacing="-0.02em">${RUN.app}</text>
  <text x="${PAD}" y="182" fill="${C.body}" font-family="${SANS}" font-size="18">${RUN.agents} simulated drivers · ${RUN.cities} · live backend, real accounts</text>

  <rect x="${PAD}" y="212" width="${W - 2 * PAD}" height="60" rx="10" fill="${C.lime}"/>
  <text x="${PAD + 26}" y="251" fill="#0B1014" font-family="${SANS}" font-size="26" font-weight="800">✔  No failures across ${n(RUN.calls)} API calls</text>

  ${stat(PAD, n(RUN.calls), "API CALLS", C.ink)}
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
  <text x="${W - PAD}" y="${H - 74}" fill="${C.muted}" font-family="${MONO}" font-size="13" text-anchor="end">Gigzen Private Limited · Bhubaneswar, India</text>
  <text x="${PAD}" y="${H - 42}" fill="${C.muted}" font-family="${SANS}" font-size="15">Two hundred concurrent drivers over a local backend. Loopback, so no network is included: the same calls cost about 175 ms against the hosted project.</text>
</svg>
`;

// SVG has no layout engine, so nothing stops two <text> elements sharing a
// line and printing on top of each other — which is exactly what the company
// footer did on its first draft. Estimate widths and refuse to write an image
// where a left- and a right-anchored label on the same baseline collide.
const CHAR_W = { mono: 0.60, sans: 0.52 }; // em ratio, deliberately generous
const baselines = new Map();
for (const m of svg.matchAll(
  /<text x="(\d+)" y="(\d+)"[^>]*?font-family="([^"]+)"[^>]*?font-size="(\d+)"([^>]*)>([^<]*)<\/text>/g,
)) {
  const [, x, y, family, size, rest, text] = m;
  const w = text.length * Number(size) * (family.includes("mono") ? CHAR_W.mono : CHAR_W.sans);
  const end = rest.includes('text-anchor="end"');
  const span = end ? [Number(x) - w, Number(x)] : [Number(x), Number(x) + w];
  const list = baselines.get(y) ?? [];
  list.push({ span, text });
  baselines.set(y, list);
}
for (const [y, items] of baselines) {
  items.sort((a, b) => a.span[0] - b.span[0]);
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i].span[1] > items[i + 1].span[0]) {
      throw new Error(
        `text collision on baseline y=${y}: "${items[i].text.slice(0, 40)}" ` +
          `runs into "${items[i + 1].text.slice(0, 40)}"`,
      );
    }
  }
}

writeFileSync(new URL("./buzz-run-2026-08-21.svg", import.meta.url), svg);
console.log(
  `wrote docs/buzz-run-2026-08-21.svg — ${METHODS.length} methods, ${sum} calls, ` +
    `${baselines.size} baselines checked for collisions`,
);
