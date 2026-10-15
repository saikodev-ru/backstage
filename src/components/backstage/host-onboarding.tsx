"use client";

// Онбординг ведущего: первый вход автора на «чистой» инстансе.
//
// Один инстанс = один ведущий = один канал. Если автор вошёл (роль ADMIN),
// а канала ещё нет — всплывает это окно: нужно ввести никнейм и добавить
// аватар. После создания канал настраивается во вкладке «Настройки канала».
//
// Отладка: команда demo("onboarding") в консоли браузера открывает окно
// принудительно (не трогая данные).

import { useEffect, useState } from "react";
import { Radio, Sparkles } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CROP_AVATAR, CropUploadButton } from "@/components/backstage/crop-dialog";
import { useBackstageStore } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import type { PublicChannel } from "@/lib/types";

/** Событие отладки: demo("onboarding") */
export const DEMO_ONBOARDING_EVENT = "bs-demo-onboarding";

export function HostOnboarding() {
  const user = useBackstageStore((s) => s.user);
  const channels = useBackstageStore((s) => s.channels);
  const setChannels = useBackstageStore((s) => s.setChannels);
  const setView = useBackstageStore((s) => s.setView);

  // Пользователь уже закрыл окно в этой сессии — не навязываемся
  const [dismissed, setDismissed] = useState(false);
  const [forced, setForced] = useState(false);

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // Автопоказ: автор без канала (каждый раз, пока канал не создан, кроме «позже»)
  const shouldAuto = Boolean(user?.role === "ADMIN" && channels.length === 0 && !dismissed);
  const open = shouldAuto || forced;

  useEffect(() => {
    const onDebug = () => setForced(true);
    window.addEventListener(DEMO_ONBOARDING_EVENT, onDebug);
    return () => window.removeEventListener(DEMO_ONBOARDING_EVENT, onDebug);
  }, []);

  const close = () => {
    setDismissed(true);
    setForced(false);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast({ title: "Никнейм слишком короткий", variant: "destructive" });
      return;
    }
    if (!avatarUrl) {
      toast({ title: "Добавьте аватар канала", description: "Загрузите изображение — его увидят зрители", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, avatarUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { channel?: PublicChannel; message?: string };
      if (!res.ok || !data.channel) throw new Error(data.message ?? `HTTP ${res.status}`);
      setChannels([data.channel, ...channels]);
      toast({
        title: "Канал создан",
        description: `«${data.channel.name}» — единственный канал этого инстанса`,
      });
      setForced(false);
      setDismissed(true);
      setView("settings");
    } catch (e) {
      toast({ title: "Не удалось создать канал", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="headline flex items-center gap-2 text-lg">
            <Radio className="size-5 text-live" aria-hidden />
            СОЗДАНИЕ КАНАЛА
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Один инстанс — один ведущий канал. Придумайте никнейм и добавьте аватар:
            остальное настроите в «Настройках канала».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {forced && (
            <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <Sparkles className="mr-1 inline size-3.5 text-primary" aria-hidden />
              <span className="label-caps text-[10px] text-primary">ОТЛАДКА (demo("onboarding"))</span>
              <span className="ml-1.5">— окно открыто принудительно, данные не изменятся.</span>
            </div>
          )}

          {/* Аватар */}
          <div className="flex items-center gap-4">
            <Avatar className="size-16 rounded-full ring-2 ring-white/10">
              <AvatarImage src={avatarUrl || undefined} alt={name || "Аватар канала"} />
              <AvatarFallback className="rounded-full bg-[#1c1c21] text-2xl font-black text-[#d6d6de]">
                {(name.trim()[0] ?? "?").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="label-caps text-[11px] text-muted-foreground">АВАТАР КАНАЛА</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground/80">
                Круглый, виден в топбаре, чате и карточках
              </p>
            </div>
          </div>
          <CropUploadButton
            target={CROP_AVATAR}
            onUploaded={(url) => setAvatarUrl(url)}
            label={avatarUrl ? "ЗАМЕНИТЬ АВАТАР" : "ЗАГРУЗИТЬ АВАТАР"}
          />

          {/* Никнейм */}
          <div className="space-y-2">
            <Label htmlFor="onb-name" className="label-caps text-[11px] text-muted-foreground">
              НИКНЕЙМ КАНАЛА
            </Label>
            <Input
              id="onb-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="Например, dypaGPT"
              minLength={2}
              maxLength={40}
              className="border-border bg-[#1a1a21]"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void create()}
              disabled={busy || name.trim().length < 2 || !avatarUrl}
              className="btn-gradient glow-primary label-caps flex-1 gap-2 rounded-full"
            >
              {busy ? "СОЗДАЁМ…" : "СОЗДАТЬ КАНАЛ"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="label-caps rounded-full text-muted-foreground hover:text-foreground"
              onClick={close}
              disabled={busy}
            >
              ПОЗЖЕ
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
