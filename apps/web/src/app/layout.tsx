import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
// 글꼴 굵기는 시안과 같은 두 벌씩만: 400 · 600 을 부르면 브라우저가 700 · 800 을 600 으로, 500 을 400 으로 그린다
// (Manrope 는 500 · 700 두 벌. 시안 assets 의 medium · bold 파일과 같은 짜임)
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import "./reader.css";

export const metadata: Metadata = {
  title: { default: "AIONIT", template: "%s · AIONIT" },
  description: "교재를 읽고, 코드로 이해하고, 실습으로 완성하는 IT 교육. 인프라부터 보안, AI 에이전트까지.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#101722" },
  ],
};

/** 다크 모드: 운영체제 설정을 따르되, 머리글 · 학습 화면의 버튼으로 직접 고른 값(쿠키)을 기억한다 (docs/디자인시스템.md 6장) */
const THEME_COOKIE = "aionit.theme";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="ko" data-theme={theme === "dark" || theme === "light" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
