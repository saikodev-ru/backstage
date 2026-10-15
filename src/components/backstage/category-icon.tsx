import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Белые ЗАЛИТЫЕ svg-иконки категорий эфира (24×24, fill=currentColor).
 * Рисуются вручную простыми формами (path/circle/rect, fill-rule=evenodd
 * для вырезов) — единый минималистичный стиль «solid-пиктограмма»,
 * никаких эмодзи. Используется в выборе категории, инфо-баре эфира,
 * карточках каналов и сайдбаре.
 */

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)} fill="currentColor">
      {children}
    </svg>
  );
}

/* Общение — сплошной «пузырь» с хвостиком */
function ChatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3C6.9 3 2.8 6.7 2.8 11.3c0 2.6 1.3 4.9 3.4 6.5l-1 3.6c-.1.5.4.9.9.6l4-2.4c.6.1 1.2.2 1.9.2 5.1 0 9.2-3.7 9.2-8.4S17.1 3 12 3Z" />
    </Svg>
  );
}

/* Игры — геймпад: сплошное тело, крестовина и кнопки вырезаны (evenodd) */
function GamesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.5 6.8h9a5.2 5.2 0 0 1 5.1 6.2l-.7 3.6a4.3 4.3 0 0 1-7.6 1.7l-.4-.6h-2.6l-.4.6a4.3 4.3 0 0 1-7.6-1.7l-.7-3.6a5.2 5.2 0 0 1 5-6.2ZM7.5 9.9h1.4v1.3h1.3v1.4H8.9v1.3H7.5v-1.3H6.2v-1.4h1.3V9.9Zm8.3.55a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm1.7 2.2a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z"
      />
    </Svg>
  );
}

/* Музыка — сдвоенная нота: две головы + штили + перекладина */
function MusicIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8.2 4.6 20.4 3.3v3.4L8.2 8V4.6Z" />
      <path d="M8.2 4.6h1.6v12.9H8.2V4.6Z" />
      <path d="M18.8 3.3h1.6v12.2h-1.6V3.3Z" />
      <circle cx="6" cy="17.5" r="3" />
      <circle cx="16.7" cy="15.5" r="3" />
    </Svg>
  );
}

/* IRL — идущий человек (голова + наклонённый корпус, руки/ноги в шаге) */
function IrlIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="13.2" cy="3.3" r="2.1" />
      <g transform="rotate(8 12.7 9.5)">
        <rect x="11.5" y="5.9" width="2.4" height="7.2" rx="1.2" />
      </g>
      <rect x="11.6" y="6.4" width="2.1" height="6.8" rx="1.05" transform="rotate(-54 12.65 7.2)" />
      <rect x="11.6" y="6.4" width="2.1" height="6.2" rx="1.05" transform="rotate(44 12.65 7.2)" />
      <rect x="11.6" y="12.2" width="2.3" height="7.7" rx="1.15" transform="rotate(-30 12.75 12.8)" />
      <rect x="11.6" y="12.2" width="2.3" height="7.4" rx="1.15" transform="rotate(36 12.75 12.8)" />
    </Svg>
  );
}

/* Сон — полумесяц (классический контур луны, залитый целиком) */
function SleepIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Svg>
  );
}

/* Рисование — кисть: диагональная ручка + клин щетины (читается в 16px,
   в отличие от палитры с мелкими отверстиями) */
function ArtIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="14.1" y="2.7" width="2.6" height="9.6" rx="1.3" transform="rotate(45 15.4 7.5)" />
      <rect x="9.9" y="10.3" width="4.4" height="2.6" rx="0.6" transform="rotate(45 12.1 11.6)" />
      <path d="M7.8 13.2c-2.1 2.1-3.6 4.6-4.2 7.1-.1.5.4 1 .9.9 2.5-.6 5-2.1 7.1-4.2l-3.8-3.8Z" />
    </Svg>
  );
}

