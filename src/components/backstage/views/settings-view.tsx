"use client";

// Страница настроек канала (для автора): внешний вид (никнейм, аватар с
// кадрированием, баннер 16:9, слоган, донаты), OBS-интеграция (оверлей чата,
// HTTP API) и модерация чата. Адрес сервера/ключ потока и настройки эфира
// живут в панели «УПРАВЛЕНИЕ» (пилюля в топбаре).
// Доступ: шестерёнка в топбаре / пункт профиля (только ADMIN).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban as BanIcon,
  Check,
  Coins,
  Copy,
  Image as ImageIcon,
  MonitorPlay,
  Palette,
  RefreshCcw,
  Sword,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { CROP_AVATAR, CROP_BANNER, CropUploadButton } from "@/components/backstage/crop-dialog";
import { useBackstageStore } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import type { PublicChannel } from "@/lib/types";

/* ── Небольшие строительные блоки страницы ─────────────────────────────── */

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/[.05]">
          <Icon className="size-5 text-foreground/80" />
        </span>
        <div>
          <h2 className="label-caps text-[13px]">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="label-caps text-[11px] text-muted-foreground">{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Кнопка копирования с обратной связью */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={label}
      className="label-caps h-9 gap-1.5 rounded-lg px-3 text-[11px]"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
            toast({ title: "Скопировано в буфер обмена", description: label });
          })
          .catch(() => toast({ title: "Не удалось скопировать", variant: "destructive" }));
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "СКОПИРОВАНО" : "КОПИРОВАТЬ"}
    </Button>
  );
}

/* ── Страница ─────────────────────────────────────────────────────────── */

export function SettingsView() {
  const user = useBackstageStore((s) => s.user);
  const channels = useBackstageStore((s) => s.channels);
  const activeChannel = useBackstageStore((s) => s.activeChannel);
  const setView = useBackstageStore((s) => s.setView);

  const channel = useMemo(
    () => channels.find((c) => c.slug === activeChannel) ?? channels[0],
    [channels, activeChannel]
  );

  if (!channel) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Не-автор не должен видеть настройки
  if (user?.role !== "ADMIN") {
    return (
      <div className="grid min-h-[50vh] place-items-center p-6">
        <div className="text-center">
          <h1 className="headline text-lg">ДОСТУП ТОЛЬКО ДЛЯ АВТОРА</h1>
          <p className="mt-2 text-sm text-muted-foreground">Настройки канала доступны владельцу канала</p>
          <Button variant="secondary" className="label-caps mt-4 gap-2 rounded-full" onClick={() => setView("home")}>
            <ArrowLeft className="size-4" /> НА ГЛАВНУЮ
          </Button>
        </div>
      </div>
    );
  }

  // Форма инициализируется из канала; key пересоздаёт её при смене канала
  return <SettingsForm key={channel.slug} channel={channel} />;
}

/* ── Форма настроек (state — только локальные правки, синк через key) ── */

