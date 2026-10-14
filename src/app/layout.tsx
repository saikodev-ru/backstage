import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Бэкстейдж — приватные трансляции",
  description:
    "Бэкстейдж: платформа приватных трансляций для платных подписчиков. Эфиры, клипы, записи и расписание. Авторизация через Telegram.",
  keywords: ["Бэкстейдж", "стрим", "трансляции", "Telegram", "приватный стрим", "подписка"],
  authors: [{ name: "SaikoDev" }],
  openGraph: {
    title: "Бэкстейдж — приватные трансляции",
    description: "Twitch-опыт для платных подписчиков. Эфиры, клипы, записи, расписание.",
    siteName: "Бэкстейдж",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#101014",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
