"use client";

import { buttonClass } from "@aionit/ui";

export const PROVIDER_LABEL = { google: "구글", kakao: "카카오" } as const;

/** 구글 · 카카오 버튼 (외곽선 버튼. 채운 버튼은 화면의 주 행동 하나에만) */
export function SocialButtons({
  providers,
  verb,
  onSelect,
  disabled,
}: {
  providers: ("google" | "kakao")[];
  verb: string;
  onSelect: (provider: "google" | "kakao") => void;
  disabled?: boolean;
}) {
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(provider)}
          className={buttonClass("outline", "lg", "w-full")}
        >
          {PROVIDER_LABEL[provider]}로 {verb}
        </button>
      ))}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-8 flex items-center gap-4 text-[13px] text-ink-2" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      또는
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
