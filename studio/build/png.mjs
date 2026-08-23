// Read, resize and write PNGs, with no dependencies.
//
// Shared by the icon builder and the Store asset builder. Both need the same
// three operations on the one source mark, and a dependency that decodes PNGs
// would be larger than the code that does it.
//
// Only the case the mark is actually in: 8-bit RGBA, non-interlaced. Anything
// else throws rather than guessing, because a silently mis-decoded icon is
// worse than a build that stops.

import zlib from "node:zlib";

/** @returns {{width:number, height:number, data:Buffer}} RGBA, row-major. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24], colorType = buffer[25], interlace = buffer[28];
  if (depth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`only 8-bit RGBA, non-interlaced PNG is handled (got depth ${depth}, type ${colorType})`);
  }

  const idat = [];
  for (let o = 8; o < buffer.length; ) {
    const len = buffer.readUInt32BE(o);
    if (buffer.toString("ascii", o + 4, o + 8) === "IDAT") idat.push(buffer.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Each refers to the pixel left (a), above
  // (b) and above-left (c), all already reconstructed.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      data[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data };
}

/**
 * Box-average into a w×h buffer.
 *
 * Colour is weighted by alpha. Averaging RGB straight lets the transparent
 * black around the mark bleed a dark fringe into every edge as it shrinks,
 * which is exactly where a small icon is judged.
 */
export function resize(src, w, h) {
  const out = Buffer.alloc(w * h * 4);
  const sx = src.width / w, sy = src.height / h;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [x0, x1] = [Math.floor(x * sx), Math.min(src.width, Math.ceil((x + 1) * sx))];
      const [y0, y1] = [Math.floor(y * sy), Math.min(src.height, Math.ceil((y + 1) * sy))];
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const k = (j * src.width + i) * 4;
          const al = src.data[k + 3];
          r += src.data[k] * al; g += src.data[k + 1] * al; b += src.data[k + 2] * al;
          a += al; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = n ? Math.round(a / n) : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Paint an image onto a transparent canvas of another size, centred. */
export function pad(img, w, h) {
  const out = Buffer.alloc(w * h * 4, 0);
  const ox = Math.round((w - img.width) / 2), oy = Math.round((h - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= w) continue;
      img.data.copy(out, (ty * w + tx) * 4, (y * img.width + x) * 4, (y * img.width + x) * 4 + 4);
    }
  }
  return { width: w, height: h, data: out };
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA back to a PNG. Filter 0 on every row; zlib does the work. */
export function encodePng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
