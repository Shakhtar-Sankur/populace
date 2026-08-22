// icon.png → icon.ico, with no dependencies.
//
// Needed because NSIS rejected the icon and stopped the installer build:
//
//   Error while loading icon from "build\icon.png": invalid icon file
//
// Two separate reasons, and the second is the one that costs an afternoon.
// installerIcon must be an .ico - a PNG is not one, whatever the extension.
// And the .ico electron-builder generates for the application holds a single
// PNG-compressed 256×256 image, which NSIS also calls an invalid icon file:
// PNG-in-ICO is a Vista-era addition that its icon loader does not read.
//
// So this writes the old, dull, universally understood thing: uncompressed
// 32-bit BGRA bitmaps, bottom-up, one per size, each with the AND mask that
// format still requires even when the alpha channel makes it redundant.
//
//   node build/make-ico.mjs
//
// Kept in the repository rather than run once by hand, because the icon will
// change and whoever changes it should not have to rediscover any of the above.

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SIZES = [256, 128, 64, 48, 32, 16];

/** Decode an 8-bit RGBA, non-interlaced PNG to {width, height, data}. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const [depth, colorType, , , interlace] = [buffer[24], buffer[25], buffer[26], buffer[27], buffer[28]];
  if (depth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`only 8-bit RGBA, non-interlaced PNG is handled (got depth ${depth}, type ${colorType})`);
  }

  const idat = [];
  for (let o = 8; o < buffer.length; ) {
    const len = buffer.readUInt32BE(o);
    const type = buffer.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") idat.push(buffer.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Each row is prefixed with its filter type,
  // and every filter refers to the pixel to the left (a), the row above (b),
  // and above-left (c) - all of which are already-reconstructed values.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let value = src[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      data[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, data };
}

/**
 * Box-average down to `size`.
 *
 * Colour is weighted by alpha. Averaging RGB straight would let the fully
 * transparent pixels around the mark - which are black, not "nothing" - bleed
 * a dark fringe into every edge as the icon gets smaller, which is precisely
 * where an icon is judged.
 */
function resize(src, size) {
  const out = Buffer.alloc(size * size * 4);
  const step = src.width / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [x0, x1] = [Math.floor(x * step), Math.min(src.width, Math.ceil((x + 1) * step))];
      const [y0, y1] = [Math.floor(y * step), Math.min(src.height, Math.ceil((y + 1) * step))];
      let r = 0, g = 0, b = 0, a = 0, n = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const alpha = src.data[i + 3];
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }

      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** One BITMAPINFOHEADER image: BGRA bottom-up, then the AND mask. */
function dib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // doubled: colour rows plus mask rows
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4; // bottom-up
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }

  // The AND mask is ignored by anything modern but must be present and its
  // rows padded to 4 bytes, or the file is malformed.
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size, 0);

  return Buffer.concat([header, pixels, mask]);
}

const source = decodePng(fs.readFileSync(path.join(here, "icon.png")));
const images = SIZES.map((size) => ({ size, body: dib(resize(source, size), size) }));

const dir = Buffer.alloc(6 + images.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // 1 = icon
dir.writeUInt16LE(images.length, 4);

let offset = dir.length;
images.forEach(({ size, body }, i) => {
  const e = 6 + i * 16;
  dir[e] = size === 256 ? 0 : size; // 256 is written as 0
  dir[e + 1] = size === 256 ? 0 : size;
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(body.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += body.length;
});

const out = path.join(here, "icon.ico");
fs.writeFileSync(out, Buffer.concat([dir, ...images.map((i) => i.body)]));
console.log(`icon.ico — ${SIZES.join(", ")} px, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
