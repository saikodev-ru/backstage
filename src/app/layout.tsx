import type { Metadata, Viewport } from "next";
import { Golos_Text, Unbounded } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Толстая типографика «Бэкстейдж»:
//  - Golos Text (400–900, кириллица) — основной текст, по умолчанию weight 500
//  - Unbounded (500–900, кириллица) — дисплейный: лого, заголовки, навигация
const golos = Golos_Text({
  variable: "--font-golos",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BACKSTAGE — приватные трансляции dypaGPT",
  description:
    "BACKSTAGE: приватная стрим-платформа dypaGPT для платных подписчиков. Эфиры, клипы, записи и расписание. Авторизация через Telegram.",
  keywords: ["BACKSTAGE", "Бэкстейдж", "dypaGPT", "VTuber", "стрим", "трансляции", "Telegram", "приватный стрим", "подписка"],
  authors: [{ name: "SaikoDev" }],
  openGraph: {
    title: "BACKSTAGE — приватные трансляции dypaGPT",
    description: "Twitch-опыт для платных подписчиков. Эфиры, клипы, записи, расписание.",
    siteName: "BACKSTAGE",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#101014",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body
        className={`${golos.variable} ${unbounded.variable} font-sans font-medium antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
