"use client";

// Страница настроек канала (для автора): внешний вид (никнейм, аватар,
// баннер, слоган) и трансляция (адрес сервера, ключ трансляции, режим чата —
// заглушка). Доступ: шестерёнка в топбаре / пункт профиля (только ADMIN).

import { useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Palette,
  RefreshCcw,
  Server,
  Type,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { CategoryPicker } from "@/components/backstage/category-picker";
import { useBackstageStore } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import { findCategory } from "@/lib/categories";
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

const UPLOAD_MAX_SIZE = 5 * 1024 * 1024; // 5 МБ (синхронизировано с /api/upload)

/** Кнопка «загрузить файл» (label + скрытый input file) → POST /api/upload */
function UploadButton({ onUploaded, label = "ЗАГРУЗИТЬ" }: { onUploaded: (url: string) => void; label?: string }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Только изображения", description: "jpg / png / webp / gif", variant: "destructive" });
      return;
    }
    if (file.size > UPLOAD_MAX_SIZE) {
      toast({ title: "Файл больше 5 МБ", description: "Выберите изображение поменьше", variant: "destructive" });
      return;
    }
    setUploading(true);
    void (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
        if (!res.ok || !data.url) throw new Error(data.message ?? `HTTP ${res.status}`);
        onUploaded(data.url);
        toast({ title: "Файл загружен", description: "Нажмите «Сохранить», чтобы применить" });
      } catch (e) {
        toast({ title: "Ошибка загрузки", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
      } finally {
        setUploading(false);
      }
    })();
  };

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "label-caps h-9 flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-3 text-[11px] hover:bg-white/[.08]",
        uploading && "pointer-events-none opacity-60"
      )}
    >
      {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
      {uploading ? "ЗАГРУЖАЕМ…" : label}
      <input
        id={inputId}
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
  // Категория хранится как slug; легаси-значения (напр. «Just Chatting»)
  // нормализуются к современному slug — иначе плитки не подсветятся.
  const [category, setCategory] = useState(
    channel.liveCategory ? (findCategory(channel.liveCategory)?.slug ?? channel.liveCategory) : ""
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Ключ трансляции
  const [keyVisible, setKeyVisible] = useState(false);
  const [resettingKey, setResettingKey] = useState(false);

  const streamKey = channel.streamKey ?? "";
  const maskedKey = streamKey.length > 6 ? `${streamKey.slice(0, 4)}${"•".repeat(18)}${streamKey.slice(-2)}` : streamKey;
  const rtmpUrl = `rtmp://${window.location.hostname}:1935/live`;

  const patch = (field: string, value: string) => {
    setDirty(true);
    if (field === "name") setName(value.slice(0, 40));
    if (field === "tagline") setTagline(value.slice(0, 80));
    if (field === "avatarUrl") setAvatarUrl(value.slice(0, 500));
    if (field === "bannerUrl") setBannerUrl(value.slice(0, 500));
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
          liveCategory: category || null,
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
          liveCategory: data.channel.liveCategory,
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

  const resetKey = async () => {
    setResettingKey(true);
    try {
      const res = await fetch(`/api/channels/${channel.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resetStreamKey: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { channel?: PublicChannel; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      if (data.channel) patchChannel(channel.slug, { streamKey: data.channel.streamKey });
      setKeyVisible(true);
      toast({ title: "Ключ трансляции обновлён", description: "Обновите его в OBS" });
    } catch (e) {
      toast({ title: "Не удалось обновить ключ", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setResettingKey(false);
    }
  };

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

          <Field label="АВАТАР (URL)" hint="jpg / png / webp · до 5 МБ">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={avatarUrl} onChange={(e) => patch("avatarUrl", e.target.value)} className="pl-9" placeholder="https://…/avatar.png" inputMode="url" />
              </div>
              <UploadButton onUploaded={(url) => patch("avatarUrl", url)} />
            </div>
          </Field>

          <Field label="БАННЕР (URL)" hint="широкое изображение 16:9 · до 5 МБ">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={bannerUrl} onChange={(e) => patch("bannerUrl", e.target.value)} className="pl-9" placeholder="https://…/banner.jpg" inputMode="url" />
              </div>
              <UploadButton onUploaded={(url) => patch("bannerUrl", url)} />
            </div>
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

      {/* ── Трансляция ── */}
      <SectionCard icon={Server} title="ТРАНСЛЯЦИЯ" description="Адрес сервера и ключ для OBS. Ключ держите в секрете.">
        <div className="space-y-5">
          <Field label="АДРЕС СЕРВЕРА (RTMP)" hint="для OBS: Настройки → Вещание">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input readOnly value={rtmpUrl} className="pl-9 font-mono text-[13px]" aria-readonly />
              </div>
              <CopyButton value={rtmpUrl} label="Адрес сервера" />
            </div>
          </Field>

          <Field label="КЛЮЧ ТРАНСЛЯЦИИ" hint="секрет — не публикуйте">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  readOnly
                  value={keyVisible ? streamKey : maskedKey}
                  className={cn("pl-9 font-mono text-[13px]", !keyVisible && "tracking-wider")}
                  aria-label="Ключ трансляции"
                />
                <button
                  type="button"
                  aria-label={keyVisible ? "Скрыть ключ" : "Показать ключ"}
                  onClick={() => setKeyVisible((v) => !v)}
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
                >
                  {keyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <CopyButton value={streamKey} label="Ключ трансляции" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={resettingKey}
                className="label-caps h-9 gap-1.5 rounded-lg px-3 text-[11px]"
                onClick={() => void resetKey()}
              >
                <RefreshCcw className={cn("size-3.5", resettingKey && "animate-spin")} />
                СБРОСИТЬ
              </Button>
            </div>
          </Field>

          <Field label="КАТЕГОРИЯ ЭФИРА" hint="показывается под трансляцией">
            <CategoryPicker
              value={category}
              onChange={(slug) => {
                setDirty(true);
                setCategory(slug);
              }}
            />
          </Field>

          <Field label="РЕЖИМ ЧАТА" hint="скоро">
            <Select disabled value="open">
              <SelectTrigger className="w-full" aria-label="Режим чата (заглушка)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="open">Открытый — пишут все</SelectItem>
                <SelectItem value="subs" disabled>Только подписчики</SelectItem>
                <SelectItem value="slow" disabled>Замедленный</SelectItem>
                <SelectItem value="emote" disabled>Только эмодзи</SelectItem>
              </SelectContent>
            </Select>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <MessageSquare className="size-3.5" aria-hidden />
              Продвинутые режимы чата появятся в следующем обновлении
            </p>
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}
