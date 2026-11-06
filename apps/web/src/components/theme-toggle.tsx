"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { chosenTheme, syncThemeColor, THEME_COOKIE } from "@/lib/theme";
import { SvcIcon } from "./icons";

/**
 * 다크 모드 켜고 끄기 (공통 머리글 · 학습 머리글). 고른 값은 쿠키에 1년 남겨 다음에도 같은 모양으로 그린다.
 * 주소창 색(meta theme-color)도 함께 바꾼다.
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
    document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    syncThemeColor(theme);
  }

  const label = dark ? "밝은 화면으로" : "어두운 화면으로";
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={className}>
      <SvcIcon name={dark ? "sun" : "moon"} />
    </button>
  );
}

/**
 * 화면을 옮길 때 주소창 색을 고른 테마에 다시 맞춘다. 버튼을 누르기 전에 받아 둔 화면(뒤로 가기 · 미리 받은 링크)은
 * 그때의 meta theme-color 를 다시 그리기 때문이다. 루트 layout 에 한 번 둔다.
 */
export function ThemeColorSync() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    syncThemeColor(chosenTheme(document.documentElement.dataset.theme));
  }, [pathname, search]);
  return null;
}
