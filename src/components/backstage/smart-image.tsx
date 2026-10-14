"use client";

// SmartImage: blur-up превью.
// 1. Пока картинка грузится — виден размытый low-res (base64 16px из BLUR_MAP).
// 2. Полная картинка проявляется поверх (fade + unblur).
// 3. Если картинка НЕ ЗАГРУЗИЛАСЬ — low-res блюр остаётся навсегда
//    (плюс мягкий градиент с буквой канала, если плейсхолдера нет).

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BLUR_MAP } from "@/lib/blur-map";

export function SmartImage({
  src,
  alt,
  accent,
  label,
  className,
  imgClassName,
  eager = false,
}: {
  src?: string | null;
  alt: string;
  accent?: string;
  label?: string;
  className?: string;
  imgClassName?: string;
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const blur = src ? BLUR_MAP[src] : undefined;

  return (
    <div className={cn("relative overflow-hidden bg-[#15151b]", className)}>
      {/* Слой 1: размытый low-res плейсхолдер (или градиент-фолбэк) */}
      {blur ? (
        <div
          aria-hidden
          className="absolute inset-0 scale-110 bg-cover bg-center blur-xl"
          style={{ backgroundImage: `url(${blur})` }}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: "radial-gradient(120% 120% at 30% 20%, #232329 0%, #141418 55%), linear-gradient(160deg, #1a1a1f 0%, #101014 100%)",
          }}
        />
      )}

      {/* Слой 2: полная картинка, проявляется при загрузке */}
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "relative size-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName
          )}
        />
      )}

      {/* Ошибка загрузки: блюр остаётся + лейбл */}
      {failed && label && (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center text-4xl font-black tracking-tight text-[#d6d6de] opacity-30"
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}
