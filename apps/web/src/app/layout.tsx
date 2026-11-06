import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { ThemeColorSync } from "@/components/theme-toggle";
import { chosenTheme, SCHEME_MEDIA, THEME_COLOR, THEME_COOKIE } from "@/lib/theme";
// 글꼴 굵기는 시안과 같은 두 벌씩만: 400 · 600 을 부르면 브라우저가 700 · 800 을 600 으로, 500 을 400 으로 그린다
// (Manrope 는 500 · 700 두 벌. 시안 assets 의 medium · bold 파일과 같은 짜임)
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import "./reader.css";

// 탭 제목: 홈은 "AIONIT | 아이오닛", 다른 화면은 "{화면 이름} | AIONIT" (aionit-design 브라우저 브랜딩 요청서 1번).
// 홈은 제목을 따로 두지 않아 default 를 쓴다. 파비콘은 app/icon.svg (= aionit-design brand/favicon.svg)
export const metadata: Metadata = {
  title: { default: "AIONIT | 아이오닛", template: "%s | AIONIT" },
  description: "교재를 읽고, 코드로 이해하고, 실습으로 완성하는 IT 교육. 인프라부터 보안, AI 에이전트까지.",
};

/** 주소창 색: 직접 고른 테마가 있으면 그 색 하나, 없으면 운영체제 설정에 따라 (버튼으로 바꾸면 theme-toggle 이 고친다) */
export async function generateViewport(): Promise<Viewport> {
  const theme = chosenTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    themeColor: theme
      ? THEME_COLOR[theme]
      : [
          { media: SCHEME_MEDIA.light, color: THEME_COLOR.light },
          { media: SCHEME_MEDIA.dark, color: THEME_COLOR.dark },
        ],
  };
}

/** 다크 모드: 운영체제 설정을 따르되, 머리글 · 학습 화면의 버튼으로 직접 고른 값(쿠키)을 기억한다 (docs/디자인시스템.md 6장) */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = chosenTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ko" data-theme={theme}>
      <body>
        {children}
        <Suspense fallback={null}>
          <ThemeColorSync />
        </Suspense>
      </body>
    </html>
  );
}
