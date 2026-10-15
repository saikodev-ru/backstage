"use client";

// Диалог входа v2 «ДВЕ ДВЕРИ»: выбор роли при входе.
//   «Я ВЕДУЩИЙ» — автор канала: Telegram Login Widget + валидация userid
//                по ADMIN_IDS (env). В демо-режиме — вход без Telegram.
//   «ВОЙТИ»     — зритель: Telegram Login Widget (подписка проверяется ботом).
//
// Демо-режим авторизации включается командой demo() в консоли браузера:
// кнопки начинают работать без Telegram, у зрителя появляются чекбоксы
// «подписчик» / «модератор» (отладка гейтов). demo() повторно — выключить.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Radio, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useBackstageStore } from "@/components/backstage/store";
import { useAuthActions } from "@/components/backstage/hooks";
import { BrandMark } from "@/components/backstage/top-bar";
import { toast } from "@/hooks/use-toast";
import type { AuthConfigDto } from "@/lib/types";

// Глобальный callback для Telegram Login Widget (data-onauth)
declare global {
  interface Window {
    BackstageTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

type Step = "choice" | "host" | "viewer";

function useAuthConfig(): AuthConfigDto | null {
  const [cfg, setCfg] = useState<AuthConfigDto | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: AuthConfigDto) => alive && setCfg(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

/** Плашка «демо-режим отладки» — видна только при включённом demoAuth */
function DemoBadge() {
  return (
    <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <Sparkles className="mr-1 inline size-3.5 text-primary" aria-hidden />
      <span className="label-caps text-[10px] text-primary">ДЕМО-РЕЖИМ ОТЛАДКИ</span>
      <span className="ml-1.5">— реальные кнопки Telegram заменены демо-входом. Выключить: команда</span>
      <code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[10px]">demo()</code>
      в консоли браузера.
    </div>
  );
}

/** «Бот не настроен» + подсказка про демо-команду */
function NoBotNotice() {
  return (
    <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      <p>
        Telegram-бот ещё не настроен. Задайте переменные
        <code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[11px]">TELEGRAM_BOT_USERNAME</code>
        и
        <code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[11px]">TELEGRAM_BOT_TOKEN</code>
        — и здесь появятся настоящие кнопки Telegram.
      </p>
      <p className="mt-1.5">
        Для отладки прямо сейчас включите демо-режим командой
        <code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[10px]">demo()</code>
        в консоли браузера (F12).
      </p>
    </div>
  );
}

export function AuthDialog() {
  const authOpen = useBackstageStore((s) => s.authOpen);
  const setAuthOpen = useBackstageStore((s) => s.setAuthOpen);
  const demoAuth = useBackstageStore((s) => s.demoAuth);
  const { loginTelegram, loginDemo, logout } = useAuthActions();
  const cfg = useAuthConfig();

  const [step, setStep] = useState<Step>("choice");
  const [name, setName] = useState("");
  const [subscriber, setSubscriber] = useState(true);
  const [mod, setMod] = useState(false);
  const [busy, setBusy] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  // намерение входа для колбэка Telegram (host → проверка роли ведущего)
  const intentRef = useRef<"host" | "viewer">("viewer");

  useEffect(() => {
    if (intentRef.current !== step && (step === "host" || step === "viewer")) {
      intentRef.current = step;
    }
  }, [step]);

  // Сброс шага при закрытии диалога — в onOpenChange (без effect)

  const handleTelegram = useCallback(
    async (user: Record<string, string | number>) => {
      const u = await loginTelegram(user);
      // «Я ВЕДУЩИЙ»: серверная валидация по ADMIN_IDS — не ведущий → выходим
      if (u && intentRef.current === "host" && u.role !== "ADMIN") {
        await logout();
        toast({
          title: "Это не аккаунт ведущего",
          description:
            "Ваш Telegram ID не числится автором инстанса (ADMIN_IDS). Войдите как зритель или настройте ADMIN_IDS.",
          variant: "destructive",
        });
      }
    },
    [loginTelegram, logout]
  );

  // Встраиваем официальный виджет Telegram (скрипт с telegram.org).
  // Кнопка рендерится только если домен сайта привязан к боту (@BotFather → /setdomain).
  useEffect(() => {
    if (!authOpen || !cfg?.botConfigured || !cfg.botUsername) return;
    if (step !== "host" && step !== "viewer") return;
    let cancelled = false;
    const botUsername = cfg.botUsername;
    // Портал Radix монтируется асинхронно — ждём кадр, чтобы контейнер точно существовал
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const container = widgetRef.current;
      if (!container) return;

      window.BackstageTelegramAuth = (user) => void handleTelegram(user);

      container.innerHTML = "";
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.async = true;
      script.setAttribute("data-telegram-login", botUsername);
      script.setAttribute("data-size", "large");
      script.setAttribute("data-radius", "8");
      script.setAttribute("data-userpic", "true");
      script.setAttribute("data-request-access", "write");
      script.setAttribute("data-onauth", "BackstageTelegramAuth(user)");
      container.appendChild(script);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [authOpen, step, cfg, handleTelegram]);

  const demoViewerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await loginDemo(name, subscriber, false, mod);
    setBusy(false);
  };

  const demoHostLogin = async () => {
    if (busy) return;
    setBusy(true);
    await loginDemo("Ведущий", false, true);
    setBusy(false);
  };

  /* ── Шаг 1: выбор «двери» ─────────────────────────────────────────── */
  const choice = (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => setStep("host")}
        className="group flex w-full items-center gap-3.5 rounded-xl border border-white/[.08] bg-white/[.03] p-4 text-left transition-all hover:border-live/40 hover:bg-live/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-live/50"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-live/15 text-live transition-colors group-hover:bg-live/25">
          <Radio className="size-5.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="headline block text-[15px] tracking-wide">Я ВЕДУЩИЙ</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            Вход автора канала · проверка Telegram ID
          </span>
        </span>
        <span className="hidden text-live/60 transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden>→</span>
      </button>

      <button
        type="button"
        onClick={() => setStep("viewer")}
        className="group flex w-full items-center gap-3.5 rounded-xl border border-white/[.08] bg-white/[.03] p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
          <UserRound className="size-5.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="headline block text-[15px] tracking-wide">ВОЙТИ</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            Вход зрителя · Telegram и подписка на канал
          </span>
        </span>
        <span className="hidden text-primary/60 transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden>→</span>
      </button>
    </div>
  );

  /* ── Шаг 2а: ведущий ──────────────────────────────────────────────── */
  const host = (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 text-sm font-semibold">
        <Radio className="size-4.5 shrink-0 text-live" aria-hidden />
        ВХОД ВЕДУЩЕГО
      </div>

      {demoAuth ? (
        <>
          <DemoBadge />
          <Button
            onClick={() => void demoHostLogin()}
            disabled={busy}
            className="btn-gradient glow-primary label-caps w-full gap-2 rounded-full"
          >
            <Radio className="size-4" />
            {busy ? "ВХОДИМ…" : "ВОЙТИ КАК ВЕДУЩИЙ (ДЕМО)"}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            Демо-вход сразу даёт роль автора (ADMIN) — как будто ваш Telegram ID прошёл валидацию.
            Первый вход на чистом инстансе спросит никнейм и аватар канала.
          </p>
        </>
      ) : cfg?.botConfigured ? (
        <>
          <div ref={widgetRef} className="flex min-h-14 justify-center py-2" />
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px text-primary" />
            После входа через Telegram платформа сверит ваш ID со списком ведущих инстанса
            (<code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[10px]">ADMIN_IDS</code>).
            Чужой аккаунт войти автором не сможет.
          </p>
        </>
      ) : (
        <NoBotNotice />
      )}
    </div>
  );

  /* ── Шаг 2б: зритель ──────────────────────────────────────────────── */
  const viewer = (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 text-sm font-semibold">
        <UserRound className="size-4.5 shrink-0 text-primary" aria-hidden />
        ВХОД ЗРИТЕЛЯ
      </div>

      {demoAuth ? (
        <form onSubmit={demoViewerSubmit} className="space-y-4">
          <DemoBadge />
          <div className="space-y-2">
            <Label htmlFor="demo-name">Имя</Label>
            <Input
              id="demo-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, Алекс"
              minLength={2}
              maxLength={32}
              required
              className="border-border bg-[#1a1a21]"
            />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Checkbox id="demo-sub" checked={subscriber} onCheckedChange={(v) => setSubscriber(v === true)} />
              <Label htmlFor="demo-sub" className="cursor-pointer text-sm font-normal leading-snug">
                Я — платный подписчик (имитация проплаты)
              </Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox id="demo-mod" checked={mod} onCheckedChange={(v) => setMod(v === true)} />
              <Label htmlFor="demo-mod" className="cursor-pointer text-sm font-normal leading-snug">
                Я — модератор чата
              </Label>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={busy || name.trim().length < 2}>
            {busy ? "Входим…" : "Войти (демо)"}
          </Button>
        </form>
      ) : cfg?.botConfigured ? (
        <>
          <div ref={widgetRef} className="flex min-h-14 justify-center py-2" />
          <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <p className="label-caps text-[10px] text-primary">ЕСЛИ КНОПКИ TELEGRAM НЕТ</p>
            <p className="mt-1">
              Виджет работает только на домене, привязанном к боту
              <span className="mx-1 font-semibold text-foreground/80">@{cfg.botUsername}</span>:
              откройте
              <span className="mx-1 font-semibold text-foreground/80">@BotFather → /setdomain</span>
              и добавьте домен этого сайта.
            </p>
          </div>
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px text-primary" />
            Мы сверяем подпись Telegram и сразу проверяем вашу подписку на приватный канал.
            Ваш номер телефона и переписка недоступны платформе.
          </p>
        </>
      ) : (
        <NoBotNotice />
      )}
    </div>
  );

  return (
    <Dialog
      open={authOpen}
      onOpenChange={(o) => {
        setAuthOpen(o);
        if (!o) setStep("choice");
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex justify-center">
            <BrandMark />
          </div>
          <DialogTitle className="headline text-center text-lg">ВХОД В BACKSTAGE</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            {step === "host"
              ? "Автор канала управляет эфиром этого инстанса."
              : step === "viewer"
                ? "Трансляции приватные: доступ открывается подписчикам Telegram-канала."
                : "Кто вы на этом инстансе?"}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          {cfg === null ? (
            <div className="grid h-28 place-items-center">
              <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            </div>
          ) : step === "choice" ? (
            choice
          ) : (
            <div className="space-y-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="label-caps -ml-2 gap-1.5 rounded-full text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setStep("choice")}
              >
                <ArrowLeft className="size-3.5" />
                НАЗАД
              </Button>
              {step === "host" ? host : viewer}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
