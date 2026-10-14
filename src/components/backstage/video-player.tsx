"use client";

// HLS-плеер «Бэкстейдж» с кастомными контролами и гейтингом доступа.
// Воспроизведение: hls.js (MSE) + нативный HLS для Safari.

import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import {
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  Settings,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
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

type Quality = { index: number; label: string };

export function VideoPlayer({
  src,
  poster,
  posterAccent,
  posterLabel,
  locked,
  lockTitle,
  lockDescription,
  lockChildren,
}: {
  src: string | null;
  poster?: string | null;
  posterAccent?: string;
  posterLabel?: string;
  locked?: boolean;
  lockTitle?: string;
  lockDescription?: string;
  lockChildren?: React.ReactNode;
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
          const list: Quality[] = hls.levels.map((l, i) => ({
            index: i,
            label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)}k`,
          }));
          setQualities(list);
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

  const onVolumeChange = useCallback((v: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v[0] ?? 0;
    video.muted = (v[0] ?? 0) === 0;
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
    if (hls?.liveSyncPosition != null) {
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

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "group relative aspect-video w-full overflow-hidden bg-black",
        fullscreen ? "aspect-auto h-full rounded-none" : "rounded-2xl"
      )}
    >
      {/* Постер для гостей / без источника */}
      {(locked || status === "no-source") && (
        <div className="absolute inset-0" aria-hidden={!locked}>
          {locked ? (
            <Thumb
              src={poster}
              alt=""
              accent={posterAccent ?? "#a970ff"}
              label={posterLabel ?? "B"}
              className="absolute inset-0 [&>img]:blur-md"
            />
          ) : (
            <div className="grid size-full place-items-center bg-[radial-gradient(100%_100%_at_50%_0%,#1d1d26_0%,#101014_100%)]">
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
          <div className="size-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      )}

      {/* Гейт доступа */}
      {locked && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/75 via-black/80 to-black/90 px-4 backdrop-blur-[2px]">
          <div className="fade-up max-w-md text-center">
            <div className="glow-primary mx-auto grid size-16 place-items-center rounded-full bg-primary/20 ring-1 ring-primary/40">
              <Lock className="size-7 text-primary" />
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

      {/* Контролы */}
      {!locked && src && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-1.5 pt-8 opacity-100 transition-opacity sm:px-3",
            playing && "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
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
              >
                <span className="size-1.5 rounded-full bg-live live-dot" aria-hidden />
                LIVE
              </button>
            )}

            <div className="group/vol flex items-center gap-1">
              <button
                onClick={toggleMute}
                aria-label={muted ? "Включить звук" : "Выключить звук"}
                className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
              >
                <VolumeIcon className="size-5" />
              </button>
              <div className="w-0 overflow-hidden transition-all duration-200 group-hover/vol:w-20 group-focus-within/vol:w-20 sm:w-16 sm:group-hover/vol:w-24">
                <Slider
                  value={[muted ? 0 : volume]}
                  onValueChange={onVolumeChange}
                  max={1}
                  step={0.05}
                  aria-label="Громкость"
                  className="py-1 [&_[data-slot=slider-track]]:h-1"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-1">
              {qualities.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Качество"
                      className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/15"
                    >
                      <Settings className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-36">
                    <DropdownMenuLabel>Качество</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setQuality(-1)}>
                      <span className={cn(currentQuality === -1 && "text-primary font-semibold")}>Авто</span>
                    </DropdownMenuItem>
                    {qualities.map((q) => (
                      <DropdownMenuItem key={q.index} onClick={() => setQuality(q.index)}>
                        <span className={cn(currentQuality === q.index && "text-primary font-semibold")}>{q.label}</span>
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
