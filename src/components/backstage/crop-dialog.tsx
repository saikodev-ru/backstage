"use client";

// Кадрирование загружаемого контента (Twitch-стиль): аватар — круг 1:1,
// баннер — широкий 16:9. Диалог показывает зону кадрирования с перетаскиванием,
// зумом колесом/ползунком; результат отдаётся блобом (webp/jpg) — загрузку
// на сервер выполняет CropUploadButton (POST /api/upload).
//
// Математика кадрирования: изображение рисуется transform-ом
// translate(tx, ty) scale(s) внутри зоны (box). Исходная раскладка
// (cover + центр) выводится из (loaded, box) через useMemo; правки
// пользователя хранятся отдельным стейтом (null = исходная раскладка).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const UPLOAD_MAX_SIZE = 5 * 1024 * 1024; // 5 МБ (синхронизировано с /api/upload)

/** Параметры кадра: пропорция, размер выхода, круглая маска превью */
export type CropTarget = {
  /** Название в заголовке диалога («АВАТАР», «БАННЕР») */
  title: string;
  /** Пропорция зоны кадрирования (w/h) */
  aspect: number;
  /** Ширина результата в пикселях (высота = ширина / aspect) */
  outputWidth: number;
  /** Показывать круглую маску (аватар) */
  circular?: boolean;
};

export const CROP_AVATAR: CropTarget = { title: "АВАТАР", aspect: 1, outputWidth: 400, circular: true };
export const CROP_BANNER: CropTarget = { title: "БАННЕР", aspect: 16 / 9, outputWidth: 1600 };

/** webp-энкодинг поддерживается? (иначе jpeg) */
let webpSupported: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupported === null) {
    try {
      webpSupported = document
        .createElement("canvas")
        .toDataURL("image/webp")
        .startsWith("data:image/webp");
    } catch {
      webpSupported = false;
    }
  }
  return webpSupported;
}

type Loaded = { url: string; nw: number; nh: number };

type Transform = { scale: number; tx: number; ty: number };

/**
 * Диалог кадрирования: file → блоб нужной пропорции.
 * onApply получает блоб и выполняет загрузку; верните true, чтобы закрыть
 * диалог (успех), false — оставить открытым (ошибка).
 */
