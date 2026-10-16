"use client";

// Панель «УПРАВЛЕНИЕ ЭФИРОМ» (пилюля в топбаре, только ведущий).
// Широкий диалог с двумя категориями настроек:
//   ОСНОВНЫЕ     — тип эфира (открытый/закрытый), название, категория, теги.
//   РАСШИРЕННЫЕ  — качество трансляции (чекбоксы вариантов Owncast),
//                  задержка эфира (пресеты как у Twitch/YouTube + живой вход),
//                  подключение OBS (сервер + ключ, регенерация при утечке),
//                  тестовый эфир и тестовый чат (только демо-режим).
// Концепция: один инстанс — один ведущий канал (channels[0]).
// Мульти-авторство убрано: инстансы соединяются бэкендом/фронтендом между собой.

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  MonitorPlay,
  Play,
  Radio,
  RefreshCcw,
  Save,
  Server,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { CategoryPicker } from "@/components/backstage/category-picker";
import { useBackstageStore } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { PublicChannel } from "@/lib/types";
import type { OwncastVariant } from "@/lib/owncast-admin";

/* ── Задержка эфира: пресеты latencyLevel движка (Twitch/YouTube-стиль) ── */

const LATENCY_PRESETS: { level: number; label: string; hint: string; note: string }[] = [
  {
    level: 2,
    label: "СТАНДАРТ",
    hint: "~10 с · максимум стабильности",
    note: "Сегменты 3 с, окно 10 сегментов. Обычный HLS-эфир (Twitch «Normal»).",
  },
  {
    level: 1,
    label: "НИЗКАЯ",
    hint: "~6–8 с · баланс",
    note: "Сегменты 2 с, окно 15. Идеально сочетается с ключевыми кадрами OBS = 2 с.",
  },
  {
    level: 0,
    label: "МИНИМАЛЬНАЯ",
    hint: "~4–6 с · максимум скорости",
    note: "Сегменты 1 с, окно 25. Выше нагрузка на сеть зрителей, возможны рывки (YouTube «Ultra-low»).",
  },
];

/* ── Типы ─────────────────────────────────────────────────────────────── */

/** Состояние движка Owncast + демо-эфира (GET /api/admin/demo-stream) */
type EngineState = {
  running: boolean;
  engine: { engine: "owncast"; reachable: boolean; online: boolean; version: string; baseUrl: string };
  rtmp: { url: string; key: string };
  hls: { url: string };
};

/** Реестр Telegram-каналов платных подписок (закрытые эфиры) */
type TgChannelRow = { id: string; title: string; chatId: string; link: string | null; note: string | null };

type Draft = {
  liveTitle: string;
  liveCategory: string;
  liveTags: string;
  access: "public" | "private";
  requiredTgId: string | null;
};

/* ── Варианты качества (чекбоксы) ─────────────────────────────────────── */

const QUALITY_OPTIONS: { key: string; label: string; hint: string; variant: OwncastVariant }[] = [
  {
    key: "source",
    label: "Источник",
    hint: "до 1080p60 · ~6 Мбит/с",
    variant: {
      name: "Источник",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 6000,
      audioBitrate: 128,
      scaledWidth: null,
      scaledHeight: null,
      cpuUsageLevel: 2,
      framerate: 60,
    },
  },
  {
    key: "720p60",
    label: "720p60",
    hint: "2,8 Мбит/с",
    variant: {
      name: "720p60",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 2800,
      audioBitrate: 128,
      scaledWidth: 1280,
      scaledHeight: 720,
      cpuUsageLevel: 2,
      framerate: 60,
    },
  },
  {
    key: "720p",
    label: "720p",
    hint: "1,8 Мбит/с",
    variant: {
      name: "720p",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 1800,
      audioBitrate: 128,
      scaledWidth: 1280,
      scaledHeight: 720,
      cpuUsageLevel: 2,
      framerate: 30,
    },
  },
  {
    key: "480p",
    label: "480p",
    hint: "1,1 Мбит/с",
    variant: {
      name: "480p",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 1100,
      audioBitrate: 128,
      scaledWidth: 854,
      scaledHeight: 480,
      cpuUsageLevel: 2,
      framerate: 30,
    },
  },
  {
    key: "360p",
    label: "360p",
    hint: "550 Кбит/с",
    variant: {
      name: "360p",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 550,
      audioBitrate: 96,
      scaledWidth: 640,
      scaledHeight: 360,
      cpuUsageLevel: 2,
      framerate: 30,
    },
  },
  {
    key: "240p",
    label: "240p",
    hint: "350 Кбит/с",
    variant: {
      name: "240p",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 350,
      audioBitrate: 96,
      scaledWidth: 426,
      scaledHeight: 240,
      cpuUsageLevel: 2,
      framerate: 30,
    },
  },
];

