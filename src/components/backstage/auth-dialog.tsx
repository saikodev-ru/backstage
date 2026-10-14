"use client";

// Диалог входа: Telegram Login Widget (бот настроен) либо демо-режим.

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
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
import type { AuthConfigDto } from "@/lib/types";

// Глобальный callback для Telegram Login Widget (data-onauth)
declare global {
  interface Window {
    BackstageTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

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

export function AuthDialog() {
  const authOpen = useBackstageStore((s) => s.authOpen);
  const setAuthOpen = useBackstageStore((s) => s.setAuthOpen);
  const { loginTelegram, loginDemo } = useAuthActions();
  const cfg = useAuthConfig();

  const [name, setName] = useState("");
  const [subscriber, setSubscriber] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [mod, setMod] = useState(false);
  const [busy, setBusy] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetMounted = useRef(false);

  // Встраиваем официальный виджет Telegram (скрипт с telegram.org).
  // Кнопка рендерится только если домен сайта привязан к боту (@BotFather → /setdomain).
  useEffect(() => {
    if (!authOpen || !cfg?.botConfigured || !cfg.botUsername || widgetMounted.current) return;
    let cancelled = false;
    const botUsername = cfg.botUsername;
    // Портал Radix монтируется асинхронно — ждём кадр, чтобы контейнер точно существовал
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const container = widgetRef.current;
      if (!container) return;

      window.BackstageTelegramAuth = (user) => void loginTelegram(user);

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
      widgetMounted.current = true;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [authOpen, cfg, loginTelegram]);

  const demoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await loginDemo(name, subscriber, admin, mod);
    setBusy(false);
  };

  return (
    <Dialog open={authOpen} onOpenChange={setAuthOpen}>
      <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex justify-center">
            <BrandMark />
          </div>
          <DialogTitle className="headline text-center text-lg">ВХОД В BACKSTAGE</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            Трансляции приватные: доступ открывается подписчикам
            {cfg?.botConfigured ? " после входа через Telegram." : " приватного Telegram-канала."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          {cfg === null ? (
            <div className="grid h-28 place-items-center">
              <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            </div>
          ) : cfg.botConfigured ? (
            <div className="space-y-4">
              <div ref={widgetRef} className="flex min-h-14 justify-center py-3" />
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <p className="label-caps text-[10px] text-primary">
                  ЕСЛИ КНОПКИ TELEGRAM НЕТ
                </p>
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
              {cfg.demoMode && (
                <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2.5">
                  <p className="label-caps text-[10px] text-muted-foreground">
                    <Sparkles className="mr-1 inline size-3.5 text-primary" aria-hidden />
                    ДЕМО-РЕЖИМ РАЗРАБОТКИ
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Имя для теста"
                      minLength={2}
                      maxLength={32}
                      aria-label="Демо-имя"
                      className="label-caps h-9 bg-[#1a1a21] text-[12px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="label-caps shrink-0 text-[11px]"
                      disabled={busy || name.trim().length < 2}
                      onClick={() =>
                        void loginDemo(name, subscriber, admin, mod)
                      }
                    >
                      {busy ? "…" : "ДЕМО-ВОЙТИ"}
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] leading-snug">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox checked={subscriber} onCheckedChange={(v) => setSubscriber(v === true)} aria-label="подписчик" className="size-3.5" />
                      подписчик
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox checked={mod} onCheckedChange={(v) => setMod(v === true)} aria-label="модератор" className="size-3.5" />
                      модератор
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox checked={admin} onCheckedChange={(v) => setAdmin(v === true)} aria-label="владелец" className="size-3.5" />
                      владелец
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={demoSubmit} className="space-y-4">
              <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-accent-foreground">
                <Sparkles className="mr-1.5 inline size-3.5 -translate-y-px text-primary" />
                <strong>Демо-режим.</strong> Telegram-бот ещё не настроен. Задайте переменные
                <code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[11px]">TELEGRAM_BOT_USERNAME</code>
                и<code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[11px]">TELEGRAM_BOT_TOKEN</code>
                — и здесь появится настоящая кнопка Telegram.
              </div>

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
                  <Checkbox id="demo-admin" checked={admin} onCheckedChange={(v) => setAdmin(v === true)} />
                  <Label htmlFor="demo-admin" className="cursor-pointer text-sm font-normal leading-snug">
                    Войти как владелец канала
                  </Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Checkbox id="demo-mod" checked={mod} onCheckedChange={(v) => setMod(v === true)} />
                  <Label htmlFor="demo-mod" className="cursor-pointer text-sm font-normal leading-snug">
                    Войти как модератор чата
                  </Label>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={busy || name.trim().length < 2}>
                {busy ? "Входим…" : "Войти (демо)"}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
