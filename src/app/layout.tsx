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
  title: "蒔町・拾光事務所 SHI TOWN｜03 港町留聲計畫・聲音明信片",
  description:
    "以咖啡為媒，串起地方、人才與永續的文化再生計畫。讓值得記住的聲音，成為可以收藏的記憶。",
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
