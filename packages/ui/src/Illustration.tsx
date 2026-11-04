// 그림 규칙 (docs/디자인시스템.md 3.2): 분야 그림은 연한 바탕 + 남색 선 + Signal 하나.
// 색은 토큰(--illust-bg · --illust-ink · --signal · --surface) 이라 다크 모드에서도 그대로 쓴다.
// 움직임 class(aio-*) 는 motion.css. 장식용 그림은 aria-hidden.

export type FieldKey = "infra" | "security" | "ai";

const BG = "var(--illust-bg)";
const INK = "var(--illust-ink)";
const SIGNAL = "var(--signal)";
const SURFACE = "var(--surface)";

/** 세 분야 그림 120×96: 서버 랙(표시등 깜빡임) · 로그가 든 방패(검사선) · 노드 망(신호 흐름) */
export function FieldIcon({ field, className = "" }: { field: FieldKey; className?: string }) {
  const props = { viewBox: "0 0 120 96", "aria-hidden": true, className } as const;
  if (field === "infra") {
    return (
      <svg {...props}>
        <rect x="15" y="7" width="90" height="82" fill={BG} stroke={INK} strokeWidth="2" />
        <g fill={SURFACE} stroke={INK} strokeWidth="1.5">
          <rect x="23" y="15" width="74" height="19" />
          <rect x="23" y="39" width="74" height="19" />
          <rect x="23" y="63" width="74" height="19" />
        </g>
        <g stroke={INK} strokeWidth="2" opacity="0.35">
          <path d="M68 20v9M74 20v9M80 20v9M86 20v9M68 44v9M74 44v9M80 44v9M86 44v9M68 68v9M74 68v9M80 68v9M86 68v9" />
        </g>
        <circle className="aio-blink" cx="33" cy="24.5" r="3.5" fill={SIGNAL} />
        <circle
          className="aio-blink"
          style={{ animationDelay: "0.7s" }}
          cx="33"
          cy="48.5"
          r="3.5"
          fill={SIGNAL}
        />
        <circle
          className="aio-blink"
          style={{ animationDelay: "1.4s" }}
          cx="33"
          cy="72.5"
          r="3.5"
          fill={SIGNAL}
        />
      </svg>
    );
  }
  if (field === "security") {
    const shield = "M60 5 L99 18 V46 C99 69 83 83 60 92 C37 83 21 69 21 46 V18 Z";
    return (
      <svg {...props}>
        <defs>
          <clipPath id="aio-shield-clip">
            <path d={shield} />
          </clipPath>
        </defs>
        <path d={shield} fill={BG} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <g stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0.35">
          <path d="M40 30 H80" />
          <path d="M40 54 H76" />
          <path d="M40 66 H66" />
        </g>
        <path d="M40 42 H74" stroke={SIGNAL} strokeWidth="3.5" strokeLinecap="round" />
        <g clipPath="url(#aio-shield-clip)">
          <rect className="aio-scan" x="18" y="18" width="84" height="2.5" fill={SIGNAL} opacity="0.7" />
        </g>
      </svg>
    );
  }
  return (
    <svg {...props}>
      <rect x="9" y="7" width="102" height="82" fill={BG} stroke={INK} strokeWidth="2" />
      <g stroke={INK} strokeWidth="1.5" opacity="0.3">
        <path d="M27 25 L60 38 M27 48 L60 38 M27 71 L60 58 M27 48 L60 58 M27 71 L60 38" />
      </g>
      <g stroke={SIGNAL} strokeWidth="2" fill="none">
        <path className="aio-flow" d="M27 25 L60 58 L93 48" />
        <path className="aio-flow" style={{ animationDelay: "-0.5s" }} d="M60 38 L93 48" />
      </g>
      <g fill={SURFACE} stroke={INK} strokeWidth="2">
        <circle cx="27" cy="25" r="5" />
        <circle cx="27" cy="48" r="5" />
        <circle cx="27" cy="71" r="5" />
        <circle cx="60" cy="38" r="5" />
        <circle cx="60" cy="58" r="5" />
      </g>
      <circle className="aio-ring" cx="93" cy="48" r="7" fill="none" stroke={SIGNAL} strokeWidth="1.5" />
      <circle cx="93" cy="48" r="7" fill={SIGNAL} stroke={SURFACE} strokeWidth="2" />
    </svg>
  );
}

/** 강의 표지 96×96: 남색 바탕(라이트 · 다크 공통) 에 번호와 분야 무늬. 줄(group)에 마우스를 올리면 무늬가 커진다 */
export function CourseCover({
  no,
  field,
  className = "",
}: {
  no: number;
  field: FieldKey;
  className?: string;
}) {
  const paper = "#F6F5F1";
  const accent = "#F0A88C";
  return (
    <span
      aria-hidden="true"
      className={`flex h-24 w-24 shrink-0 flex-col justify-between bg-[#18304F] p-2.5 text-[#F6F5F1] ${className}`}
    >
      <span className="font-mono text-[11px] tracking-[0.08em] text-[#F0A88C]">
        {String(no).padStart(2, "0")}
      </span>
      <svg
        viewBox="0 0 76 40"
        className="h-10 w-[76px] transition-transform duration-200 ease-out group-hover:scale-110"
      >
        {field === "ai" ? (
          <>
            <circle cx="38" cy="22" r="15" fill="none" stroke={paper} strokeWidth="1.5" />
            <path d="M36 3 L43 7 L36 11 Z" fill={paper} />
            <circle cx="38" cy="22" r="3.5" fill={accent} />
            <rect x="52" y="19" width="6" height="6" fill="#18304F" stroke={paper} strokeWidth="1.5" />
          </>
        ) : field === "security" ? (
          <>
            <g stroke={paper} strokeWidth="2" strokeLinecap="round" opacity="0.6">
              <path d="M6 6 H52" />
              <path d="M6 15 H40" />
              <path d="M6 33 H46" />
            </g>
            <path d="M6 24 H64" stroke={accent} strokeWidth="2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <g fill="none" stroke={paper} strokeWidth="1.5">
              <rect x="6" y="4" width="64" height="9" />
              <rect x="6" y="16" width="64" height="9" />
              <rect x="6" y="28" width="64" height="9" />
            </g>
            <circle cx="13" cy="20.5" r="2" fill={accent} />
            <circle cx="13" cy="8.5" r="2" fill={paper} opacity="0.6" />
            <circle cx="13" cy="32.5" r="2" fill={paper} opacity="0.6" />
          </>
        )}
      </svg>
    </span>
  );
}
