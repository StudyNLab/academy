"use client";

import { useEffect, useState } from "react";
import { SvcIcon } from "./icons";

const COOKIE = "aionit.theme";

/**
 * 다크 모드 켜고 끄기 (공통 머리글 · 학습 머리글). 고른 값은 쿠키에 1년 남겨 다음에도 같은 모양으로 그린다.
 * 모양은 시안의 .icon-btn.theme-btn (해 · 달 아이콘). 학습 머리글은 className 으로 크기를 맞춘다.
 */
export function ThemeToggle({
  className = "inline-flex h-11 w-11 items-center justify-center text-ink",
}: {
  className?: string;
}) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const chosen = document.documentElement.dataset.theme;
    setDark(chosen ? chosen === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const theme = next ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.cookie = `${COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  const label = dark ? "밝은 화면으로" : "어두운 화면으로";
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={className}>
      <SvcIcon name={dark ? "sun" : "moon"} />
    </button>
  );
}
