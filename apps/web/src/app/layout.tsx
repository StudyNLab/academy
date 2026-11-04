import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
