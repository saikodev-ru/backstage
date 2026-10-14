"use client";

// Панель владельца: управление эфиром dypaGPT, OBS-интеграция, модерация чата.

import { useCallback, useEffect, useState } from "react";
import {
  Ban as BanIcon,
  Check,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  MonitorPlay,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  Save,
  Server,
  Square,
  Sword,
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useBackstageStore } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { PublicChannel } from "@/lib/types";

type BanRow = { uid: string; name: string; reason: string; until: number };
type ModRow = { uid: string; name: string };
/** Реестр Telegram-каналов платных подписок (приватные эфиры). */
type TgChannelRow = { id: string; title: string; chatId: string; link: string | null; note: string | null };

type Draft = {
  name: string;
  liveTitle: string;
  liveCategory: string;
  liveTags: string;
  livePreviewUrl: string;
};

/** Состояние движка Owncast + демо-эфира (GET /api/admin/demo-stream) */
type EngineState = {
  running: boolean;
  engine: { engine: "owncast"; reachable: boolean; online: boolean; version: string; baseUrl: string };
  rtmp: { url: string; key: string };
  hls: { url: string };
};

function draftOf(c: PublicChannel): Draft {
  return {
    name: c.name,
    liveTitle: c.liveTitle ?? "",
    liveCategory: c.liveCategory ?? "",
    liveTags: c.liveTags.join(", "),
    livePreviewUrl: c.livePreviewUrl ?? "",
  };
}

