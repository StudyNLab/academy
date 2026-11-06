// 밝은 · 어두운 화면 고르기 (docs/디자인시스템.md 6장). 서버(app/layout.tsx)와 머리글 버튼(components/theme-toggle.tsx)이 함께 쓴다.

/** 직접 고른 값(light | dark)을 1년 남기는 쿠키. 없으면 운영체제 설정을 따른다 */
export const THEME_COOKIE = "aionit.theme";

export type Theme = "light" | "dark";

/** 주소창 등 브라우저가 칠하는 곳의 색 (meta theme-color, aionit-design 브라우저 브랜딩 요청서 3번) */
export const THEME_COLOR: Record<Theme, string> = { light: "#F8F9FC", dark: "#101722" };

export const SCHEME_MEDIA: Record<Theme, string> = {
  light: "(prefers-color-scheme: light)",
  dark: "(prefers-color-scheme: dark)",
};

export function chosenTheme(value: string | undefined): Theme | undefined {
  return value === "dark" || value === "light" ? value : undefined;
}

/**
 * 버튼으로 테마를 바꾸면 이미 그려진 meta theme-color 의 색만 고친다 (태그를 더하거나 빼지 않는다 — Next 가 그린 태그라서).
 * 다음 화면 이동부터는 서버가 쿠키를 보고 같은 값을 그린다 (layout.tsx generateViewport).
 */
export function syncThemeColor(theme: Theme | undefined): void {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLOR[theme ?? scheme];
  });
}
