// Генерация VTuber-контента для канала dypaGPT (z-ai-web-dev-sdk, backend).
// Запуск: bun scripts/gen-vtuber-images.ts
// Скрипт идемпотентен: существующие файлы пропускаются.

import ZAI from "z-ai-web-dev-sdk";
import fs from "node:fs";
import path from "node:path";

const OUT = "/home/z/my-project/public/img/dypagpt";

// Единый персонаж dypaGPT: аниме-девочка, лавандовые twin-tails, неоновые наушники с ушками
const GIRL =
  "cute anime VTuber girl with long lavender twin-tail hair, glowing violet eyes, futuristic cat-ear headphones with neon purple glow, oversized dark hoodie";
const STYLE =
  "vibrant anime illustration, dark graphite background with neon purple and lavender lighting, high quality, detailed";

const JOBS: { file: string; size: string; prompt: string }[] = [
  {
    file: "avatar.png",
    size: "1024x1024",
    prompt: `Close-up portrait of a ${GIRL}, confident playful smirk, holographic chat bubbles and sparkles floating around her, ${STYLE}`,
  },
  {
    file: "banner.png",
    size: "1440x768",
    prompt: `Wide shot of a cozy anime VTuber streaming room at night: a ${GIRL} sitting at a glowing streaming desk with two monitors showing chat and gameplay, plush toys and energy drink on desk, neon purple RGB strips on walls, city lights through window, ${STYLE}`,
  },
  {
    file: "live.png",
    size: "1344x768",
    prompt: `A ${GIRL} reacting with scared expression while playing a horror game, glowing game screen with dark corridor behind her, floating chat messages overlay, purple webcam frame, ${STYLE}`,
  },
  {
    file: "clip-1.png",
    size: "1344x768",
    prompt: `A ${GIRL} singing karaoke passionately with a microphone, eyes closed, musical notes and neon light particles swirling around, purple stage spotlights, ${STYLE}`,
  },
  {
    file: "clip-2.png",
    size: "1344x768",
    prompt: `A ${GIRL} screaming in comedic cartoonish panic, hands on head, exaggerated chibi-like expression, red game-over glow on monitor, ${STYLE}`,
  },
  {
    file: "clip-3.png",
    size: "1344x768",
    prompt: `A ${GIRL} celebrating a victory with arms raised, confetti and fireworks bursting, glowing neon energy, winner spotlight, ${STYLE}`,
  },
  {
    file: "clip-4.png",
    size: "1344x768",
    prompt: `A ${GIRL} laughing hard with tears, pointing at a glitched funny game scene on monitor, floating chat emote icons around, ${STYLE}`,
  },
  {
    file: "clip-5.png",
    size: "1344x768",
    prompt: `A ${GIRL} drawing digital art on a graphics tablet, half-finished cute anime character visible on screen, art software interface, cozy purple ambient light, ${STYLE}`,
  },
  {
    file: "clip-6.png",
    size: "1344x768",
    prompt: `A ${GIRL} gasping in happy surprise with sparkling eyes, floating glowing gift boxes and coin shower around her, donation alert vibes, ${STYLE}`,
  },
  {
    file: "rec-1.png",
    size: "1344x768",
    prompt: `Anime VTuber horror game marathon: a ${GIRL} in a dark room lit only by monitor glow showing a scary misty forest game, purple ambient light, cinematic tension, ${STYLE}`,
  },
  {
    file: "rec-2.png",
    size: "1344x768",
    prompt: `Anime VTuber karaoke night: a ${GIRL} under a single purple spotlight holding a microphone, musical notes floating in dark, cozy stage, ${STYLE}`,
  },
  {
    file: "rec-3.png",
    size: "1344x768",
    prompt: `A ${GIRL} thoughtfully answering viewer questions, floating glowing chat message cards around her, friendly gesture, ${STYLE}`,
  },
  {
    file: "rec-4.png",
    size: "1344x768",
    prompt: `A ${GIRL} celebrating a follower milestone with a small cake, confetti, balloons and fireworks, purple party lighting, joyful energy, ${STYLE}`,
  },
  {
    file: "guest-1.png",
    size: "1024x1024",
    prompt: `Portrait of a cute anime VTuber girl with mint-green hair and star hairpins, cheerful bright smile, streaming microphone in front, dark graphite background with teal neon glow, vibrant anime illustration, high quality, detailed`,
  },
  {
    file: "guest-2.png",
    size: "1024x1024",
    prompt: `Portrait of a cool anime VTuber boy with dark hair and glowing amber eyes, esports jacket, gaming headphones around neck, dark graphite background with warm gold neon accents, vibrant anime illustration, high quality, detailed`,
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const zai = await ZAI.create();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of JOBS) {
    const out = path.join(OUT, job.file);
    if (fs.existsSync(out) && fs.statSync(out).size > 10_000) {
      console.log(`↷ skip ${job.file} (exists)`);
      skipped++;
      continue;
    }
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await zai.images.generations.create({
          prompt: job.prompt,
          size: job.size,
        });
        const b64 = res.data?.[0]?.base64;
        if (!b64) throw new Error("empty response");
        fs.writeFileSync(out, Buffer.from(b64, "base64"));
        console.log(`✓ ${job.file} (${job.size})`);
        generated++;
        ok = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${job.file} attempt ${attempt}: ${msg}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!ok) failed++;
  }

  console.log(`DONE generated=${generated} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
