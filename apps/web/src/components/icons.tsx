// 선 그림 아이콘 (밝게 · 어둡게 버튼과 같은 모양: 24 격자, 선 1.8, 글자색). 이모지는 쓰지 않는다 (docs/디자인시스템.md)
import type { ReactNode } from "react";

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** 목차 열기 */
export function MenuIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

// 시안 AIONIT-Service 의 아이콘 (app.js 의 paths). 24 격자, 선 1.6 — 굵기 · 크기는 site.css 의 .icon
const paths = {
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6",
  chevron: "m6 9 6 6 6-6",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M18 6 6 18",
  sun: "M12 3v1m0 16v1M3 12h1m16 0h1M5.6 5.6l.7.7m11.4 11.4.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M20 15A8.5 8.5 0 0 1 9 4 8.5 8.5 0 1 0 20 15",
  book: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5",
  chat: "M21 11a8 8 0 0 1-8 8H8l-5 3V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3M7 8h10M7 12h6",
  menu: "M4 6h16M4 12h16M4 18h16",
  bell: "M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3V9m4 12h4",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-3a8 8 0 0 1 16 0v3",
} as const;

export type IconName = keyof typeof paths;

/** 시안 아이콘 하나: <svg class="icon"> */
export function SvcIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
