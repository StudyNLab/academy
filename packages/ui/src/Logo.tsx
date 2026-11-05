// AIONIT 로고: 심볼 + 한 단어로 붙인 AIONIT, 가운데 ON 만 빨강 (docs/디자인시스템.md 3장).
// 시안 AIONIT-Service 의 assets/brand-logo.svg 경로를 그대로 쓴다. 글꼴로 다시 짜지 않는다.
// 색: 심볼 위쪽 · 글자는 글자색(currentColor), 심볼 아래쪽은 #507CAE, ON 은 #E23542 (다크는 site.css 에서 #FF6470).
// 크기는 site.css 의 .logo-mark · .logo-word 가 정한다.

/** 심볼만 (파비콘 · 좁은 자리) */
export function LogoMark({ className = "logo-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M4 13 17 0h14L18 13l9 9-7 7z" fill="currentColor" />
      <path d="m20 11 16 16-13 13H9l13-13-9-9z" fill="#507cae" />
    </svg>
  );
}

/** 글자만: AIONIT, ON 빨강 */
export function LogoWord({ className = "logo-word" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 180 30" aria-hidden="true">
      <path
        d="M0 30 11 0h8l11 30h-8l-2-6H10l-2 6zm12-12h6l-3-10z M37 0h8v30h-8z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        className="logo-on"
        d="M6 0h16l6 6v18l-6 6H6l-6-6V6zm2 7v16h12V7z M38 30V0h8l13 17V0h8v30h-8L46 13v17z"
        fill="#e23542"
        fillRule="evenodd"
        transform="translate(55 0)"
      />
      <path
        d="M0 0h8v30H0z M18 0h30v7H37v23h-8V7H18z"
        fill="currentColor"
        fillRule="evenodd"
        transform="translate(132 0)"
      />
    </svg>
  );
}

/** 심볼 + 글자. 링크로 쓸 때는 링크에 class "logo" 와 aria-label 을 주고 LogoMark · LogoWord 를 넣는다 */
export function Logo({ className = "logo" }: { className?: string }) {
  return (
    <span className={className} role="img" aria-label="AIONIT">
      <LogoMark />
      <LogoWord />
    </span>
  );
}
