// 워드마크 "AIonIT": 굵은 AI · IT 사이에 조금 작고 굵은 빨간 on (로고 전용 색 --logo-on). 글자만, 심볼 없음 (docs/디자인시스템.md 3장)
// 서체 Manrope 는 로고 전용이다. 본문에는 쓰지 않는다.

const base = "font-logo font-extrabold tracking-[-0.045em]";
const on = "mx-[0.03em] text-[0.82em] font-bold tracking-[-0.02em] text-logo-on";

/** 가로 워드마크. `korean` 이면 가는 세로선 뒤에 "아이오닛" 을 붙인다 (머리글에서는 떼고 쓴다). */
export function Wordmark({ className = "", korean = false }: { className?: string; korean?: boolean }) {
  return (
    <span
      role="img"
      aria-label="AIONIT 아이오닛"
      className={`inline-flex items-baseline ${base} ${className}`}
    >
      <span aria-hidden="true">AI</span>
      <span aria-hidden="true" className={on}>
        on
      </span>
      <span aria-hidden="true">IT</span>
      {korean ? (
        <>
          <i
            aria-hidden="true"
            className="mr-[0.24em] ml-[0.28em] inline-block h-[0.72em] w-px self-center bg-current opacity-35"
          />
          <span
            aria-hidden="true"
            className="font-sans text-[0.3em] font-medium tracking-[0.24em] text-ink-2 [text-indent:0.24em]"
          >
            아이오닛
          </span>
        </>
      ) : null}
    </span>
  );
}

/** 세로 한 벌: 워드마크 아래 "아이오닛". 첫 화면 · 영상 끝 화면처럼 여백이 있는 자리용. */
export function WordmarkStacked({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="AIONIT 아이오닛"
      className={`inline-flex flex-col items-start gap-[0.14em] ${className}`}
    >
      <span aria-hidden="true" className={`inline-flex items-baseline leading-none ${base}`}>
        AI<span className={on}>on</span>IT
      </span>
      <span
        aria-hidden="true"
        className="font-sans text-[0.2em] leading-none tracking-[0.42em] text-ink-2 [text-indent:0.06em]"
      >
        아이오닛
      </span>
    </span>
  );
}

/**
 * 정사각 마크: 남색 바탕에 AI / on / IT 세 줄. 앱 아이콘 · 프로필 · 파비콘.
 * 24px 아래에서는 on 을 빼고 AI 만 남긴다. 파비콘 파일은 scripts/make-icons.mjs 로 만든다.
 */
export function SquareMark({ size = 48, className = "" }: { size?: number; className?: string }) {
  const small = size < 24;
  return (
    <span
      role="img"
      aria-label="AIONIT"
      className={`inline-flex flex-col items-center justify-center bg-[#18304F] text-[#F6F5F1] ${base} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: small ? size * 0.5 : size * 0.35,
        lineHeight: 0.86,
        letterSpacing: small ? "-0.08em" : "-0.05em",
      }}
    >
      <span aria-hidden="true">AI</span>
      {small ? null : (
        <>
          <span aria-hidden="true" className="text-[0.82em] font-bold tracking-[-0.02em] text-[#FF6B5E]">
            on
          </span>
          <span aria-hidden="true">IT</span>
        </>
      )}
    </span>
  );
}