/** Дефолтная лестница: Источник + 720p + 480p */
const DEFAULT_QUALITY = ["source", "720p", "480p"];

/** Имя варианта движка → ключ чекбокса (легаси-пресеты тоже распознаём) */
function keyOfVariantName(name: string): string | null {
  const n = name.toLowerCase().replace(/\s+/g, "");
  if (n.includes("источник") || n.includes("source")) return "source";
  if (n === "720p60") return "720p60";
  if (n === "720p") return "720p";
  if (n === "480p") return "480p";
  if (n === "360p") return "360p";
  if (n === "240p") return "240p";
  return null;
}

function draftOf(c: PublicChannel): Draft {
  return {
    liveTitle: c.liveTitle ?? "",
    liveCategory: c.liveCategory ?? "",
    liveTags: c.liveTags.join(", "),
    access: c.access === "private" ? "private" : "public",
    requiredTgId: null, // подставляется при загрузке (в PublicChannel поле не экспонируется)
  };
}

/* ── Панель ───────────────────────────────────────────────────────────── */

export function AdminPanel() {
  const { adminOpen, setAdminOpen, channels, setChannels, patchChannel, demoAuth } = useBackstageStore();

  const [tab, setTab] = useState<"basic" | "advanced">("basic");

  // Единственный канал инстанса
  const channel = channels[0] ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (channel && adminOpen) {
      setDraft((prev) => prev ?? draftOf(channel));
    }
    if (!adminOpen) setDraft(null);
  }, [channel, adminOpen]);

  useEffect(() => {
    if (!adminOpen) setTab("basic");
  }, [adminOpen]);

  /* ── Движок Owncast: статус + демо-эфир ────────────────────────── */
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const refreshEngine = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/demo-stream", { cache: "no-store" });
      if (!res.ok) return;
      setEngineState((await res.json()) as EngineState);
    } catch {
      /* движок не отвечает */
    }
  }, []);

  useEffect(() => {
    if (!adminOpen) return;
    void refreshEngine();
    const t = setInterval(() => void refreshEngine(), 10_000);
    return () => clearInterval(t);
  }, [adminOpen, refreshEngine]);

  const toggleDemoStream = useCallback(
    async (action: "start" | "stop") => {
      setDemoBusy(true);
      try {
        const res = await fetch("/api/admin/demo-stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const d = (await res.json()) as { ok?: boolean; message?: string };
        if (!res.ok || !d.ok) throw new Error(d.message ?? "Ошибка");
        toast({
          title: action === "start" ? "Тестовый эфир запущен" : "Тестовый эфир остановлен",
          description:
            action === "start"
              ? "ffmpeg пушит RTMP в Owncast — плеер покажет поток через несколько секунд"
              : "Эфир завершён, витрина перейдёт в оффлайн",
        });
        await refreshEngine();
        const ch = await fetch("/api/channels", { cache: "no-store" }).then(
          (r) => r.json() as Promise<{ channels?: PublicChannel[] }>
        );
        if (ch.channels) setChannels(ch.channels);
      } catch (e) {
        toast({ title: "Ошибка тестового эфира", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
      } finally {
        setDemoBusy(false);
      }
    },
    [refreshEngine, setChannels]
  );

  /* ── Тестовый чат (демо): /demo on|off через чат-сервис ────────── */
  const [demoChat, setDemoChat] = useState<boolean | null>(null);

  const chatSend = useCallback(
    async (text: string) => {
      if (!channel) return false;
      try {
        const tr = await fetch("/api/chat/token", { cache: "no-store" });
        if (!tr.ok) throw new Error("нет токена");
        const { token } = (await tr.json()) as { token: string };
        const res = await fetch(`/api/send?XTransformPort=3003`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ channelSlug: channel.slug, text }),
        });
        const d = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !d.ok) throw new Error(d.error ?? "ошибка");
        return true;
      } catch (e) {
        toast({ title: "Команда не выполнена", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
        return false;
      }
    },
    [channel]
  );

  const refreshDemoChat = useCallback(async () => {
    if (!channel) return;
    try {
      const s = await fetch(`/api/chstate?channel=${encodeURIComponent(channel.slug)}&XTransformPort=3003`, {
        cache: "no-store",
      }).then((r) => r.json() as Promise<{ demo?: boolean }>);
      setDemoChat(Boolean(s.demo));
    } catch {
      /* чат-сервис недоступен */
    }
  }, [channel]);

  useEffect(() => {
    if (adminOpen && demoAuth) void refreshDemoChat();
  }, [adminOpen, demoAuth, refreshDemoChat]);

  /* ── Качество трансляции: чекбоксы ← движок ────────────────────── */
  const [quality, setQuality] = useState<string[] | null>(null); // null = грузим
  const [qualityBusy, setQualityBusy] = useState(false);

  const loadQuality = useCallback(async () => {
    setQuality(null);
    try {
      const res = await fetch("/api/admin/stream-config", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { videoSettings?: { videoQualityVariants?: OwncastVariant[] } | null };
      const variants = d.videoSettings?.videoQualityVariants ?? [];
      const keys = variants
        .map((v) => keyOfVariantName(v.name ?? ""))
        .filter((k): k is string => k !== null);
      setQuality(keys.length > 0 ? Array.from(new Set(keys)) : [...DEFAULT_QUALITY]);
    } catch {
      setQuality([...DEFAULT_QUALITY]);
    }
  }, []);

  useEffect(() => {
    if (adminOpen && tab === "advanced") void loadQuality();
  }, [adminOpen, tab, loadQuality]);

  const applyQuality = useCallback(async () => {
    if (!quality || quality.length === 0) return;
    setQualityBusy(true);
    try {
      const variants = QUALITY_OPTIONS.filter((o) => quality.includes(o.key)).map((o) => o.variant);
      const res = await fetch("/api/admin/stream-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "variants", variants }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        message?: string;
        restarted?: boolean;
        needsEngineRestart?: boolean;
      };
      if (!res.ok || !d.ok) throw new Error(d.message ?? "Ошибка применения");
      toast({
        title: d.restarted ? "Качество применено" : "Качество сохранено в движке",
        description: d.needsEngineRestart
          ? "Эфир идёт — лестница вступит в силу после перезапуска движка: остановите эфир и примените снова"
          : `Вариантов в лестнице: ${variants.length}${d.restarted ? " · движок перезапущен" : ""}`,
      });
      await loadQuality();
    } catch (e) {
      toast({ title: "Не удалось применить качество", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setQualityBusy(false);
    }
  }, [quality, loadQuality]);

  /* ── Задержка эфира: уровень движка + живой ингест ── */
  const [latency, setLatency] = useState<number | null>(null); // null = грузим
  const [latencyBusy, setLatencyBusy] = useState(false);
  const [ingest, setIngest] = useState<{
    width: number | null;
    height: number | null;
    framerate: number | null;
    videoBitrate: number | null;
  } | null>(null);

  const loadLatency = useCallback(async () => {
    setLatency(null);
    try {
      const res = await fetch("/api/admin/stream-config", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as {
        videoSettings?: { latencyLevel?: number } | null;
        ingest?: {
          width: number | null;
          height: number | null;
          framerate: number | null;
          videoBitrate: number | null;
        } | null;
      };
      setLatency(typeof d.videoSettings?.latencyLevel === "number" ? d.videoSettings.latencyLevel : 2);
      setIngest(d.ingest ?? null);
    } catch {
      setLatency(2);
    }
  }, []);

  useEffect(() => {
    if (adminOpen && tab === "advanced") void loadLatency();
  }, [adminOpen, tab, loadLatency]);

  const applyLatency = useCallback(
    async (level: number) => {
      if (latencyBusy) return;
      setLatencyBusy(true);
      try {
        const res = await fetch("/api/admin/stream-config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "latency", value: level }),
        });
        const d = (await res.json()) as {
          ok?: boolean;
          message?: string;
          restarted?: boolean;
          needsEngineRestart?: boolean;
        };
        if (!res.ok || !d.ok) throw new Error(d.message ?? "Ошибка применения");
        setLatency(level);
        const preset = LATENCY_PRESETS.find((p) => p.level === level);
        toast({
          title: `Задержка: ${preset?.label.toLowerCase() ?? "уровень обновлён"}`,
          description: d.needsEngineRestart
            ? "Эфир идёт — режим вступит в силу со следующего эфира"
            : d.restarted
              ? "Движок перезапущен, режим активен"
              : "Режим активен для следующего эфира",
        });
      } catch (e) {
        toast({
          title: "Не удалось применить задержку",
          description: e instanceof Error ? e.message : "Ошибка",
          variant: "destructive",
        });
      } finally {
        setLatencyBusy(false);
      }
    },
    [latencyBusy]
  );

  /* ── Подключение: стрим-ключ (движок) ──────────────────────────── */
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const loadKey = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stream-key", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { key?: string };
      if (d.key) setStreamKey(d.key);
    } catch {
      /* движок недоступен */
    }
  }, []);

  useEffect(() => {
    if (adminOpen && tab === "advanced") void loadKey();
  }, [adminOpen, tab, loadKey]);

  const regenerateKey = useCallback(async () => {
    setRegenBusy(true);
    try {
      const res = await fetch("/api/admin/stream-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const d = (await res.json()) as { ok?: boolean; key?: string; message?: string };
      if (!res.ok || !d.ok || !d.key) throw new Error(d.message ?? "Ошибка");
      setStreamKey(d.key);
      setKeyVisible(true);
      setConfirmRegen(false);
      toast({
        title: "Ключ регенерирован",
        description: "Старый ключ больше не принимает подключения — обновите ключ в OBS",
      });
      await refreshEngine();
    } catch (e) {
      toast({ title: "Не удалось регенерировать ключ", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setRegenBusy(false);
    }
  }, [refreshEngine]);

  /* ── Закрытый эфир: реестр ТГК ─────────────────────────────────── */
  const [tgChannels, setTgChannels] = useState<TgChannelRow[]>([]);

  useEffect(() => {
    if (!adminOpen) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/telegram-channels", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as { telegramChannels?: TgChannelRow[] };
        if (alive && d.telegramChannels) setTgChannels(d.telegramChannels);
      } catch {
        /* реестр недоступен */
      }
    })();
    return () => {
      alive = false;
    };
  }, [adminOpen]);

  /* ── Сохранение «Основных» ─────────────────────────────────────── */
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!channel || !draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${channel.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          liveTitle: draft.liveTitle.trim() || null,
          liveCategory: draft.liveCategory || null,
          liveTags: draft.liveTags.split(",").map((t) => t.trim()).filter(Boolean),
          access: draft.access,
          requiredTelegramChatId: draft.access === "private" ? (draft.requiredTgId ?? "") : "",
        }),
      });
      const data = (await res.json()) as { channel?: PublicChannel; message?: string; error?: string };
      if (!res.ok || !data.channel) throw new Error(data.message ?? data.error ?? "Ошибка сохранения");
      patchChannel(channel.slug, data.channel);
      toast({
        title: "Настройки эфира сохранены",
        description: draft.access === "private" ? "Закрытый эфир: доступ по подписке ТГК" : "Открытый эфир: доступ всем",
      });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [channel, draft, patchChannel]);

  const copyText = useCallback((text: string, title: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title }))
      .catch(() => toast({ title: "Не удалось скопировать", variant: "destructive" }));
  }, []);

  /* ── Рендер ────────────────────────────────────────────────────── */

  const isLocalHost = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const isSandboxPreview = !isLocalHost;
  const rtmpUrl = "rtmp://127.0.0.1:1935/live";
  const bridgeCommand = `BRIDGE_URL="${typeof window !== "undefined" ? window.location.origin : ""}" bun scripts/obs-bridge-client.mjs`;
  const maskedKey =
    streamKey && streamKey.length > 8
      ? `${streamKey.slice(0, 5)}${"•".repeat(14)}${streamKey.slice(-3)}`
      : streamKey ?? "…";

  return (
    <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto border-border bg-card p-0 sm:max-w-3xl lg:max-w-4xl">
        {/* Шапка: строка заголовка с резервом справа (pr-12) — бейджи статусов
            никогда не налезают на кнопку-крестик (absolute top-4 right-4) */}
        <DialogHeader className="space-y-2 border-b border-white/[.06] p-5 pb-4 sm:p-6 sm:pb-4">
          <DialogTitle className="headline flex flex-wrap items-center gap-2.5 pr-12 text-base sm:text-lg">
            <Radio className="size-5 text-live" aria-hidden />
            УПРАВЛЕНИЕ ЭФИРОМ
            {engineState && (
              <span
                className={cn(
                  "label-caps ml-auto rounded-full px-2.5 py-0.5 text-[10px]",
                  engineState.engine.reachable ? "bg-[#5ad1a4]/15 text-[#5ad1a4]" : "bg-destructive/15 text-destructive"
                )}
              >
                {engineState.engine.reachable
                  ? `OWNCAST ${engineState.engine.version || "?"}`
                  : "ДВИЖОК НЕДОСТУПЕН"}
              </span>
            )}
            {engineState?.engine.online && (
              <span className="live-breathe label-caps flex items-center gap-1.5 rounded-full bg-live px-2.5 py-0.5 text-[10px] text-white">
                <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
                ЭФИР ИДЁТ
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Настройки трансляции инстанса. Категории: основные и расширенные.
          </DialogDescription>
        </DialogHeader>

        {/* Категории-табы */}
        <div className="flex gap-1 border-b border-white/[.06] px-4 pt-2 sm:px-6" role="tablist" aria-label="Категории настроек">
          {(
            [
              { key: "basic", label: "ОСНОВНЫЕ" },
              { key: "advanced", label: "РАСШИРЕННЫЕ" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "label-caps relative rounded-t-lg px-4 py-2.5 text-[12px] transition-colors",
                tab === t.key
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {t.label}
              {tab === t.key && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden />}
            </button>
          ))}
        </div>

        {/* Контент */}
        <div className="p-5 sm:p-6">
          {!channel ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Канал ведущего ещё не создан — он появится после первого входа автора.
            </p>
          ) : tab === "basic" && draft ? (
            /* ── ОСНОВНЫЕ ── */
            <div className="space-y-5">
              {/* Тип эфира */}
              <div className="space-y-2">
                <Label className="label-caps text-[11px] text-muted-foreground">ТИП ЭФИРА</Label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    aria-pressed={draft.access === "public"}
                    onClick={() => setDraft({ ...draft, access: "public" })}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-all",
                      draft.access === "public"
                        ? "border-primary/50 bg-primary/[.08]"
                        : "border-white/[.08] bg-white/[.02] hover:border-white/20"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Globe className={cn("size-4", draft.access === "public" ? "text-primary" : "text-muted-foreground")} aria-hidden />
                      ОТКРЫТЫЙ
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                      Эфир и чат доступны всем зрителям
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.access === "private"}
                    onClick={() => setDraft({ ...draft, access: "private" })}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-all",
                      draft.access === "private"
                        ? "border-primary/50 bg-primary/[.08]"
                        : "border-white/[.08] bg-white/[.02] hover:border-white/20"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Lock className={cn("size-4", draft.access === "private" ? "text-primary" : "text-muted-foreground")} aria-hidden />
                      ЗАКРЫТЫЙ
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                      Доступ — только платным подписчикам ТГК
                    </span>
                  </button>
                </div>
              </div>

              {/* Telegram-канал для закрытого эфира */}
              {draft.access === "private" && (
                <div className="space-y-2 rounded-xl border border-white/[.06] bg-black/20 p-3.5">
                  <p className="label-caps text-[11px] text-muted-foreground">
                    TELEGRAM-КАНАЛ ДЛЯ ПРОВЕРКИ ПОДПИСКИ
                  </p>
                  <div className="max-h-44 space-y-1.5 overflow-y-auto">
                    {tgChannels.length === 0 && (
                      <p className="rounded-lg bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                        Реестр пуст — будет использован основной канал из настроек сервера
                        (<code className="rounded bg-black/30 px-1 font-mono text-[10px]">TELEGRAM_CHAT_ID</code>).
                      </p>
                    )}
                    {tgChannels.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, requiredTgId: draft.requiredTgId === t.id ? null : t.id })}
                        aria-pressed={draft.requiredTgId === t.id}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
                          draft.requiredTgId === t.id
                            ? "border-white/20 bg-white/[.06]"
                            : "border-border hover:bg-white/[.03]"
                        )}
                      >
                        <Check className={cn("size-4 shrink-0", draft.requiredTgId === t.id ? "opacity-100" : "opacity-0")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{t.title}</span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {t.chatId || "основной (env)"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                    Платформа проверит подписку зрителя на выбранный канал через бота при входе на эфир.
                  </p>
                </div>
              )}

              {/* Название */}
              <div className="space-y-2">
                <Label htmlFor="ctrl-title" className="label-caps text-[11px] text-muted-foreground">
                  НАЗВАНИЕ ТРАНСЛЯЦИИ
                </Label>
                <Input
                  id="ctrl-title"
                  value={draft.liveTitle}
                  onChange={(e) => setDraft({ ...draft, liveTitle: e.target.value.slice(0, 140) })}
                  placeholder="О чём эфир"
                  className="bg-[#1a1a21]"
                />
              </div>

              {/* Категория */}
              <div className="space-y-2">
                <Label className="label-caps text-[11px] text-muted-foreground">КАТЕГОРИЯ</Label>
                <CategoryPicker
                  value={draft.liveCategory}
                  onChange={(slug) => setDraft({ ...draft, liveCategory: slug })}
                />
              </div>

              {/* Теги */}
              <div className="space-y-2">
                <Label htmlFor="ctrl-tags" className="label-caps text-[11px] text-muted-foreground">
                  ТЕГИ
                </Label>
                <Input
                  id="ctrl-tags"
                  value={draft.liveTags}
                  onChange={(e) => setDraft({ ...draft, liveTags: e.target.value.slice(0, 120) })}
                  placeholder="код, музыка, декомпиляция"
                  className="bg-[#1a1a21]"
                />
                <p className="text-[11px] text-muted-foreground/70">
                  Через запятую, до 6 штук — показываются под трансляцией
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6"
                >
                  <Save className="size-4" />
                  {saving ? "СОХРАНЯЕМ…" : "СОХРАНИТЬ"}
                </Button>
              </div>
            </div>
          ) : (
            /* ── РАСШИРЕННЫЕ ── */
            <div className="space-y-5">
              {/* 1. Качество трансляции */}
              <section className="space-y-3 rounded-xl border border-white/[.06] bg-white/[.02] p-4 sm:p-5">
                <header className="flex flex-wrap items-center gap-2.5">
                  <MonitorPlay className="size-4.5 text-primary" aria-hidden />
                  <h3 className="label-caps text-[13px]">КАЧЕСТВО ТРАНСЛЯЦИИ</h3>
                  {qualityBusy && <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" aria-hidden />}
                </header>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Отметьте варианты HLS-лестницы движка. Источник — без даунскейла (мы не
                  поддерживаем выше 1080p60). По умолчанию: Источник, 720p, 480p.
                </p>

                {quality === null ? (
                  <div className="grid h-20 place-items-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Загружаем варианты" />
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {QUALITY_OPTIONS.map((o) => {
                      const checked = quality.includes(o.key);
                      return (
                        <label
                          key={o.key}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                            checked ? "border-primary/40 bg-primary/[.06]" : "border-white/[.08] hover:border-white/20"
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setQuality((prev) =>
                                (prev ?? []).includes(o.key)
                                  ? (prev ?? []).filter((k) => k !== o.key)
                                  : [...(prev ?? []), o.key]
                              )
                            }
                            aria-label={o.label}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="label-caps block text-[12px]">{o.label}</span>
                            <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    disabled={qualityBusy || !quality || quality.length === 0}
                    onClick={() => void applyQuality()}
                    className="label-caps gap-2"
                  >
                    {qualityBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    ПРИМЕНИТЬ КАЧЕСТВО
                  </Button>
                  <p className="min-w-40 flex-1 text-[11px] leading-snug text-muted-foreground">
                    {quality ? `Выбрано вариантов: ${quality.length}` : "…"} · при остановленном эфире движок
                    перезапускается автоматически. Больше вариантов — выше нагрузка на CPU сервера.
                  </p>
                </div>
              </section>

              {/* 2. Задержка эфира */}
              <section className="space-y-3 rounded-xl border border-white/[.06] bg-white/[.02] p-4 sm:p-5">
                <header className="flex flex-wrap items-center gap-2.5">
                  <Zap className="size-4.5 text-primary" aria-hidden />
                  <h3 className="label-caps text-[13px]">ЗАДЕРЖКА ЭФИРА</h3>
                  {latencyBusy && <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" aria-hidden />}
                </header>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Режим доставки HLS зрителям — как «Low Latency» у Twitch и «Ultra-low» у YouTube.
                  Плееры стартуют у live-края и плавно догоняют при отставании.
                </p>

                {/* Живой вход: реальный поток от OBS (ловим 1440p и прочие сюрпризы) */}
                {ingest && (
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[11px] leading-snug",
                      (ingest.height ?? 0) > 1080
                        ? "border-live/40 bg-live/10 text-live"
                        : "border-white/[.08] bg-white/[.02] text-muted-foreground"
                    )}
                  >
                    <span className="label-caps shrink-0">ВХОД СЕЙЧАС:</span>
                    <span className="font-mono">
                      {ingest.width ?? "?"}×{ingest.height ?? "?"} · {ingest.framerate ?? "?"} fps ·{" "}
                      {(ingest.videoBitrate ?? 0) >= 1000
                        ? `${((ingest.videoBitrate ?? 0) / 1000).toFixed(1)} Мбит/с`
                        : `${ingest.videoBitrate ?? 0} kbps`}
                    </span>
                    {(ingest.height ?? 0) > 1080 && (
                      <span>
                        выше 1080p — транскодер не успевает, задержка растёт! В OBS: Настройки → Видео →
                        «Разрешение вывода (масштабированное)» = 1920×1080.
                      </span>
                    )}
                  </div>
                )}

                {latency === null ? (
                  <div className="grid h-16 place-items-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Загружаем режим задержки" />
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Режим задержки эфира">
                    {LATENCY_PRESETS.map((p) => {
                      const active = latency === p.level;
                      return (
                        <label
                          key={p.level}
                          title={p.note}
                          className={cn(
                            "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors",
                            active ? "border-primary/40 bg-primary/[.06]" : "border-white/[.08] hover:border-white/20",
                            latencyBusy && "opacity-60"
                          )}
                        >
                          <input
                            type="radio"
                            name="latency-level"
                            className="sr-only"
                            checked={active}
                            disabled={latencyBusy}
                            onChange={() => void applyLatency(p.level)}
                          />
                          <span className="label-caps text-[12px]">{p.label}</span>
                          <span className="text-[11px] text-muted-foreground">{p.hint}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {latency !== null && !LATENCY_PRESETS.some((p) => p.level === latency) && (
                  <p className="text-[11px] text-muted-foreground">
                    Текущий уровень движка: {latency} (повышенная надёжность) — выберите пресет, чтобы снизить
                    задержку.
                  </p>
                )}

                <p className="text-[11px] leading-snug text-muted-foreground">
                  Применяется к следующему эфиру, текущий не прерывается. Для минимума задержки в OBS:
                  разрешение вывода 1920×1080 + интервал ключевых кадров 2 с (Настройки → Вывод → Продвинутые).
                </p>
              </section>

              {/* 3. Подключение */}
              <section className="space-y-4 rounded-xl border border-white/[.06] bg-white/[.02] p-4 sm:p-5">
                <header className="flex items-center gap-2.5">
                  <Server className="size-4.5 text-primary" aria-hidden />
                  <h3 className="label-caps text-[13px]">ПОДКЛЮЧЕНИЕ</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="label-caps ml-auto h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => void loadKey()}
                  >
                    <RefreshCcw className="size-3.5" /> ОБНОВИТЬ
                  </Button>
                </header>

                {/* RTMP-сервер */}
                <div className="space-y-2">
                  <Label className="label-caps text-[11px] text-muted-foreground">СЕРВЕР (RTMP)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={rtmpUrl}
                      aria-label="RTMP-сервер"
                      className="bg-[#1a1a21] font-mono text-xs"
                    />
                    <Button variant="secondary" size="sm" className="shrink-0" onClick={() => copyText(rtmpUrl, "RTMP-адрес скопирован")}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {isSandboxPreview && (
                    <div className="space-y-2 rounded-lg border border-white/[.06] bg-black/20 p-3.5">
                      <p className="label-caps text-[11px] text-muted-foreground">Облачная песочница — нужен мост</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Прямой RTMP наружу недоступен (виден только HTTP-шлюз). Запустите на своём ПК мост из репозитория:
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                          {bridgeCommand}
                        </pre>
                        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => copyText(bridgeCommand, "Команда запуска моста скопирована")}>
                          <Copy className="size-4" />
                        </Button>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                        Он поднимёт локальный приёмник rtmp://127.0.0.1:1935 и переправит поток в песочницу. Нужен bun или node ≥ 22.
                      </p>
                    </div>
                  )}
                </div>

                {/* Стрим-ключ */}
                <div className="space-y-2">
                  <Label className="label-caps text-[11px] text-muted-foreground">КЛЮЧ ПОТОКА</Label>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative min-w-40 flex-1">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input
                        readOnly
                        value={keyVisible ? (streamKey ?? "движок недоступен…") : maskedKey}
                        aria-label="Ключ потока"
                        className={cn("bg-[#1a1a21] pl-9 font-mono text-xs", !keyVisible && "tracking-wider")}
                      />
                      {streamKey && (
                        <button
                          type="button"
                          aria-label={keyVisible ? "Скрыть ключ" : "Показать ключ"}
                          onClick={() => setKeyVisible((v) => !v)}
                          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
                        >
                          {keyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={!streamKey}
                      onClick={() => streamKey && copyText(streamKey, "Ключ потока скопирован")}
                    >
                      <Copy className="size-4" />
                    </Button>
                    {confirmRegen ? (
                      <div className="flex gap-1.5">
                        <Button variant="destructive" size="sm" className="label-caps gap-1.5" disabled={regenBusy} onClick={() => void regenerateKey()}>
                          {regenBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                          ТОЧНО РЕГЕНЕРИРОВАТЬ
                        </Button>
                        <Button variant="ghost" size="sm" className="label-caps" disabled={regenBusy} onClick={() => setConfirmRegen(false)}>
                          ОТМЕНА
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="label-caps shrink-0 gap-1.5"
                        disabled={!streamKey || regenBusy}
                        onClick={() => setConfirmRegen(true)}
                      >
                        <RefreshCcw className="size-4" />
                        РЕГЕНЕРИРОВАТЬ
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                    Ключ — секрет: не публикуйте его. При утечке регенерируйте: старый ключ перестанет
                    принимать новые подключения, текущий эфир не прервётся.
                  </p>
                </div>
              </section>

              {/* 4. Демо-инструменты (только демо-режим) */}
              {demoAuth && (
                <section className="space-y-3 rounded-xl border border-dashed border-primary/30 bg-primary/[.03] p-4 sm:p-5">
                  <header className="flex flex-wrap items-center gap-2.5">
                    <Sparkles className="size-4.5 text-primary" aria-hidden />
                    <h3 className="label-caps text-[13px]">ДЕМО-ИНСТРУМЕНТЫ</h3>
                    <span className="label-caps ml-auto rounded-full border border-dashed border-primary/30 px-2 py-px text-[10px] text-muted-foreground">
                      ВИДИМЫ ТОЛЬКО В ДЕМО-РЕЖИМЕ
                    </span>
                  </header>

                  {/* Тестовый эфир */}
                  <div className="space-y-2 rounded-lg border border-white/[.06] bg-black/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="label-caps text-[11px]">ТЕСТОВЫЙ ЭФИР</span>
                      {engineState?.engine.reachable && (
                        <span
                          className={cn(
                            "label-caps rounded-full px-2 py-px text-[10px]",
                            engineState.engine.online ? "bg-live/15 text-live" : "bg-secondary text-muted-foreground"
                          )}
                        >
                          {engineState.engine.online ? "ПОТОК ИДЁТ" : "ОФЛАЙН"}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        size="sm"
                        variant={engineState?.running ? "destructive" : "default"}
                        disabled={demoBusy || !engineState?.engine.reachable}
                        onClick={() => void toggleDemoStream(engineState?.running ? "stop" : "start")}
                        className="label-caps gap-2"
                      >
                        {demoBusy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : engineState?.running ? (
                          <Square className="size-4" />
                        ) : (
                          <Play className="size-4" />
                        )}
                        {engineState?.running ? "ОСТАНОВИТЬ" : "ЗАПУСТИТЬ"}
                      </Button>
                      <p className="min-w-40 flex-1 text-xs leading-snug text-muted-foreground">
                        ffmpeg пушит тестовый RTMP-поток в Owncast — проверка конвейера без OBS.
                      </p>
                    </div>
                  </div>

                  {/* Тестовый чат */}
                  <div className="flex items-center gap-3 rounded-lg border border-white/[.06] bg-black/20 p-3">
                    <Switch
                      id="demo-chat-toggle"
                      checked={Boolean(demoChat)}
                      disabled={demoChat === null}
                      onCheckedChange={(v) => {
                        setDemoChat(v);
                        void chatSend(`/demo ${v ? "on" : "off"}`).then((ok) => {
                          if (ok) toast({ title: v ? "Тестовый чат включён" : "Тестовый чат выключен" });
                        });
                      }}
                      aria-label="Тестовый чат"
                    />
                    <Label htmlFor="demo-chat-toggle" className="cursor-pointer text-xs leading-snug">
                      <span className="label-caps flex items-center gap-1.5 text-[11px]">
                        <MessageSquare className="size-3.5" aria-hidden />
                        ТЕСТОВЫЙ ЧАТ
                      </span>
                      <span className="mt-0.5 block font-normal text-muted-foreground">
                        фейковые зрители оживляют витрину
                      </span>
                    </Label>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
