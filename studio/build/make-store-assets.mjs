// The visual assets a Microsoft Store package must carry.
//
//   node build/make-store-assets.mjs
//
// Without these, electron-builder packs its own placeholder images and the
// listing ships with somebody else's artwork on the tile. All of them are
// derived from the one 512px mark, so there is a single source for the
// identity and no second file to keep in step.
//
// The sizes are the ones the packaging manifest names. Scale-200 variants are
// generated too: Windows picks them on high-density displays, and their absence
// is the usual reason a tile looks soft next to everything around it.
//
// Wide and splash images are letterboxed rather than stretched - the mark is
// square, and a stretched logo is the first thing a reviewer notices.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, pad, resize } from "./png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "appx");
fs.mkdirSync(out, { recursive: true });

const source = decodePng(fs.readFileSync(path.join(here, "icon.png")));

// [file, width, height, how much of the shorter side the mark should occupy]
const ASSETS = [
  ["StoreLogo.png", 50, 50, 1],
  ["Square44x44Logo.png", 44, 44, 1],
  ["Square44x44Logo.targetsize-24_altform-unplated.png", 24, 24, 1],
  ["Square71x71Logo.png", 71, 71, 1],
  ["Square150x150Logo.png", 150, 150, 1],
  ["Square310x310Logo.png", 310, 310, 1],
  ["Wide310x150Logo.png", 310, 150, 0.72],
  ["SplashScreen.png", 620, 300, 0.55],
  // scale-200, for high-density displays.
  ["StoreLogo.scale-200.png", 100, 100, 1],
  ["Square44x44Logo.scale-200.png", 88, 88, 1],
  ["Square71x71Logo.scale-200.png", 142, 142, 1],
  ["Square150x150Logo.scale-200.png", 300, 300, 1],
  ["Square310x310Logo.scale-200.png", 620, 620, 1],
  ["Wide310x150Logo.scale-200.png", 620, 300, 0.72],
  ["SplashScreen.scale-200.png", 1240, 600, 0.55],
];

let bytes = 0;
for (const [name, w, h, fill] of ASSETS) {
  const side = Math.round(Math.min(w, h) * fill);
  const img = w === h && fill === 1 ? resize(source, w, h) : pad(resize(source, side, side), w, h);
  const png = encodePng(img);
  fs.writeFileSync(path.join(out, name), png);
  bytes += png.length;
}

console.log(`store assets — ${ASSETS.length} files, ${(bytes / 1024).toFixed(0)} KB, in build/appx/`);