/* Разработка — двойные шевроны </> */
function DevIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4Zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4Z" />
    </Svg>
  );
}

/* Кулинария — вилка (3 зубца + ручка) и нож */
function CookingIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.3 2h1.5v5.4h1.2V2h1.5v5.4h1.2V2h1.5v7c0 1-.7 1.8-1.6 2V22H8.1V11c-.9-.2-1.6-1-1.6-2V2Z" />
      <path d="M17.2 2.1c-1.9 3.1-2.2 6.6-.6 9.5.1.2.1.3.1.5V22h1.9v-9.9c0-.2 0-.3.1-.5 1.6-2.9 1.3-6.4-.6-9.5h-.9Z" />
    </Svg>
  );
}

/* Танцы — асимметричный силуэт (арабеск): опорная нога вертикально,
   вторая — в сторону, руки в противоходе. Асимметрия отличает фигуру
   от «звёздочки»/цветка и читается как человек в движении */
function DanceIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11.6" cy="3.7" r="2.05" />
      <rect x="10.5" y="6" width="2.4" height="6.8" rx="1.2" transform="rotate(6 11.7 9.4)" />
      <rect x="10.6" y="6.4" width="2.1" height="6.4" rx="1.05" transform="rotate(-108 11.65 7.2)" />
      <rect x="10.6" y="6.4" width="2.1" height="6" rx="1.05" transform="rotate(72 11.65 7.2)" />
      <rect x="10.7" y="12.4" width="2.3" height="7.7" rx="1.15" transform="rotate(4 11.85 13.2)" />
      <rect x="10.7" y="12.4" width="2.3" height="7.2" rx="1.15" transform="rotate(58 11.85 13.2)" />
    </Svg>
  );
}

/* Аниме — сакура: 5 лепестков вокруг центра */
function AnimeIcon({ className }: IconProps) {
  const petal = "M12 3.4c1.2 1 1.9 2.4 1.9 3.8 0 1.5-.8 2.9-1.9 3.8-1.2-.9-1.9-2.3-1.9-3.8 0-1.4.7-2.8 1.9-3.8Z";
  return (
    <Svg className={className}>
      {[0, 72, 144, 216, 288].map((deg) => (
        <path key={deg} d={petal} transform={`rotate(${deg} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="1.9" />
    </Svg>
  );
}

/* ASMR — наушники: дуга + две чашки */
function AsmrIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 13.4a7 7 0 0 1 14 0v.7h-2.2v-.7a4.8 4.8 0 0 0-9.6 0v.7H5v-.7Z" />
      <rect x="3.2" y="12.8" width="4.2" height="8.2" rx="2" />
      <rect x="16.6" y="12.8" width="4.2" height="8.2" rx="2" />
    </Svg>
  );
}

/* Наука — колба (evenodd: пузырьки вырезаны) */
function ScienceIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.3 2.2h5.4v1.7h-1.5v5l5.1 9.5c.7 1.3-.2 2.9-1.7 2.9H7.4c-1.5 0-2.4-1.6-1.7-2.9l5.1-9.5v-5H9.3V2.2Zm2.7 13a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm-2.4-2.9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    </Svg>
  );
}

const ICONS: Record<string, (p: IconProps) => ReactNode> = {
  "just-chatting": ChatIcon,
  games: GamesIcon,
  music: MusicIcon,
  irl: IrlIcon,
  sleep: SleepIcon,
  art: ArtIcon,
  dev: DevIcon,
  cooking: CookingIcon,
  dance: DanceIcon,
  anime: AnimeIcon,
  asmr: AsmrIcon,
  science: ScienceIcon,
};

/** Иконка категории по slug (неизвестный slug → точка-маркер) */
export function CategoryIcon({ slug, className }: { slug: string; className?: string }) {
  const Icon = ICONS[slug];
  if (Icon) return <Icon className={className} />;
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4.5" />
    </Svg>
  );
}