function SettingsForm({ channel }: { channel: PublicChannel }) {
  const setView = useBackstageStore((s) => s.setView);
  const patchChannel = useBackstageStore((s) => s.patchChannel);

  const [name, setName] = useState(channel.name);
  const [tagline, setTagline] = useState(channel.tagline ?? "");
  const [avatarUrl, setAvatarUrl] = useState(channel.avatarUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(channel.bannerUrl ?? "");
  // Ссылка на поддержку (донаты) — кнопка «ПОДДЕРЖАТЬ» под эфиром
  const [donateLink, setDonateLink] = useState(channel.donateLink ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  /* ── Модерация чата (REST чат-сервиса) ──────────────────── */
  type BanRow = { uid: string; name: string; reason: string; until: number };
  type ModRow = { uid: string; name: string };
  const [bans, setBans] = useState<BanRow[]>([]);
  const [mods, setMods] = useState<ModRow[]>([]);

  const chatSend = useCallback(
    async (text: string) => {
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
    [channel.slug]
  );

  const refreshModeration = useCallback(async () => {
    try {
      const [b, m] = await Promise.all([
        fetch(`/api/bans?XTransformPort=3003`, { cache: "no-store" }).then((r) => r.json() as Promise<{ bans?: BanRow[] }>),
        fetch(`/api/mods?channel=${encodeURIComponent(channel.slug)}&XTransformPort=3003`, { cache: "no-store" }).then(
          (r) => r.json() as Promise<{ mods?: ModRow[] }>
        ),
      ]);
      setBans(b.bans ?? []);
      setMods(m.mods ?? []);
    } catch {
      /* чат-сервис недоступен */
    }
  }, [channel.slug]);

  useEffect(() => {
    void refreshModeration();
  }, [refreshModeration]);

  const patch = (field: string, value: string) => {
    setDirty(true);
    if (field === "name") setName(value.slice(0, 40));
    if (field === "tagline") setTagline(value.slice(0, 80));
    if (field === "avatarUrl") setAvatarUrl(value.slice(0, 500));
    if (field === "bannerUrl") setBannerUrl(value.slice(0, 500));
    if (field === "donateLink") setDonateLink(value.slice(0, 300));
  };

  const save = async () => {
    if (name.trim().length < 2) {
      toast({ title: "Никнейм слишком короткий", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${channel.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          tagline: tagline.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
          bannerUrl: bannerUrl.trim() || null,
          donateLink: donateLink.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { channel?: PublicChannel; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      if (data.channel) {
        // обновляем стор: канал сразу меняет имя/аватар по всему интерфейсу
        patchChannel(channel.slug, {
          name: data.channel.name,
          tagline: data.channel.tagline,
          avatarUrl: data.channel.avatarUrl,
          bannerUrl: data.channel.bannerUrl,
          donateLink: data.channel.donateLink,
        });
      }
      setDirty(false);
      toast({ title: "Настройки сохранены", description: "Внешний вид канала обновлён" });
    } catch (e) {
      toast({ title: "Не удалось сохранить", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const overlayUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/overlay?channel=${channel.slug}&XTransformPort=3003`;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-16 sm:p-6">
      {/* Шапка страницы */}
      <header className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Назад к эфиру"
          className="rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
          onClick={() => setView("live")}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="headline text-base sm:text-lg">НАСТРОЙКИ КАНАЛА</h1>
          <p className="truncate text-xs text-muted-foreground">@{channel.handle}</p>
        </div>
        {dirty && (
          <span className="label-caps rounded-full bg-white/10 px-3 py-1 text-[10px] text-muted-foreground">
            ЕСТЬ НЕСОХРАНЁННЫЕ ИЗМЕНЕНИЯ
          </span>
        )}
      </header>

      {/* ── Внешний вид ── */}
      <SectionCard icon={Palette} title="ВНЕШНИЙ ВИД" description="Как канал видят зрители: имя, аватар, баннер и слоган.">
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar className="size-16 rounded-full ring-2 ring-white/10">
              <AvatarImage src={avatarUrl || undefined} alt={name} />
              <AvatarFallback className="rounded-full bg-[#1c1c21] text-2xl font-black text-[#d6d6de]">
                {(name.trim()[0] ?? "?").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="card-title truncate text-sm">{name || "Без названия"}</p>
              <p className="truncate text-xs text-muted-foreground">{tagline || "Слоган не задан"}</p>
            </div>
          </div>

          <Field label="НИКНЕЙМ КАНАЛА" hint={`${name.length}/40`}>
            <div className="relative">
              <Type className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={name} onChange={(e) => patch("name", e.target.value)} className="pl-9" maxLength={40} />
            </div>
          </Field>

          <Field label="СЛОГАН" hint={`${tagline.length}/80`}>
            <Input value={tagline} onChange={(e) => patch("tagline", e.target.value)} maxLength={80} placeholder="Короткая строка под именем канала" />
          </Field>

          <Field label="АВАТАР (URL)" hint="кроп в круг · jpg / png / webp · до 5 МБ">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={avatarUrl} onChange={(e) => patch("avatarUrl", e.target.value)} className="pl-9" placeholder="https://…/avatar.png" inputMode="url" />
              </div>
              <CropUploadButton target={CROP_AVATAR} onUploaded={(url) => patch("avatarUrl", url)} />
            </div>
          </Field>

          <Field label="БАННЕР (URL)" hint="кроп 16:9 · до 5 МБ">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={bannerUrl} onChange={(e) => patch("bannerUrl", e.target.value)} className="pl-9" placeholder="https://…/banner.jpg" inputMode="url" />
              </div>
              <CropUploadButton target={CROP_BANNER} onUploaded={(url) => patch("bannerUrl", url)} />
            </div>
          </Field>

          <Field label="ССЫЛКА ПОДДЕРЖКИ (ДОНАТЫ)" hint="кнопка «ПОДДЕРЖАТЬ» под эфиром">
            <div className="relative">
              <Coins className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={donateLink}
                onChange={(e) => patch("donateLink", e.target.value)}
                className="pl-9"
                placeholder="https://boosty.to/…"
                inputMode="url"
                maxLength={300}
              />
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Зрители увидят кликабельную строку «ПОДДЕРЖАТЬ» под кнопками эфира. Оставьте пустым, чтобы скрыть.
            </p>
          </Field>

          <div className="flex justify-end">
            <Button
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6"
            >
              <Check className="size-4" />
              {saving ? "СОХРАНЯЕМ…" : "СОХРАНИТЬ"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* ── OBS-интеграция ── */}
      <SectionCard
        icon={MonitorPlay}
        title="OBS-ИНТЕГРАЦИЯ"
        description="Оверлей чата для сцены OBS и HTTP API для ботов и виджетов."
      >
        <div className="space-y-5">
          <Field label="ЧАТ-ОВЕРЛЕЙ ДЛЯ BROWSER SOURCE" hint="OBS → Источники → Браузер">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input readOnly value={overlayUrl} className="bg-[#1a1a21] font-mono text-xs" aria-readonly />
              </div>
              <CopyButton value={overlayUrl} label="URL оверлея чата" />
            </div>
            <p className="text-xs text-muted-foreground">
              Прозрачный чат с эмодзи 7TV/BTTV/FFZ, бейджами и авто-скроллом. Параметр
              <code className="mx-1 rounded bg-black/30 px-1 font-mono text-[10px]">&scale=1.5</code>
              увеличит размер текста.
            </p>
          </Field>

          <Field label="HTTP API ЧАТА" hint="для ботов и виджетов">
            <pre className="max-h-44 overflow-auto rounded-md bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
{`GET  /api/messages?channel=${channel.slug}&limit=50&XTransformPort=3003
POST /api/send  { "channelSlug": "${channel.slug}", "text": "…" }
     + Authorization: Bearer <токен из /api/chat/token>
GET  /api/emotes?XTransformPort=3003
GET  /api/chstate?channel=${channel.slug}&XTransformPort=3003`}
            </pre>
          </Field>
        </div>
      </SectionCard>

      {/* ── Модерация чата ── */}
      <SectionCard
        icon={Sword}
        title="МОДЕРАЦИЯ ЧАТА"
        description="Модераторы и баны. Назначить модератора: /mod имя в чате."
      >
        <div className="space-y-5">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="label-caps h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => void refreshModeration()}
            >
              <RefreshCcw className="size-3.5" /> ОБНОВИТЬ
            </Button>
          </div>

          <Field label={`МОДЕРАТОРЫ (${mods.length})`}>
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
          </Field>

          <Field label={`АКТИВНЫЕ БАНЫ (${bans.length})`}>
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
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}