export function AdminPanel() {
  const { adminOpen, setAdminOpen, channels, setChannels, patchChannel, openChannel } = useBackstageStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  // ── Модерация и OBS (REST чат-сервиса) ─────────────────────
  const [bans, setBans] = useState<BanRow[]>([]);
  const [mods, setMods] = useState<ModRow[]>([]);
  const [demoChat, setDemoChat] = useState<boolean | null>(null);

  const chatSend = useCallback(async (text: string) => {
    try {
      const tr = await fetch("/api/chat/token", { cache: "no-store" });
      if (!tr.ok) throw new Error("нет токена");
      const { token } = (await tr.json()) as { token: string };
      const res = await fetch(`/api/send?XTransformPort=3003`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ channelSlug: selected ?? "dypagpt", text }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string; command?: boolean };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "ошибка");
      return true;
    } catch (e) {
      toast({ title: "Команда не выполнена", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
      return false;
    }
  }, [selected]);

  const refreshModeration = useCallback(async () => {
    const slug = selected ?? "dypagpt";
    try {
      const [b, m, s] = await Promise.all([
        fetch(`/api/bans?XTransformPort=3003`, { cache: "no-store" }).then((r) => r.json() as Promise<{ bans?: BanRow[] }>),
        fetch(`/api/mods?channel=${encodeURIComponent(slug)}&XTransformPort=3003`, { cache: "no-store" }).then((r) => r.json() as Promise<{ mods?: ModRow[] }>),
        fetch(`/api/chstate?channel=${encodeURIComponent(slug)}&XTransformPort=3003`, { cache: "no-store" }).then((r) => r.json() as Promise<{ demo?: boolean }>),
      ]);
      setBans(b.bans ?? []);
      setMods(m.mods ?? []);
      setDemoChat(Boolean(s.demo));
    } catch {
      /* чат-сервис недоступен */
    }
  }, [selected]);

  useEffect(() => {
    if (adminOpen) void refreshModeration();
  }, [adminOpen, refreshModeration]);

  // ── Движок Owncast: статус + демо-эфир (ffmpeg → RTMP) ───────────
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

  const toggleDemo = useCallback(
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
          title: action === "start" ? "Демо-эфир запущен" : "Демо-эфир остановлен",
          description:
            action === "start"
              ? "ffmpeg пушит RTMP в Owncast — плеер покажет поток через несколько секунд"
              : "Эфир завершён, витрина перейдёт в оффлайн",
        });
        await refreshEngine();
        // Обновляем каналы сразу: статус эфира меняется
        const ch = await fetch("/api/channels", { cache: "no-store" }).then(
          (r) => r.json() as Promise<{ channels?: PublicChannel[] }>
        );
        if (ch.channels) setChannels(ch.channels);
      } catch (e) {
        toast({ title: "Ошибка демо-эфира", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
      } finally {
        setDemoBusy(false);
      }
    },
    [refreshEngine, setChannels]
  );

  const copyText = useCallback((text: string, title: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title }))
      .catch(() => toast({ title: "Не удалось скопировать", variant: "destructive" }));
  }, []);

  useEffect(() => {
    if (channels.length > 0) {
      setSelected((prev) => prev ?? channels[0].slug);
    }
  }, [channels]);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const c of channels) {
        next[c.slug] = prev[c.slug] ?? draftOf(c);
      }
      return next;
    });
  }, [channels]);

  const current = channels.find((c) => c.slug === selected) ?? null;
  const draft = current ? (drafts[current.slug] ?? draftOf(current)) : null;

  const setDraft = useCallback((patch: Partial<Draft>) => {
    if (!current) return;
    setDrafts((prev) => ({ ...prev, [current.slug]: { ...prev[current.slug], ...patch } }));
  }, [current]);

  // ── Запуск эфира: «приватный ли эфир?» + выбор ТГК (кор-изменение) ──
  const [startOpen, setStartOpen] = useState(false);
  const [startMode, setStartMode] = useState<"start" | "edit">("start");
  const [startPrivate, setStartPrivate] = useState(false);
  const [tgChannels, setTgChannels] = useState<TgChannelRow[]>([]);
  const [startTgId, setStartTgId] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);

  const openStartDialog = useCallback(
    (mode: "start" | "edit") => {
      if (!current) return;
      setStartMode(mode);
      setStartPrivate(current.access === "private");
      setStartTgId(current.requiredTelegramChatId ?? null);
      setStartOpen(true);
    },
    [current]
  );

  // Реестр ТГК подтягивается при открытии диалога
  useEffect(() => {
    if (!startOpen) return;
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
  }, [startOpen]);

  const applyAccessMode = useCallback(async () => {
    if (!current) return;
    const res = await fetch(`/api/channels/${current.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        access: startPrivate ? "private" : "public",
        requiredTelegramChatId: startPrivate ? (startTgId ?? "") : "",
      }),
    });
    const data = (await res.json()) as { channel?: PublicChannel; message?: string };
    if (!res.ok || !data.channel) throw new Error(data.message ?? "Не удалось применить режим доступа");
    patchChannel(current.slug, data.channel);
  }, [current, startPrivate, startTgId, patchChannel]);

  const confirmStart = useCallback(async () => {
    setStartBusy(true);
    try {
      await applyAccessMode();
      if (startMode === "start") {
        await toggleDemo("start");
      } else {
        toast({
          title: startPrivate ? "Эфир приватный" : "Эфир публичный",
          description: startPrivate
            ? "Доступ — только платным подписчикам выбранного ТГК"
            : "Эфир и чат открыты всем зрителям",
        });
      }
      setStartOpen(false);
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setStartBusy(false);
    }
  }, [applyAccessMode, startMode, startPrivate, toggleDemo]);

  const save = useCallback(async () => {
    if (!current || !draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${current.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          liveTitle: draft.liveTitle || null,
          liveCategory: draft.liveCategory || null,
          liveTags: draft.liveTags.split(",").map((t) => t.trim()).filter(Boolean),
          livePreviewUrl: draft.livePreviewUrl || null,
        }),
      });
      const data = (await res.json()) as { channel?: PublicChannel; error?: string; message?: string };
      if (!res.ok || !data.channel) throw new Error(data.message ?? data.error ?? "Ошибка сохранения");
      patchChannel(current.slug, data.channel);
      toast({
        title: "Изменения сохранены",
        description: `Канал ${data.channel.name} обновлён`,
      });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [current, draft, patchChannel]);

  const createChannel = useCallback(async () => {
    const name = newName.trim();
    if (name.length < 2) return;
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { channel?: PublicChannel; message?: string };
      if (!res.ok || !data.channel) throw new Error(data.message ?? "Ошибка создания");
      setChannels([...channels, data.channel]);
      setSelected(data.channel.slug);
      setNewName("");
      toast({ title: "Канал создан", description: `Автор «${name}» добавлен на платформу` });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    }
  }, [newName, channels, setChannels]);

  const copyKey = () => {
    if (!engineState?.rtmp.key) return;
    copyText(engineState.rtmp.key, "Stream key скопирован");
  };

  return (
    <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="headline flex items-center gap-2 text-base">
            <Radio className="size-5 text-primary" />
            ПУЛЬТ ЭФИРА
          </DialogTitle>
          <DialogDescription>
            Движок Owncast, OBS-интеграция и модерация чата канала dypaGPT.
          </DialogDescription>
        </DialogHeader>

        {/* Выбор канала */}
        <div className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <button
              key={c.slug}
              onClick={() => setSelected(c.slug)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                selected === c.slug
                  ? "border-primary/60 bg-accent text-accent-foreground"
                  : "border-border hover:bg-secondary"
              )}
            >
              {c.name}
              {c.isLive && <span className="size-1.5 rounded-full bg-live live-dot" aria-label="в эфире" />}
            </button>
          ))}
        </div>

        {current && draft ? (
          <div className="space-y-4">
            {/* Движок Owncast: реальный статус эфира + демо-эфир */}
            <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2">
                <Server className="size-4 text-primary" />
                <span className="label-caps text-sm">СТРИМИНГ-ДВИЖОК · OWNCast</span>
                {engineState && (
                  <span
                    className={cn(
                      "label-caps ml-auto rounded-full px-2 py-px text-[10px]",
                      engineState.engine.reachable
                        ? "bg-[#5ad1a4]/15 text-[#5ad1a4]"
                        : "bg-destructive/15 text-destructive"
                    )}
                  >
                    {engineState.engine.reachable
                      ? `ВЕРСИЯ ${engineState.engine.version || "?"}`
                      : "НЕДОСТУПЕН"}
                  </span>
                )}
              </div>

              {engineState ? (
                engineState.engine.reachable ? (
                  <>
                    {/* Статус + режим доступа эфира (публичный/приватный) */}
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                      {engineState.engine.online ? (
                        <span className="live-breathe label-caps flex items-center gap-1.5 rounded-full bg-live px-2 py-px text-[11px] text-white">
                          <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
                          ЭФИР ИДЁТ
                        </span>
                      ) : (
                        <span className="label-caps rounded-full bg-secondary px-2 py-px text-[11px] text-muted-foreground">
                          ОФЛАЙН
                        </span>
                      )}
                      <span
                        className={cn(
                          "label-caps flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px]",
                          current.access === "private"
                            ? "bg-white/[.07] text-foreground"
                            : "bg-secondary text-muted-foreground"
                        )}
                        title={
                          current.access === "private"
                            ? "Доступ только платным подписчикам ТГК"
                            : "Эфир открыт всем"
                        }
                      >
                        {current.access === "private" ? <Lock className="size-3" /> : <Globe className="size-3" />}
                        {current.access === "private" ? "ПРИВАТНЫЙ" : "ПУБЛИЧНЫЙ"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="label-caps h-7 px-2.5 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => openStartDialog("edit")}
                      >
                        ИЗМЕНИТЬ
                      </Button>
                      <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
                        Эфир = RTMP-пуш из OBS
                      </span>
                    </div>

                    {/* Демо-эфир: старт через диалог «приватный ли эфир?» */}
                    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                      <Button
                        variant={engineState.running ? "destructive" : "default"}
                        size="sm"
                        disabled={demoBusy}
                        onClick={() =>
                          engineState.running ? void toggleDemo("stop") : openStartDialog("start")
                        }
                        className="label-caps gap-2"
                      >
                        {demoBusy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : engineState.running ? (
                          <Square className="size-4" />
                        ) : (
                          <Play className="size-4" />
                        )}
                        {engineState.running ? "ОСТАНОВИТЬ ЭФИР" : "ЗАПУСТИТЬ ЭФИР…"}
                      </Button>
                      <p className="min-w-40 flex-1 text-xs leading-snug text-muted-foreground">
                        Перед запуском спросим: приватный ли эфир (и какой ТГК нужен в подписках). ffmpeg
                        пушит тестовый поток в RTMP — проверка конвейера без OBS.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-muted-foreground">
                    Owncast не отвечает по адресу <code className="font-mono">{engineState.engine.baseUrl}</code>.
                    Запустите движок: <code className="font-mono">cd mini-services/owncast && bun run dev</code>
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Проверяем движок…</p>
              )}

              {/* RTMP для OBS */}
              <div className="space-y-1.5">
                <Label className="label-caps text-[11px] text-muted-foreground">RTMP-СЕРВЕР ДЛЯ OBS</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={engineState?.rtmp.url ?? ""}
                    aria-label="RTMP-сервер"
                    className="bg-[#1a1a21] font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => engineState && copyText(engineState.rtmp.url, "RTMP-адрес скопирован")}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="a-name">Название канала</Label>
                <Input id="a-name" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} className="bg-[#1a1a21]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-title">Заголовок эфира</Label>
                <Input id="a-title" value={draft.liveTitle} onChange={(e) => setDraft({ liveTitle: e.target.value })} placeholder="О чём эфир" className="bg-[#1a1a21]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-cat">Категория</Label>
                <Input id="a-cat" value={draft.liveCategory} onChange={(e) => setDraft({ liveCategory: e.target.value })} placeholder="Например: Разработка" className="bg-[#1a1a21]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-tags">Теги (через запятую)</Label>
                <Input id="a-tags" value={draft.liveTags} onChange={(e) => setDraft({ liveTags: e.target.value })} placeholder="код, музыка" className="bg-[#1a1a21]" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="a-preview">Превью эфира (URL изображения)</Label>
                <Input
                  id="a-preview"
                  value={draft.livePreviewUrl}
                  onChange={(e) => setDraft({ livePreviewUrl: e.target.value })}
                  placeholder="/img/previews/saiko-live.jpg"
                  className="bg-[#1a1a21] font-mono text-xs"
                />
              </div>
            </div>

            {/* Стрим-ключ Owncast */}
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-4 text-primary" />
                Стрим-ключ Owncast
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Вставьте в OBS: Настройки → Вещание → Ключ потока · не передавайте ключ третьим лицам
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  readOnly
                  value={engineState?.rtmp.key ?? "…"}
                  aria-label="Stream key"
                  className="bg-[#1a1a21] font-mono text-xs"
                />
                <Button variant="secondary" size="sm" onClick={copyKey}>
                  Копировать
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openChannel(current.slug)}>
                  Открыть канал
                </Button>
              </div>
            </div>

            {/* OBS-интеграция */}
            {current && (
              <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="label-caps flex items-center gap-2 text-sm">
                  <MonitorPlay className="size-4 text-primary" />
                  ИНТЕГРАЦИЯ С OBS
                </div>
                <div className="space-y-1.5">
                  <Label className="label-caps text-[11px] text-muted-foreground">
                    ЧАТ-ОВЕРЛЕЙ ДЛЯ BROWSER SOURCE
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={`${typeof window !== "undefined" ? window.location.origin : ""}/overlay?channel=${current.slug}&XTransformPort=3003`}
                      aria-label="URL оверлея чата"
                      className="bg-[#1a1a21] font-mono text-xs"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(`${window.location.origin}/overlay?channel=${current.slug}&XTransformPort=3003`)
                          .then(() => toast({ title: "URL оверлея скопирован", description: "Вставьте в OBS → Источники → Браузер" }))
                          .catch(() => toast({ title: "Не удалось скопировать", variant: "destructive" }))
                      }
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Прозрачный чат с эмодзи 7TV/BTTV/FFZ, бейджами и авто-скроллом. Параметр
                    <code className="mx-1 rounded bg-black/30 px-1 font-mono text-[10px]">&scale=1.5</code>
                    увеличит размер текста.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="label-caps text-[11px] text-muted-foreground">HTTP API ЧАТА (ДЛЯ БОТОВ И ВИДЖЕТОВ)</Label>
                  <pre className="max-h-44 overflow-auto rounded-md bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
{`GET  /api/messages?channel=${current.slug}&limit=50&XTransformPort=3003
POST /api/send  { "channelSlug": "${current.slug}", "text": "…" }
     + Authorization: Bearer <токен из /api/chat/token>
GET  /api/emotes?XTransformPort=3003
GET  /api/chstate?channel=${current.slug}&XTransformPort=3003`}
                  </pre>
                </div>
              </div>
            )}

            {/* Модерация */}
            <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2">
                <Sword className="size-4 text-primary" />
                <span className="label-caps text-sm">МОДЕРАЦИЯ ЧАТА</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="label-caps ml-auto h-7 gap-1 px-2 text-[10px] text-muted-foreground"
                  onClick={() => void refreshModeration()}
                >
                  <RefreshCcw className="size-3.5" /> ОБНОВИТЬ
                </Button>
              </div>

              {/* Демо-чат */}
              {demoChat !== null && (
                <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                  <Switch
                    id="demo-chat-toggle"
                    checked={demoChat}
                    onCheckedChange={(v) => {
                      setDemoChat(v);
                      void chatSend(`/demo ${v ? "on" : "off"}`).then((ok) => {
                        if (ok) toast({ title: v ? "Демо-чат включён" : "Демо-чат выключен" });
                      });
                    }}
                    aria-label="Демо-чат"
                  />
                  <Label htmlFor="demo-chat-toggle" className="cursor-pointer text-xs leading-snug">
                    ДЕМО-ЧАТ <span className="font-normal text-muted-foreground">(фейковые зрители оживляют витрину)</span>
                  </Label>
                </div>
              )}

              {/* Моды */}
              <div>
                <p className="label-caps mb-1.5 text-[11px] text-muted-foreground">
                  МОДЕРАТОРЫ ({mods.length})
                </p>
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {mods.length === 0 && (
                    <p className="text-xs text-muted-foreground/70">
                      Пока никого. Назначить: <code className="rounded bg-black/30 px-1 font-mono text-[10px]">/mod имя</code> в чате
                    </p>
                  )}
                  {mods.map((m) => (
                    <div key={m.uid} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                      <Sword className="size-3.5 text-[#5ad1a4]" />
                      <span className="font-semibold">{m.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="label-caps ml-auto h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          void chatSend(`/unmod ${m.name}`).then((ok) => {
                            if (ok) void refreshModeration();
                          });
                        }}
                      >
                        СНЯТЬ
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Баны */}
              <div>
                <p className="label-caps mb-1.5 text-[11px] text-muted-foreground">
                  АКТИВНЫЕ БАНЫ ({bans.length})
                </p>
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {bans.length === 0 && (
                    <p className="text-xs text-muted-foreground/70">Банов нет — чат в мире и гармонии</p>
                  )}
                  {bans.map((b) => (
                    <div key={b.uid} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                      <BanIcon className="size-3.5 text-destructive" />
                      <span className="font-semibold">{b.name}</span>
                      <span className="text-muted-foreground">
                        {b.until === 0 ? "навсегда" : `до ${new Date(b.until).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="label-caps ml-auto h-6 px-2 text-[10px] text-muted-foreground hover:text-primary"
                        onClick={() => {
                          void chatSend(`/unban ${b.name}`).then((ok) => {
                            if (ok) void refreshModeration();
                          });
                        }}
                      >
                        РАЗБАН
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Button onClick={() => void save()} disabled={saving} className="label-caps w-full gap-2">
              <Save className="size-4" />
              {saving ? "СОХРАНЯЕМ…" : "СОХРАНИТЬ КАНАЛ"}
            </Button>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Каналы не найдены</p>
        )}

        <Separator />

        {/* Создание канала */}
        <div className="space-y-2">
          <Label htmlFor="new-channel" className="flex items-center gap-2 text-sm font-semibold">
            <Plus className="size-4 text-primary" />
            Новый автор · канал
          </Label>
          <div className="flex gap-2">
            <Input
              id="new-channel"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Имя автора / канал"
              className="bg-[#1a1a21]"
            />
            <Button variant="secondary" onClick={() => void createChannel()} disabled={newName.trim().length < 2}>
              Создать
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Slug и stream key генерируются автоматически
          </p>
        </div>

        {/* Диалог запуска эфира: «приватный ли эфир?» + выбор ТГК из реестра */}
        <Dialog open={startOpen} onOpenChange={setStartOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="headline flex items-center gap-2 text-base">
                <Play className="size-5" />
                {startMode === "start" ? "ЗАПУСК ЭФИРА" : "РЕЖИМ ДОСТУПА ЭФИРА"}
              </DialogTitle>
              <DialogDescription>
                {startMode === "start"
                  ? "Перед стартом выберите: приватный ли это эфир."
                  : "Публичный эфир открыт всем; приватный — только платным подписчикам Telegram-канала."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3.5 py-3">
              <Switch
                id="start-private"
                checked={startPrivate}
                onCheckedChange={setStartPrivate}
                aria-label="Приватный эфир"
              />
              <Label htmlFor="start-private" className="cursor-pointer">
                <span className="label-caps flex items-center gap-1.5 text-sm">
                  <Lock className="size-4" />
                  ПРИВАТНЫЙ ЭФИР
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {startPrivate
                    ? "Доступ и чат — только платным подписчикам ТГК"
                    : "Эфир и чат открыты всем зрителям"}
                </span>
              </Label>
            </div>

            {startPrivate && (
              <div className="space-y-2">
                <p className="label-caps text-[11px] text-muted-foreground">
                  TELEGRAM-КАНАЛ, КОТОРЫЙ ДОЛЖЕН БЫТЬ В ПОДПИСКАХ ЗРИТЕЛЯ
                </p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {tgChannels.length === 0 && (
                    <p className="rounded-lg bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                      Реестр пуст. Добавьте ТГК через Bot API или оставьте пустым — тогда будет использован
                      основной канал из настроек сервера.
                    </p>
                  )}
                  {tgChannels.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setStartTgId(t.id)}
                      aria-pressed={startTgId === t.id}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        startTgId === t.id
                          ? "border-white/20 bg-white/[.06]"
                          : "border-border hover:bg-white/[.03]"
                      )}
                    >
                      <Check className={cn("size-4 shrink-0", startTgId === t.id ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {t.chatId || "основной (env)"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Платформа проверит подписку зрителя на выбранный канал через бота при входе на эфир.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="label-caps ml-auto rounded-full"
                onClick={() => setStartOpen(false)}
                disabled={startBusy}
              >
                ОТМЕНА
              </Button>
              <Button
                className="btn-gradient glow-primary label-caps gap-2 rounded-full px-5"
                disabled={startBusy}
                onClick={() => void confirmStart()}
              >
                {startBusy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {startMode === "start" ? "НАЧАТЬ ЭФИР" : "ПРИМЕНИТЬ"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
