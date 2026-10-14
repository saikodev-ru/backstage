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
  const [busy, setBusy] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetMounted = useRef(false);

  // Встраиваем официальный виджет Telegram (скрипт с telegram.org)
  useEffect(() => {
    if (!authOpen || !cfg?.botConfigured || !cfg.botUsername || widgetMounted.current) return;
    const container = widgetRef.current;
    if (!container) return;

    window.BackstageTelegramAuth = (user) => void loginTelegram(user);

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", cfg.botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-userpic", "true");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "BackstageTelegramAuth(user)");
    container.appendChild(script);
    widgetMounted.current = true;

    return () => {
      // не удаляем скрипт при закрытии — Telegram запрещает повторную инициализацию
    };
  }, [authOpen, cfg, loginTelegram]);

  const demoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await loginDemo(name, subscriber, admin);
    setBusy(false);
  };

  return (
    <Dialog open={authOpen} onOpenChange={setAuthOpen}>
      <DialogContent className="max-w-sm border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex justify-center">
            <BrandMark />
          </div>
          <DialogTitle className="text-center text-xl">Вход в Бэкстейдж</DialogTitle>
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
              <div ref={widgetRef} className="flex justify-center py-3" />
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px text-primary" />
                Мы сверяем подпись Telegram и сразу проверяем вашу подписку на приватный канал.
                Ваш номер телефона и переписка недоступны платформе.
              </p>
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
                    Войти как администратор
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
