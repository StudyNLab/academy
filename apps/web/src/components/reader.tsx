"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 교재 본문 표시 + 동작 (교재 도구 academy.js 를 옮김): 코드 복사, 그림 크게 보기.
 * html 은 서버에서 허용 목록으로 정리한 본문이다 (packages/content sanitize).
 */
export function Reader({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const copy = target.closest<HTMLButtonElement>("button.copy");
      if (copy) {
        const pre = copy.closest(".code")?.querySelector("pre")?.cloneNode(true) as HTMLElement | undefined;
        if (!pre) return;
        pre.querySelectorAll(".ln").forEach((n) => n.remove());
        const lines = pre.querySelectorAll(".line");
        const text = lines.length
          ? [...lines].map((l) => l.textContent ?? "").join("\n")
          : (pre.textContent ?? "");
        void navigator.clipboard.writeText(text).then(() => {
          copy.textContent = "복사됨";
          setTimeout(() => (copy.textContent = "복사"), 1500);
        });
        return;
      }
      const img = target.closest<HTMLImageElement>("figure.fig img");
      if (img) setZoom({ src: img.currentSrc || img.src, alt: img.alt });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!zoom) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setZoom(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [zoom]);

  return (
    <>
      <div ref={ref} className="reader" dangerouslySetInnerHTML={{ __html: html }} />
      {zoom ? (
        <div className="zoom-view" role="dialog" aria-label="그림 크게 보기" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 교재 그림 원본 크기 보기 */}
          <img src={zoom.src} alt={zoom.alt} />
          <p>{zoom.alt} (닫기: 화면을 누르거나 Esc)</p>
        </div>
      ) : null}
    </>
  );
}
