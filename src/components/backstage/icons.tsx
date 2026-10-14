// Небольшие кастомные иконки в стиле Twitch (заливка, а не обводка).

import { cn } from "@/lib/utils";

/**
 * Зритель — силуэт человека (голова + плечи), как счётчик зрителей в Twitch.
 * Иконка-«глазик» здесь намеренно не используется: в Twitch просмотры
 * обозначаются именно человечком.
 */
export function ViewersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
    >
      <path d="M10 3.4a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Z" />
      <path d="M2.6 16.55c0-3.14 3.7-5.2 7.4-5.2s7.4 2.06 7.4 5.2c0 .8-.63 1.45-1.42 1.45H4.02c-.79 0-1.42-.65-1.42-1.45Z" />
    </svg>
  );
}