export function CropDialog({
  file,
  target,
  open,
  onOpenChange,
  onApply,
  working = false,
}: {
  file: File | null;
  target: CropTarget;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApply: (blob: Blob) => Promise<boolean>;
  /** Кнопка «ПРИМЕНИТЬ» в состоянии загрузки (управляет вызывающий) */
  working?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Правки пользователя; null — исходная cover-раскладка (сброс)
  const [userTr, setUserTr] = useState<Transform | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── Загрузка выбранного файла в <img> (стейт — только в async-колбэках) ─
  useEffect(() => {
    if (!open || !file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    let alive = true;
    img.onload = () => {
      if (alive) setLoaded({ url, nw: img.naturalWidth, nh: img.naturalHeight });
    };
    img.onerror = () => {
      if (!alive) return;
      toast({ title: "Не удалось открыть изображение", variant: "destructive" });
      onOpenChange(false);
    };
    img.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [open, file, onOpenChange]);

  // ── Размер зоны кадрирования: ≤400px по ширине, ≤46vh по высоте ───────
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const avail = Math.max(200, containerRef.current?.clientWidth ?? 400);
      const w = Math.min(avail, 400, window.innerWidth - 64);
      const h = Math.min(w / target.aspect, window.innerHeight * 0.46);
      setBox({ w: Math.round(h * target.aspect), h: Math.round(h) });
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [open, target.aspect]);

  // ── Исходная раскладка (выводится из данных, не хранится в стейте) ────
  const base = useMemo(() => {
    if (!loaded || !box) return null;
    const cover = Math.max(box.w / loaded.nw, box.h / loaded.nh);
    return {
      cover,
      tr: {
        scale: cover,
        tx: (box.w - loaded.nw * cover) / 2,
        ty: (box.h - loaded.nh * cover) / 2,
      } satisfies Transform,
    };
  }, [loaded, box]);

  const tr = userTr ?? base?.tr ?? null;
  const minScale = base?.cover ?? 1;

  const clampTr = useCallback(
    (next: Transform): Transform => {
      if (!loaded || !box) return next;
      const scale = Math.min(Math.max(next.scale, minScale), minScale * 8);
      return {
        scale,
        tx: Math.min(0, Math.max(box.w - loaded.nw * scale, next.tx)),
        ty: Math.min(0, Math.max(box.h - loaded.nh * scale, next.ty)),
      };
    },
    [loaded, box, minScale]
  );

  /** Зум вокруг точки (cx, cy) зоны */
  const zoomAt = useCallback(
    (from: Transform, nextScale: number, cx: number, cy: number): Transform => {
      const scale = Math.min(Math.max(nextScale, minScale), minScale * 8);
      const k = scale / from.scale;
      return clampTr({ scale, tx: cx - (cx - from.tx) * k, ty: cy - (cy - from.ty) * k });
    },
    [minScale, clampTr]
  );

  // ── Перетаскивание ─────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tr) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* синтетические/устаревшие pointerId — просто продолжаем перетаскивание */
    }
    dragRef.current = { x: e.clientX, y: e.clientY, tx: tr.tx, ty: tr.ty };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !tr) return;
    setUserTr(
      clampTr({ ...tr, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) })
    );
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  // ── Зум колесом (вокруг курсора). Слушатель перерегистрируется при
  // каждом изменении трансформа — замыкание всегда видит свежий tr.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!tr) return;
      const nextScale = tr.scale * Math.exp(-e.deltaY * 0.0012);
      const rect = vp.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setUserTr(zoomAt(tr, nextScale, cx, cy));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomAt, tr, loaded, box]);

  // ── Зум ползунком (вокруг центра) ─────────────────────────────────────
  const onSlider = (v: number) => {
    if (!tr || !box) return;
    setUserTr(zoomAt(tr, v, box.w / 2, box.h / 2));
  };

  const reset = () => setUserTr(null);

  // ── Применить: канвас выходного размера → блоб → загрузка ──────────────
  const apply = async () => {
    const img = imgRef.current;
    if (!img || !tr || !box || !loaded) return;
    const outW = target.outputWidth;
    const outH = Math.round(target.outputWidth / target.aspect);
    const k = outW / box.w;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, tr.tx * k, tr.ty * k, loaded.nw * tr.scale * k, loaded.nh * tr.scale * k);
    const mime = supportsWebp() ? "image/webp" : "image/jpeg";
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast({ title: "Не удалось создать изображение", variant: "destructive" });
          return;
        }
        void onApply(blob).then((ok) => {
          if (ok) onOpenChange(false);
        });
      },
      mime,
      0.92
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-md rounded-2xl border-white/[.06] p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle className="headline text-base">КАДРИРОВАНИЕ · {target.title}</DialogTitle>
          <DialogDescription>
            Перетащите изображение, чтобы выбрать область · колесо мыши или ползунок — масштаб
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center" ref={containerRef}>
          {loaded && box && (
            <div
              ref={viewportRef}
              className={cn(
                "relative touch-none select-none overflow-hidden rounded-lg bg-black/70 ring-1 ring-white/15",
                dragging ? "cursor-grabbing" : "cursor-grab"
              )}
              style={{ width: box.w, height: box.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              role="application"
              aria-label={`Область кадрирования ${target.title}`}
            >
              <img
                ref={imgRef}
                src={loaded.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none"
                style={{
                  transform: tr ? `translate(${tr.tx}px, ${tr.ty}px) scale(${tr.scale})` : undefined,
                  transformOrigin: "0 0",
                }}
              />
              {/* Круглая маска (аватар): всё вне круга затемняется */}
              {target.circular && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.62)]"
                />
              )}
            </div>
          )}
        </div>

        {/* Масштаб */}
        {tr && (
          <div className="mt-3.5 flex items-center gap-2.5">
            <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={minScale}
              max={minScale * 8}
              step={minScale / 100}
              value={tr.scale}
              onChange={(e) => onSlider(parseFloat(e.target.value))}
              aria-label="Масштаб изображения"
              className="h-4 flex-1 cursor-pointer accent-white"
            />
            <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Сбросить кадрирование"
              title="Сбросить"
              className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
              onClick={reset}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        )}

        <DialogFooter className="mt-1 gap-2">
          <Button
            type="button"
            variant="ghost"
            className="label-caps rounded-full px-4 text-[11px] text-muted-foreground"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            ОТМЕНИТЬ
          </Button>
          <Button
            type="button"
            className="btn-gradient glow-primary label-caps gap-2 rounded-full px-5 text-[11px]"
            onClick={() => void apply()}
            disabled={working || !tr}
          >
            {working ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {working ? "ЗАГРУЖАЕМ…" : "ПРИМЕНИТЬ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Кнопка «Загрузить…»: выбор файла → диалог кадрирования → POST /api/upload
 * → onUploaded(url). Валидирует тип и размер до открытия диалога.
 */
export function CropUploadButton({
  target,
  onUploaded,
  label = "ЗАГРУЗИТЬ",
}: {
  target: CropTarget;
  onUploaded: (url: string) => void;
  label?: string;
}) {
  const inputId = useRef(`crop-up-${Math.random().toString(36).slice(2, 9)}`);
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast({ title: "Только изображения", description: "jpg / png / webp / gif", variant: "destructive" });
      return;
    }
    if (f.size > UPLOAD_MAX_SIZE) {
      toast({ title: "Файл больше 5 МБ", description: "Выберите изображение поменьше", variant: "destructive" });
      return;
    }
    setFile(f);
    setOpen(true);
  };

  const upload = async (blob: Blob): Promise<boolean> => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "crop.webp");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message ?? `HTTP ${res.status}`);
      onUploaded(data.url);
      toast({ title: "Файл загружен", description: "Нажмите «Сохранить», чтобы применить" });
      return true;
    } catch (e) {
      toast({
        title: "Ошибка загрузки",
        description: e instanceof Error ? e.message : "Ошибка",
        variant: "destructive",
      });
      return false;
    } finally {
      setUploading(false);
    }
  };

  // key: каждый новый файл пересоздаёт диалог — стейты кадрирования чистые
  return (
    <>
      <label
        htmlFor={inputId.current}
        className={cn(
          "label-caps h-9 flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-3 text-[11px] hover:bg-white/[.08]",
          uploading && "pointer-events-none opacity-60"
        )}
      >
        <Upload className="size-3.5" aria-hidden />
        {uploading ? "КАДРИРУЕМ…" : label}
        <input
          id={inputId.current}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = ""; // чтобы можно было выбрать тот же файл повторно
          }}
        />
      </label>

      {file && (
        <CropDialog
          key={`${file.name}-${file.size}-${file.lastModified}`}
          file={file}
          target={target}
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setFile(null);
          }}
          onApply={upload}
          working={uploading}
        />
      )}
    </>
  );
}
