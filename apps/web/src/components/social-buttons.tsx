"use client";

export const PROVIDER_LABEL = { google: "구글", kakao: "카카오" } as const;

/** 버튼 글 (시안: "Google로 계속하기" · "카카오로 계속하기") */
const BUTTON_NAME = { google: "Google", kakao: "카카오" } as const;

/** 구글 · 카카오 버튼 (시안 .social-buttons, 카카오는 노란 바탕) */
export function SocialButtons({
  providers,
  onSelect,
  disabled,
}: {
  providers: ("google" | "kakao")[];
  onSelect: (provider: "google" | "kakao") => void;
  disabled?: boolean;
}) {
  if (providers.length === 0) return null;
  return (
    <div className="social-buttons">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(provider)}
          className={provider === "kakao" ? "btn secondary kakao" : "btn secondary"}
        >
          {BUTTON_NAME[provider]}로 계속하기
        </button>
      ))}
    </div>
  );
}

/** 시안 .or-divider ("또는 이메일로") */
export function OrDivider({ label = "또는 이메일로" }: { label?: string }) {
  return (
    <div className="or-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}
