// 그림 규칙 (docs/디자인시스템.md 3.2): 선 굵기 1.5, 색은 잉크(currentColor) 와 Signal 둘뿐.
// 면은 surface · sunken 토큰을 써서 다크 모드에서도 그대로 쓴다. 장식용 그림은 aria-hidden.

export type FieldKey = "infra" | "security" | "ai";

const INK = "currentColor";
const SIGNAL = "var(--signal)";
const SURFACE = "var(--surface)";
const SUNKEN = "var(--surface-sunken)";
const LINE = "var(--line)";

/** 세 분야 그림 120×96: 서버 랙 · 로그가 든 방패 · 노드 망 */
export function FieldIcon({ field, className = "" }: { field: FieldKey; className?: string }) {
  const props = { viewBox: "0 0 120 96", "aria-hidden": true, className: `text-ink ${className}` } as const;
  if (field === "infra") {
    return (
      <svg {...props}>
        <g fill={SURFACE} stroke={INK} strokeWidth="1.5">
          <rect x="16" y="14" width="88" height="18" />
          <rect x="16" y="38" width="88" height="18" />
          <rect x="16" y="62" width="88" height="18" />
        </g>
        <g stroke={INK} strokeWidth="1.5" opacity="0.4">
          <path d="M80 19 V27 M86 19 V27 M92 19 V27 M98 19 V27" />
          <path d="M80 43 V51 M86 43 V51 M92 43 V51 M98 43 V51" />
          <path d="M80 67 V75 M86 67 V75 M92 67 V75 M98 67 V75" />
        </g>
        <circle cx="27" cy="23" r="2.5" fill={INK} opacity="0.4" />
        <circle cx="27" cy="47" r="2.5" fill={SIGNAL} />
        <circle cx="27" cy="71" r="2.5" fill={INK} opacity="0.4" />
      </svg>
    );
  }
  if (field === "security") {
    return (
      <svg {...props}>
        <path
          d="M60 10 L94 22 V48 C94 68 80 80 60 88 C40 80 26 68 26 48 V22 Z"
          fill={SURFACE}
          stroke={INK}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M44 34 H76" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
        <path d="M44 46 H70" stroke={SIGNAL} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M44 58 H72" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <g stroke={INK} strokeWidth="1.5" opacity="0.35">
        <path d="M22 24 L60 36 M22 48 L60 36 M22 72 L60 36 M22 24 L60 60 M22 48 L60 60 M22 72 L60 60 M60 36 L98 48 M60 60 L98 48" />
      </g>
      <g fill={SURFACE} stroke={INK} strokeWidth="1.5">
        <circle cx="22" cy="24" r="5.5" />
        <circle cx="22" cy="48" r="5.5" />
        <circle cx="22" cy="72" r="5.5" />
        <circle cx="60" cy="36" r="5.5" />
        <circle cx="60" cy="60" r="5.5" />
      </g>
      <circle cx="98" cy="48" r="6.5" fill={SIGNAL} />
    </svg>
  );
}

/** 첫 화면 그림: 인프라 · 보안 두 층 위에 AI 층이 켜진다 (680×540) */
export function LayersIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 680 540"
      role="img"
      aria-label="인프라, 보안, AI 세 층이 쌓인 그림. 맨 위 AI 층에서 신호가 켜진다"
      className={`block h-auto w-full text-ink ${className}`}
    >
      {/* 01 인프라: 서버 격자 */}
      <path d="M140 390 L140 404 L380 524 L620 404 L620 390 L380 510 Z" fill={LINE} />
      <path
        d="M140 390 L380 270 L620 390 L380 510 Z"
        fill={SUNKEN}
        stroke={INK}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <g fill={INK} opacity="0.4">
        {[
          [322, 443],
          [366, 421],
          [409, 400],
          [452, 378],
          [495, 356],
          [356, 460],
          [399, 438],
          [442, 416],
          [486, 395],
          [529, 373],
          [390, 476],
          [433, 455],
          [476, 433],
          [519, 412],
          [562, 390],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />
        ))}
      </g>
      {/* 02 보안: 로그 줄, 하나가 잡힌다 */}
      <path d="M140 260 L140 274 L380 394 L620 274 L620 260 L380 380 Z" fill={LINE} />
      <path
        d="M140 260 L380 140 L620 260 L380 380 Z"
        fill={SURFACE}
        stroke={INK}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <g strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M303 303 L409 250" stroke={INK} opacity="0.35" />
        <path d="M332 318 L476 246" stroke={INK} opacity="0.35" />
        <path d="M361 332 L447 289" stroke={SIGNAL} />
        <path d="M390 346 L543 270" stroke={INK} opacity="0.35" />
      </g>
      {/* 03 AI: 루프 위에서 신호가 켜진다 */}
      <path d="M140 130 L140 144 L380 264 L620 144 L620 130 L380 250 Z" fill={LINE} />
      <path
        d="M140 130 L380 10 L620 130 L380 250 Z"
        fill={SURFACE}
        stroke={INK}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <ellipse cx="380" cy="130" rx="110" ry="55" fill="none" stroke={INK} strokeWidth="1.5" />
      <path d="M484 117 L493 131 L478 134 Z" fill={INK} />
      <path d="M276 143 L267 129 L282 126 Z" fill={INK} />
      <rect x="260" y="120" width="20" height="20" fill={SURFACE} stroke={INK} strokeWidth="1.5" />
      <rect x="480" y="120" width="20" height="20" fill={SURFACE} stroke={INK} strokeWidth="1.5" />
      <path d="M380 122 V66" stroke={SIGNAL} strokeWidth="3" strokeLinecap="round" />
      <circle cx="380" cy="60" r="6" fill="var(--bg)" stroke={SIGNAL} strokeWidth="3" />
      <circle cx="380" cy="130" r="9" fill={SIGNAL} stroke={SURFACE} strokeWidth="2.5" />
      {/* 층 이름 */}
      <g stroke="var(--ink-2)" strokeWidth="1" strokeDasharray="2 4">
        <path d="M66 130 H138" />
        <path d="M110 260 H138" />
        <path d="M88 390 H138" />
      </g>
      <g className="font-mono text-[11px] tracking-[0.08em]">
        <text x="0" y="134" fill={SIGNAL}>
          03 · AI
        </text>
        <text x="0" y="264" fill="var(--ink-2)">
          02 · SECURITY
        </text>
        <text x="0" y="394" fill="var(--ink-2)">
          01 · INFRA
        </text>
      </g>
    </svg>
  );
}

/** 강의 표지 96×96: 남색 바탕(라이트 · 다크 공통) 에 번호와 분야 무늬 */
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
      <svg viewBox="0 0 76 40" className="h-10 w-[76px]">
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
