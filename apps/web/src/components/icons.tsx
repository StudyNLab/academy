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

/** 알림 */
export function BellIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </Icon>
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
