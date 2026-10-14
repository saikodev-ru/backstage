"use client";

// HLS-плеер «Бэкстейдж» v3 «ГРАФИТ»: кастомные контролы в стиле Twitch.
// - громкость: нативный range со стилем .player-volume (не обрезается)
// - качество: «Источник (1080p60) / 720p60 / 480p / 360p / Авто» (уровни HLS)
// - кнопка «Клип» (заглушка — тост)
// Воспроизведение: hls.js (MSE) + нативный HLS для Safari.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Level } from "hls.js";
import type Hls from "hls.js";
import {
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  Scissors,
  Settings,
  Volume1,
  Volume2,
  VolumeX,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Thumb } from "@/components/backstage/cards";
import { toast } from "@/hooks/use-toast";

type Quality = { index: number; label: string; short: string };

type FpsLadder = { byHeight: Map<number, number>; sourceFps: number };

/** FPS уровня из атрибутов манифеста (HLS FRAME-RATE, если объявлен). */
function fpsOf(level: Level): number {
  const raw = (level.attrs as Record<string, string | undefined> | undefined)?.["FRAME-RATE"];
  const fps = raw ? parseFloat(raw) : 0;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 0;
}

/** Публичная лестница транскодинга (fps по высоте кадра) — из движка. */
async function fetchFpsLadder(): Promise<FpsLadder | null> {
  try {
    const res = await fetch("/api/stream/variants", { cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json()) as { variants?: Array<{ height: number | null; framerate: number }> };
    const byHeight = new Map<number, number>();
    let sourceFps = 0;
    for (const v of d.variants ?? []) {
      if (v.height == null) sourceFps = v.framerate;
      else if (v.framerate > 0) byHeight.set(v.height, v.framerate);
    }
    return { byHeight, sourceFps };
  } catch {
    return null;
  }
}

export function VideoPlayer({
  src,
  poster,
  posterAccent,
  posterLabel,
  locked,
  lockTitle,
  lockDescription,
  lockChildren,
  liveStartedAt,
}: {
  src: string | null;
  poster?: string | null;
  posterAccent?: string;
  posterLabel?: string;
  locked?: boolean;
  lockTitle?: string;
  lockDescription?: string;
  lockChildren?: React.ReactNode;
  /** ISO-старт эфира — плеер показывает живой таймер H:MM:SS вместо LIVE */
  liveStartedAt?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [fullscreen, setFullscreen] = useState(false);
  const [qualities, setQualities] = useState<Quality[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [isLive, setIsLive] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-source">("loading");
  const [uptime, setUptime] = useState<string | null>(null);

  // ── Живой таймер эфира (H:MM:SS, тикает каждую секунду) ───────────────
  useEffect(() => {
    const startedAtMs = liveStartedAt ? new Date(liveStartedAt).getTime() : NaN;
    if (!Number.isFinite(startedAtMs)) return;
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const mm = String(m).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      setUptime(h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`);
    };
    // первый тик и перевооружение — через макротаску (без синхронного setState в эффекте)
    const t0 = window.setTimeout(tick, 0);
    const t = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(t);
    };
  }, [liveStartedAt]);

  // ── Инициализация HLS ───────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || locked || !src) {
      if (!src) setStatus("no-source");
      return;
    }
    let disposed = false;
    setStatus("loading");

    (async () => {
      const mod = await import("hls.js");
      const HlsCtor = mod.default;
      if (disposed || !video) return;

      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({
          lowLatencyMode: true,
          enableWorker: true,
          backBufferLength: 30,
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(src);

        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          setStatus("ready");
          // Варианты качества: верхний уровень = «Источник» (ингест без даунскейла).
          // Owncast не публикует fps в манифесте — подтягиваем лестницу из движка
          // и дописываем «1080p60 / 720p60 / 480p / 360p» как только узнаем fps.
          const levels = hls.levels;
          const build = (ladder: FpsLadder | null): Quality[] =>
            levels.map((l, i) => {
              const h = l.height ?? 0;
              const isTop = i === levels.length - 1;
              const fps = fpsOf(l) || (isTop ? ladder?.sourceFps ?? 0 : ladder?.byHeight.get(h) ?? 0);
              const short = h ? `${h}p${fps >= 50 ? fps : ""}` : `${Math.round((l.bitrate ?? 0) / 1000)}k`;
              return { index: i, short, label: isTop && h ? `Источник (${short})` : short };
            });
          setQualities(build(null));
          void fetchFpsLadder().then((ladder) => {
            if (disposed || !ladder) return;
            setQualities(build(ladder));
          });
          void video.play().catch(() => setPlaying(false));
        });
        hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => {
          setCurrentQuality(hls.autoLevelEnabled ? -1 : data.level);
        });
        hls.on(HlsCtor.Events.LEVEL_LOADED, (_e, data) => {
          // Живой ли плейлист: у hls.js длительность окна конечна (~9с),
          // поэтому статус LIVE берём из манифеста
          setIsLive(Boolean(data.details?.live));
        });
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          setStatus("error");
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        setStatus("ready");
        void video.play().catch(() => setPlaying(false));
      } else {
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, locked]);

  // ── События видео ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const onDuration = () => {
      // нативный live (Safari): длительность бесконечна
      if (!Number.isFinite(video.duration)) setIsLive(true);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("durationchange", onDuration);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("durationchange", onDuration);
    };
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  }, []);

  const onVolumeInput = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void wrapRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const seekToLive = useCallback(() => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    if (video && hls?.liveSyncPosition != null) {
      video.currentTime = hls.liveSyncPosition;
    } else if (video && Number.isFinite(video.duration)) {
      video.currentTime = video.duration;
    }
    void video?.play().catch(() => {});
  }, []);

  const setQuality = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index;
    setCurrentQuality(index);
  }, []);

  /** Кнопка «Клип» — заглушка (ТЗ: «хотя бы как заглушка»). */
  const makeClip = useCallback(() => {
    toast({
      title: "Клип создан",
      description: "Последние 30 секунд записываются (заглушка — скоро будет полноценно)",
    });
  }, []);

  // ── Клавиатура: space/k — пауза, m — звук, f — фулскрин ────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || locked) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === " " || e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "m") {
        toggleMute();
      } else if (e.key.toLowerCase() === "f") {
        toggleFullscreen();
      }
    };
    wrap.addEventListener("keydown", onKey);
    return () => wrap.removeEventListener("keydown", onKey);
  }, [locked, togglePlay, toggleMute, toggleFullscreen]);

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const volPct = Math.round((muted ? 0 : volume) * 100);
  const currentLabel =
    currentQuality === -1 ? "АВТО" : (qualities.find((q) => q.index === currentQuality)?.short ?? "");

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="region"
      aria-label="Видеоплеер трансляции"
      className={cn(
        "group/player relative aspect-video w-full overflow-hidden bg-black outline-none",
        fullscreen ? "aspect-auto h-full rounded-none" : "rounded-none"
      )}
    >
      {/* Постер для гостей / без источника */}
      {(locked || status === "no-source") && (
        <div className="absolute inset-0" aria-hidden={!locked}>
          {locked ? (
            <Thumb
              src={poster}
              alt=""
              accent={posterAccent ?? "#6f6f78"}
              label={posterLabel ?? "B"}
              className="absolute inset-0 [&>img]:blur-md"
            />
          ) : (
            <div className="grid size-full place-items-center bg-[radial-gradient(100%_100%_at_50%_0%,#1d1d22_0%,#101013_100%)]">
              <div className="text-center">
                <div className="mx-auto grid size-16 place-items-center rounded-full bg-secondary/60">
                  <Play className="size-7 text-muted-foreground/60" />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">Ожидание источника эфира…</p>
              </div>
            </div>
          )}
        </div>
      )}

      <video
        ref={videoRef}
        poster={undefined}
        playsInline
        autoPlay
        muted
        className={cn("size-full object-contain", (locked || status === "no-source") && "invisible")}
        aria-label="Видеоплеер трансляции"
      />

      {/* Загрузка */}
      {status === "loading" && !locked && src && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      )}

      {/* Гейт доступа */}
      {locked && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/75 via-black/80 to-black/90 px-4 backdrop-blur-[2px]">
          <div className="fade-up max-w-md text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-white/[.06] ring-1 ring-white/15">
              <Lock className="size-7 text-foreground/90" />
            </div>
            <h3 className="headline mt-5 text-lg sm:text-xl">{lockTitle ?? "ПРИВАТНАЯ ТРАНСЛЯЦИЯ"}</h3>
            <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {lockDescription ?? "Доступ к эфиру — только для платных подписчиков приватного Telegram-канала."}
            </p>
            {lockChildren && <div className="mt-5 flex flex-col items-center gap-2.5">{lockChildren}</div>}
          </div>
        </div>
      )}

      {/* Ошибка */}
      {status === "error" && !locked && (
        <div className="absolute inset-0 grid place-items-center bg-black/70">
          <p className="px-4 text-center text-sm text-muted-foreground">
            Не удалось загрузить поток. Проверьте HLS-адрес в панели управления.
          </p>
        </div>
      )}

      {/* Клик по видео = пауза */}
      {!locked && src && status === "ready" && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Пауза" : "Воспроизвести"}
          className="absolute inset-0 cursor-pointer"
        />
      )}

      {/* «Включить звук» — автоплей стартует без звука (как в Twitch) */}
      {!locked && src && muted && status === "ready" && (
        <button
          type="button"
          onClick={toggleMute}
          className="glass-strong label-caps absolute bottom-16 left-3 z-20 flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] text-foreground transition-transform hover:scale-[1.03] sm:bottom-[4.5rem]"
        >
          <VolumeX className="size-4" />
          ВКЛЮЧИТЬ ЗВУК
        </button>
      )}

      {/* Контролы */}
      {!locked && src && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-1.5 pt-8 opacity-100 transition-opacity sm:px-3",
            playing && "opacity-0 group-hover/player:opacity-100 focus-within:opacity-100"
          )}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={togglePlay}
              aria-label={playing ? "Пауза" : "Воспроизвести"}
              className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
            >
              {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
            </button>

            {isLive && (
              <button
                onClick={seekToLive}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-white/15"
                aria-label="Перейти к живому эфиру"
                title={uptime ? `В эфире ${uptime}` : "В эфире"}
              >
                <span className="size-1.5 rounded-full bg-live live-dot" aria-hidden />
                <span className="font-mono tabular-nums tracking-tight">
                  {liveStartedAt ? (uptime ?? "LIVE") : "LIVE"}
                </span>
              </button>
            )}

            {/* Громкость: нативный range, стили .player-volume (глобальные) */}
            <div className="group/vol flex items-center gap-1">
              <button
                onClick={toggleMute}
                aria-label={muted ? "Включить звук" : "Выключить звук"}
                className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
              >
                <VolumeIcon className="size-5" />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeInput(parseFloat(e.target.value))}
                aria-label="Громкость"
                className="player-volume w-14 transition-[width] duration-200 group-hover/vol:w-24 group-focus-within/vol:w-24 sm:w-20 sm:group-hover/vol:w-28"
                style={{ "--vol": `${volPct}%` } as React.CSSProperties}
              />
            </div>

            <div className="ml-auto flex items-center gap-1">
              {/* Текущее качество (метка у гайки, как в Twitch) */}
              {qualities.length > 1 && (
                <span
                  aria-hidden
                  className="label-caps hidden px-1.5 text-[10px] font-bold text-white/80 sm:inline"
                >
                  {currentLabel}
                </span>
              )}

              {/* Клип (заглушка) */}
              <button
                onClick={makeClip}
                aria-label="Создать клип"
                title="Клип (заглушка)"
                className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
              >
                <Scissors className="size-5" />
              </button>

              {/* Качество */}
              {qualities.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Настройки качества"
                      className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
                    >
                      <Settings className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="glass-strong min-w-44 rounded-xl">
                    <DropdownMenuLabel className="label-caps text-[11px]">КАЧЕСТВО</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setQuality(-1)} className="gap-2">
                      <Check className={cn("size-3.5", currentQuality === -1 ? "opacity-100" : "opacity-0")} />
                      <span className={cn(currentQuality === -1 && "font-bold text-foreground")}>Авто</span>
                    </DropdownMenuItem>
                    {qualities.map((q) => (
                      <DropdownMenuItem key={q.index} onClick={() => setQuality(q.index)} className="gap-2">
                        <Check
                          className={cn("size-3.5", currentQuality === q.index ? "opacity-100" : "opacity-0")}
                        />
                        <span className={cn(currentQuality === q.index && "font-bold text-foreground")}>
                          {q.label}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <button
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Выйти из полного экрана" : "Полный экран"}
                className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
              >
                {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
