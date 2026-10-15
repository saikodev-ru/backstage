"use client";

// Выбор категории эфира: компактная сетка плиток (белая залитая
// svg-иконка + название). Используется в настройках канала и в пульте
// эфира (внутри диалогов). value — slug категории; если значение не
// совпадает ни с одной категорией (легаси-строка), активной плитки нет.

import { CATEGORIES } from "@/lib/categories";
import { CategoryIcon } from "@/components/backstage/category-icon";
import { cn } from "@/lib/utils";

export function CategoryPicker({ value, onChange }: { value: string | null; onChange: (slug: string) => void }) {
  return (
    <div role="group" aria-label="Категория эфира" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {CATEGORIES.map((c) => {
        const active = value === c.slug;
        return (
          <button
            key={c.slug}
            type="button"
            aria-pressed={active}
            aria-label={c.name}
            onClick={() => onChange(c.slug)}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.02] p-2.5 transition-colors",
              "hover:border-white/30 hover:bg-white/[.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              active && "border-white bg-white/[.06]"
            )}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
                active ? "bg-white text-[#101014]" : "bg-white/[.06] text-white"
              )}
            >
              <CategoryIcon slug={c.slug} className="size-[18px]" />
            </span>
            <span className="truncate text-[12px] font-semibold">{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}
