"use client";

// Панель владельца: управление эфиром dypaGPT, OBS-интеграция, модерация чата.

import { useCallback, useEffect, useState } from "react";
import { KeyRound, MonitorPlay, Plus, Radio, RefreshCcw, Save, Sword, Ban as BanIcon, Copy } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useBackstageStore } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { PublicChannel } from "@/lib/types";

type BanRow = { uid: string; name: string; reason: string; until: number };
type ModRow = { uid: string; name: string };

type Draft = {
  name: string;
  liveTitle: string;
  liveCategory: string;
  liveTags: string;
  hlsUrl: string;
  livePreviewUrl: string;
  isLive: boolean;
};

function draftOf(c: PublicChannel): Draft {
  return {
    name: c.name,
    liveTitle: c.liveTitle ?? "",
    liveCategory: c.liveCategory ?? "",
    liveTags: c.liveTags.join(", "),
    hlsUrl: c.hlsUrl ?? "",
    livePreviewUrl: c.livePreviewUrl ?? "",
    isLive: c.isLive,
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

  const save = useCallback(async () => {
    if (!current || !draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${current.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          isLive: draft.isLive,
          liveTitle: draft.liveTitle || null,
          liveCategory: draft.liveCategory || null,
          liveTags: draft.liveTags.split(",").map((t) => t.trim()).filter(Boolean),
          hlsUrl: draft.hlsUrl || null,
          livePreviewUrl: draft.livePreviewUrl || null,
        }),
      });
      const data = (await res.json()) as { channel?: PublicChannel; error?: string; message?: string };
      if (!res.ok || !data.channel) throw new Error(data.message ?? data.error ?? "Ошибка сохранения");
      patchChannel(current.slug, data.channel);
      toast({
        title: data.channel.isLive ? "Эфир запущен" : "Изменения сохранены",
        description: data.channel.isLive
          ? `«${data.channel.liveTitle ?? data.channel.name}» — системное сообщение отправлено в чат`
          : `Канал ${data.channel.name} обновлён`,
      });
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [current, draft, patchChannel]);

  const resetKey = useCallback(async () => {
    if (!current) return;
    try {
      const res = await fetch(`/api/channels/${current.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resetStreamKey: true }),
      });
      const data = (await res.json()) as { channel?: PublicChannel };
      if (!res.ok || !data.channel) throw new Error();
      patchChannel(current.slug, data.channel);
      toast({ title: "Stream key обновлён", description: "Прежний ключ больше не работает" });
    } catch {
      toast({ title: "Не удалось обновить ключ", variant: "destructive" });
    }
  }, [current, patchChannel]);

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
    if (!current?.streamKey) return;
    void navigator.clipboard
      .writeText(current.streamKey)
      .then(() => toast({ title: "Stream key скопирован" }))
      .catch(() => toast({ title: "Не удалось скопировать", variant: "destructive" }));
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
            Управление каналом dypaGPT, OBS-интеграцией и модерацией чата.
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
            {/* Тумблер эфира */}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3">
              <Switch
                id="live-toggle"
                checked={draft.isLive}
                onCheckedChange={(v) => setDraft({ isLive: v })}
                aria-label="Эфир в эфире"
              />
              <div className="flex-1">
                <Label htmlFor="live-toggle" className="cursor-pointer text-sm font-semibold">
                  {draft.isLive ? "Эфир идёт" : "Эфир выключен"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  При включении в чат уйдёт системное сообщение о старте
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => openChannel(current.slug)}>
                Открыть канал
              </Button>
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
                <Label htmlFor="a-hls">HLS-адрес потока (M3U8)</Label>
                <Textarea
                  id="a-hls"
                  value={draft.hlsUrl}
                  onChange={(e) => setDraft({ hlsUrl: e.target.value })}
                  placeholder="https://media.example.com/live/saiko.m3u8"
                  rows={2}
                  className="resize-none bg-[#1a1a21] font-mono text-xs"
                />
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

            {/* Stream key */}
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-4 text-primary" />
                Ключ вещания (RTMP)
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Сервер: <code className="rounded bg-black/30 px-1 py-px font-mono">rtmp://media.backstage.live/live</code>
                {" · "}не передавайте ключ третьим лицам
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  readOnly
                  value={current.streamKey ?? "—"}
                  aria-label="Stream key"
                  className="bg-[#1a1a21] font-mono text-xs"
                />
                <Button variant="secondary" size="sm" onClick={copyKey}>
                  Копировать
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void resetKey()}>
                  <RefreshCcw className="size-4" />
                  Сбросить
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
                          void chatSend(`/unmod ${m.name}`).then((ok) => ok && refreshModeration());
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
                          void chatSend(`/unban ${b.name}`).then((ok) => ok && refreshModeration());
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
      </DialogContent>
    </Dialog>
  );
}
