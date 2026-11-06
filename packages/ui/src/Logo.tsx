// AIONIT 로고: 한 단어로 붙인 AIONIT 워드마크, 가운데 ON 만 빨강. 앞에 심볼을 붙이지 않는다 (docs/디자인시스템.md 3장).
// 디자인 저장소 StudyNLab/aionit-design 태그 v2-2026-11-06 의 brand/logo-light.svg · logo-dark.svg 경로를 그대로 쓴다.
// 두 파일은 색만 다르므로 한 벌로 그리고 색은 토큰으로 바꾼다: 글자 --logo-ink, ON --logo-on (packages/ui/src/tokens.css).
// viewBox 위아래 여백까지 SVG 원본 그대로. 크기는 site.css 의 .logo-word 가 정한다.

/** 워드마크: AIONIT, ON 빨강 */
export function LogoWord({ className = "logo-word" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 187 52" aria-hidden="true">
      <g transform="translate(0 7)">
        <g className="logo-ink">
          <path fillRule="evenodd" d="M0 38 14 0h8l14 38h-8l-3.5-10h-13L8 38Zm14-17h8l-4-12.5Z" />
          <rect x="43" width="7" height="38" rx=".7" />
          <rect x="138" width="7" height="38" rx=".7" />
          <path d="M153 0h34v7h-13.5v31h-7V7H153Z" />
        </g>
        <g className="logo-on">
          <path
            fillRule="evenodd"
            d="M69 0h10q11 0 11 11v16q0 11-11 11H69q-11 0-11-11V11Q58 0 69 0Zm1 7q-4 0-4 5v14q0 5 4 5h8q4 0 4-5V12q0-5-4-5Z"
          />
          <path d="M98 38V0h8l16 25V0h8v38h-8l-16-25v25Z" />
        </g>
      </g>
    </svg>
  );
}

/** 링크가 아닌 자리의 로고. 링크로 쓸 때는 링크에 class "logo" 와 aria-label 을 주고 LogoWord 를 넣는다 */
export function Logo({ className = "logo" }: { className?: string }) {
  return (
    <span className={className} role="img" aria-label="AIONIT">
      <LogoWord />
    </span>
  );
}
