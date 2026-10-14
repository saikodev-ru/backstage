// Генерация low-res blur-плейсхолдеров для всех изображений витрины.
// Каждый PNG/JPG из public/img/** сжимается до 16px-ширины JPEG и сохраняется
// как base64-строка в src/lib/blur-map.ts.
// Запуск: bun scripts/gen-blur.ts

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const PUBLIC_DIR = "/home/z/my-project/public";
const IMG_DIR = path.join(PUBLIC_DIR, "img");
const OUT_FILE = "/home/z/my-project/src/lib/blur-map.ts";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(IMG_DIR)) {
    console.log("no public/img — nothing to do");
    return;
  }
  const files = await walk(IMG_DIR);
  const entries: string[] = [];

  for (const file of files) {
    const rel = "/" + path.relative(PUBLIC_DIR, file).split(path.sep).join("/");
    try {
      const buf = await sharp(file)
        .resize({ width: 16, withoutEnlargement: true })
        .flatten({ background: "#101014" })
        .jpeg({ quality: 40, mozjpeg: true })
        .toBuffer();
      entries.push(`  ${JSON.stringify(rel)}: ${JSON.stringify(`data:image/jpeg;base64,${buf.toString("base64")}`)},`);
      console.log(`✓ ${rel} (${buf.length} b)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${rel}: ${msg}`);
    }
  }

  const ts = `// АВТОГЕНЕРАЦИЯ: bun scripts/gen-blur.ts
// Low-res (16px) JPEG-плейсхолдеры для blur-up превью.
// Если полное изображение не загрузилось — остаётся размытая низкая копия.

export const BLUR_MAP: Record<string, string> = {
${entries.join("\n")}
};
`;
  fs.writeFileSync(OUT_FILE, ts);
  console.log(`DONE: ${entries.length} placeholders -> ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
