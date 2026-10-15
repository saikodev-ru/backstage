// Пиксельный зонд PNG-скриншотов (без зависимостей: zlib + парсер PNG).
// Использование: bun scripts/png-probe.mjs file.png x1,y1 x2,y2 ...
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const [file, ...points] = process.argv.slice(2);
const buf = readFileSync(file);

let pos = 8;
let width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "IEND") break;
  pos += 12 + len;
}
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
  console.error(`unsupported PNG: depth=${bitDepth} color=${colorType}`);
  process.exit(1);
}
const channels = colorType === 6 ? 4 : 3;
const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(height * stride);
const bpp = channels;
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
  const cur = out.subarray(y * stride, (y + 1) * stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = x >= bpp && prev ? prev[x - bpp] : 0;
    let v = row[x];
    switch (filter) {
      case 0: break;
      case 1: v += a; break;
      case 2: v += b; break;
      case 3: v += Math.floor((a + b) / 2); break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        break;
      }
    }
    cur[x] = v & 0xff;
  }
}

console.log(`${file}: ${width}x${height}`);
for (const p of points) {
  const [x, y] = p.split(",").map(Number);
  const o = (y * width + x) * channels;
  console.log(
    `  (${x},${y}) rgba(${out[o]},${out[o + 1]},${out[o + 2]}${channels === 4 ? "," + out[o + 3] : ""})`
  );
}
