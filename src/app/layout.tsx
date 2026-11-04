import type { Metadata } from "next";
import {
  Shippori_Mincho,
  Noto_Sans_TC,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";

const shipporiMincho = Shippori_Mincho({
  weight: ["600", "800"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const notoSansTC = Noto_Sans_TC({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["500", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "喫茶 聲・KISSA VOX｜有聲祝福配樂與 7 吋黑膠 QR 壓製所",
  description:
    "錄製一段溫暖口白，透過 AI 語氣感知搭配純背景音樂或環境雨聲，自動完成廣播級人聲閃避混音並封存為可掃碼聆聽的 7 吋黑膠 QR 有聲小卡。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-Hant"
      className={`${shipporiMincho.variable} ${notoSansTC.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
