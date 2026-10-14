import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Файлы складываются в public/uploads — в dev-режиме Next обслуживает
// их сразу по URL /uploads/<имя>; перезапуск сервера не нужен.

const MAX_SIZE = 5 * 1024 * 1024; // 5 МБ

/** Расширение по mime (для неизвестных image/* — консервативно jpg). */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * POST /api/upload — загрузка медиа (аватар/баннер) для администратора.
 * multipart/form-data, поле `file`; только image/*, не больше 5 МБ.
 * Имя файла генерируется на сервере (uuid+время) — пользовательский
 * ввод в имени не участвует. Ответ: { url: "/uploads/<name>" } 201.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_form", message: "Ожидается multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (typeof file !== "object" || file === null || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "bad_file", message: "Поле file обязательно" }, { status: 400 });
  }

  const mime = file.type || "";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "bad_type", message: "Только изображения (jpg/png/webp/gif)" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "too_large", message: "Файл больше 5 МБ" }, { status: 400 });
  }

  const ext = EXT_BY_MIME[mime] ?? "jpg";
  // Имя файла не зависит от пользовательского ввода
  const name = `${crypto.randomUUID().slice(0, 8)}${Date.now().toString(36)}.${ext}`;

  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/uploads/${name}` }, { status: 201 });
}
