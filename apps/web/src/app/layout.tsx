import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "@fontsource/ibm-plex-sans-kr/300.css";
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import "./reader.css";

export const metadata: Metadata = {
  title: { default: "AIONIT", template: "%s · AIONIT" },
  description: "인프라 · 보안 · AI 를 현업 강사에게. 영상, 교재, 실습 기준으로 끝까지.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0e131b" },
  ],
};

/** 다크 모드: 운영체제 설정을 따르되, 학습 화면에서 직접 고른 값(쿠키)을 기억한다 (docs/디자인시스템.md 6장) */
const THEME_COOKIE = "aionit.theme";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="ko" data-theme={theme === "dark" || theme === "light" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
