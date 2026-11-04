// P-01 홈의 그림 구역들 (캔버스 "AIONIT 디자인" › P-01 홈 · 연출 시안). 움직임 class(aio-*) 는 packages/ui/src/motion.css
import Image from "next/image";
import Link from "next/link";
import { MonoLabel } from "@aionit/ui";

const wrap = "mx-auto max-w-[1296px] px-5 md:px-14";

/** 교재 지면에서: 실제 교재 그림 두 장과 코드 한 토막 */
export function TextbookStrip() {
  return (
    <section className="border-y border-line bg-surface py-16 md:py-22">
      <div className={`${wrap} aio-reveal flex flex-col gap-9`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3.5">
            <MonoLabel className="text-xs text-signal">From the textbook</MonoLabel>
            <h2 className="m-0 text-[32px] font-semibold tracking-[-0.035em] md:text-[40px]">
              교재 지면에서
            </h2>
          </div>
          <p className="m-0 max-w-[460px] text-[15px] leading-[1.75] text-ink-2">
            그림 · 코드 · 실행 결과가 한 흐름으로 이어지는 교재. 영상에서 본 것을 글로 다시 확인합니다.
          </p>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-3">
          <Figure
            label="Chapter 02 · 2.1"
            tag="그림 2-1"
            src="/home/fig2-01.png"
            alt="그림 2-1. LLM API 호출의 층"
            width={2100}
            height={1068}
          >
            <b className="font-semibold text-ink">그림 2-1.</b> LLM API 호출의 층
          </Figure>
          <figure className="m-0 flex flex-col gap-3 border border-ink bg-code-bg p-6 text-code-ink">
            <div className="flex justify-between font-mono text-[11px] tracking-[0.08em] text-[#A9B1BE] uppercase">
              <span>Chapter 05 · Agent 루프</span>
              <span>Python</span>
            </div>
            <pre className="m-0 overflow-x-auto font-mono text-[13px] leading-[1.8]">
              <code>
                <span className="text-[#9DB7E8]">while</span> <span className="text-[#E07A5B]">True</span>:
                {"\n"}
                {"    "}reply = call_model(messages){"\n"}
                {"    "}
                <span className="text-[#9DB7E8]">if</span> reply.stop:{"\n"}
                {"        "}
                <span className="text-[#9DB7E8]">break</span>
                {"\n"}
                {"    "}result = run_tool(reply.tool){"\n"}
                {"    "}messages.append(result)
              </code>
            </pre>
            <figcaption className="text-[13px] text-[#A9B1BE]">
              <b className="font-semibold text-code-ink">코드.</b> 교재의 코드는 그대로 복사해 실행합니다
            </figcaption>
          </figure>
          <Figure
            label="Chapter 05 · 5.1"
            tag="그림 5-1"
            src="/home/fig5-01.png"
            alt="그림 5-1. 호출 두 번으로 정해 둔 코드와 실제로 필요했던 순서"
            width={2060}
            height={1113}
          >
            <b className="font-semibold text-ink">그림 5-1.</b> 정해 둔 호출 두 번과 실제로 필요했던 순서
          </Figure>
        </div>
      </div>
    </section>
  );
}

function Figure({
  label,
  tag,
  src,
  alt,
  width,
  height,
  children,
}: {
  label: string;
  tag: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3 border border-line bg-bg p-6 shadow-[0_1px_0_var(--line)]">
      <div className="flex justify-between font-mono text-[11px] tracking-[0.08em] text-ink-2 uppercase">
        <span>{label}</span>
        <span>{tag}</span>
      </div>
      {/* 교재 그림은 흰 바탕 PNG 라 다크 모드에서도 밝은 지면 위에 둔다 (디자인시스템 2.1) */}
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="block h-auto w-full border border-[#ECEAE4] bg-white"
      />
      <figcaption className="text-[13px] text-ink-2">{children}</figcaption>
    </figure>
  );
}

/** 보고, 읽고, 직접 확인한다: 학습 화면 실물 모형 */
export function HowItWorks() {
  const steps = [
    ["영상으로 개념을 잡고", "대부분은 누구나 무료로 볼 수 있습니다."],
    ["교재로 정리하고", "어느 기기에서든 읽던 곳부터 이어집니다."],
    ["실습으로 확인합니다", "평가 기준을 보고 스스로 체크합니다."],
  ];
  return (
    <section className="border-y border-line bg-surface">
      <div className={`${wrap} aio-reveal flex flex-wrap items-center gap-x-16 gap-y-12 py-16 md:py-24`}>
        <div className="flex min-w-0 flex-[5_1_380px] flex-col gap-5">
          <MonoLabel className="text-xs text-signal">How it works</MonoLabel>
          <h2 className="m-0 text-[32px] leading-[1.2] font-semibold tracking-[-0.035em] md:text-[40px]">
            보고, 읽고,
            <br />
            직접 확인한다.
          </h2>
          <p className="m-0 text-[16px] leading-[1.8] text-ink-2">
            한 챕터는 한 화면입니다. 맨 위 영상에서 시작해 교재로 이어지고, 실습마다 평가 기준이 붙어
            있습니다.
          </p>
          <ol className="m-0 mt-2 list-none border-t border-line-strong p-0">
            {steps.map(([title, desc], i) => (
              <li key={title} className="grid grid-cols-[56px_1fr] gap-4 border-b border-line py-4.5">
                <MonoLabel className="text-[13px] text-signal">{String(i + 1).padStart(2, "0")}</MonoLabel>
                <div className="flex flex-col gap-1">
                  <strong className="text-[17px] font-semibold">{title}</strong>
                  <span className="text-[14px] leading-[1.7] text-ink-2">{desc}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <LearnPreview />
      </div>
    </section>
  );
}

function LearnPreview() {
  // done · live(코드 실행 결과가 나온 뒤 체크됨) · todo
  const checks: ["done" | "live" | "todo", string][] = [
    ["done", "API 키를 환경 변수로 두고 코드에 적지 않았다"],
    ["live", "요청을 보내 상태 코드 200 을 받았다"],
    ["todo", "오류 응답(401 · 429)을 구분해 메시지를 냈다"],
  ];
  return (
    <figure className="m-0 flex min-w-0 flex-[6_1_480px] flex-col gap-2.5">
      <div className="border border-line bg-bg shadow-[0_1px_0_var(--line),0_28px_48px_-36px_rgb(18_26_38/0.45)]">
        <div className="flex items-center justify-between border-b border-line bg-surface px-4.5 py-3 font-mono text-[11px] tracking-[0.08em] text-ink-2 uppercase">
          <span>Chapter 02 · 2.1 LLM API와 HTTP</span>
          <span>진도 3 / 6</span>
        </div>
        <div className="relative flex aspect-video items-center justify-center bg-[#18304F]">
          <svg viewBox="0 0 64 64" aria-hidden="true" className="h-16 w-16">
            <circle cx="32" cy="32" r="30" fill="none" stroke="#F6F5F1" strokeWidth="1.5" />
            <path d="M26 20 L44 32 L26 44 Z" fill="#F6F5F1" />
          </svg>
          <span className="absolute bottom-3 left-4 font-mono text-[11px] tracking-[0.08em] text-[#C9D2E0] uppercase">
            12:40 · 무료 공개
          </span>
          <span className="absolute right-0 bottom-0 left-0 h-[3px] bg-[#2C4870]">
            <span className="block h-full w-[38%] bg-[#F0A88C]" />
          </span>
        </div>
        <div className="flex flex-col gap-2.5 px-5.5 pt-5.5 pb-1.5">
          <strong className="text-[19px] font-semibold tracking-[-0.02em]">
            2.1 요청은 세 부분으로 이루어진다
          </strong>
          <p className="m-0 text-[14px] leading-[1.8] text-ink">
            LLM API 요청은 엔드포인트, 헤더, 본문으로 나뉜다. 어느 모델을 쓰든 이 세 부분은 같다.
          </p>
          <CodeRun />
        </div>
        <div className="mx-5.5 mt-4 mb-5 border border-line-strong bg-surface px-4 pt-3.5 pb-1.5">
          <div className="flex items-baseline justify-between pb-2">
            <strong className="text-[14px] font-semibold">실습 2-1 · 평가 기준</strong>
            <span className="grid font-mono text-[11px] tracking-[0.08em] text-done">
              <span className="aio-chk-off [grid-area:1/1]">1 / 3 확인</span>
              <span className="aio-chk-on [grid-area:1/1]">2 / 3 확인</span>
            </span>
          </div>
          {checks.map(([state, text]) => (
            <div
              key={text}
              className="grid grid-cols-[18px_1fr] items-center gap-3 border-t border-line py-2 text-[14px]"
            >
              <span aria-hidden="true" className="grid h-4 w-4">
                <span className="border-[1.5px] border-ink [grid-area:1/1]" />
                {state === "todo" ? null : (
                  <span
                    className={`flex items-center justify-center border-[1.5px] border-done bg-done [grid-area:1/1] ${state === "live" ? "aio-chk-on" : ""}`}
                  >
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                      <path d="M2 6.5 L5 9 L10 3" fill="none" stroke="#F6F5F1" strokeWidth="1.8" />
                    </svg>
                  </span>
                )}
              </span>
              <span className={state === "todo" ? "text-ink-2" : ""}>{text}</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="self-end font-mono text-[11px] tracking-[0.08em] text-ink-2 uppercase">
        학습 화면 — 영상 · 교재 · 실습 기준이 한 화면에
      </figcaption>
    </figure>
  );
}

/** 학습 모형 안의 실습 코드: 한 줄씩 쳐지고 실행 결과가 나온다 (10초 반복) */
function CodeRun() {
  return (
    <div className="bg-code-bg font-mono text-[12.5px] leading-[1.9] text-code-ink">
      <div className="flex justify-between border-b border-[#2A3444] px-3.5 py-2 text-[11px] tracking-[0.08em] text-[#9AA3B2] uppercase">
        <span>python · first_request.py</span>
        <span>▶ 실행</span>
      </div>
      <div aria-hidden="true" className="overflow-x-auto px-3.5 pt-3 pb-1">
        <span className="aio-code-line aio-c0">
          <span className="text-[#9DB7E8]">import</span> os, requests
        </span>
        <span className="aio-code-line aio-c1">
          KEY = os.environ[<span className="text-[#E3B58C]">&quot;API_KEY&quot;</span>]
        </span>
        <span className="aio-code-line aio-c2">r = requests.post(URL, headers=h, json=body)</span>
        <span className="aio-code-line aio-c3">
          <span className="text-[#9DB7E8]">print</span>(r.status_code, r.json()[
          <span className="text-[#E3B58C]">&quot;text&quot;</span>])
        </span>
      </div>
      <div
        aria-hidden="true"
        className="aio-cout border-t border-[#2A3444] px-3.5 pt-1.5 pb-2.5 text-[#6FBF8E]"
      >
        200 <span className="text-code-ink">안녕하세요. 무엇을 도와드릴까요?</span>
      </div>
    </div>
  );
}

/** 구독 안내. 요금은 M6 에서 넣는다 — 그 전까지는 설명과 타일 벽만. */
export function SubscribeBand() {
  // 0 포함 · 1 프리미엄(구독자 할인) · 2 준비 중
  const tiles = [
    0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 2, 0, 0, 0, 1, 0, 0, 0,
  ];
  const tile = ["bg-[#F6F5F1]", "border-[1.5px] border-[#F0A88C]", "border border-[#4A6285]"];
  return (
    <section className="relative overflow-hidden bg-[#132741] text-[#F6F5F1]">
      {/* 질감: 옅은 격자(서버 랙의 칸) + 강조색 등고선 몇 줄 */}
      <svg
        viewBox="0 0 1440 560"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <g stroke="#F6F5F1" strokeWidth="1" opacity="0.06">
          <path d="M0 56H1440M0 112H1440M0 168H1440M0 224H1440M0 280H1440M0 336H1440M0 392H1440M0 448H1440M0 504H1440" />
          <path d="M96 0V560M192 0V560M288 0V560M384 0V560M480 0V560M576 0V560M672 0V560M768 0V560M864 0V560M960 0V560M1056 0V560M1152 0V560M1248 0V560M1344 0V560" />
        </g>
        <g fill="none" stroke="#F0A88C" strokeWidth="1.2" opacity="0.2">
          <path d="M760 560 C860 420 1060 360 1440 380" />
          <path d="M700 560 C820 380 1040 300 1440 310" />
          <path d="M640 560 C780 340 1020 240 1440 240" />
          <path d="M580 560 C740 300 1000 180 1440 170" />
        </g>
      </svg>
      <div
        className={`${wrap} aio-reveal relative flex flex-wrap items-center gap-x-16 gap-y-12 py-16 md:py-22`}
      >
        <div className="flex min-w-0 flex-[6_1_440px] flex-col gap-5">
          <MonoLabel className="text-xs text-[#F0A88C]">Subscription</MonoLabel>
          <h2 className="m-0 text-[34px] leading-[1.18] font-semibold tracking-[-0.035em] md:text-[44px]">
            구독 하나로
            <br />
            구독 포함 강의 전부.
          </h2>
          <p className="m-0 max-w-[480px] text-[16px] leading-[1.8] text-[#C9D2E0]">
            프리미엄 강의는 구독자 할인가로. 해지는 마이페이지에서 클릭 두 번, 진도는 그대로 남습니다.
          </p>
          <Link
            href="/subscribe"
            className="mt-2 inline-flex min-h-[54px] items-center self-start rounded-ui bg-[#F6F5F1] px-7 text-[16px] font-semibold text-[#18304F] no-underline transition-colors duration-150 hover:bg-[#F0A88C] hover:text-[#121A26]"
          >
            구독 알아보기
          </Link>
        </div>
        <figure className="m-0 flex min-w-0 flex-[5_1_320px] flex-col items-start gap-4.5">
          <div aria-hidden="true" className="grid w-full max-w-[344px] grid-cols-8 gap-2">
            {tiles.map((t, i) => (
              <span key={i} className={`aspect-square ${tile[t]}`} />
            ))}
          </div>
          <figcaption className="flex flex-wrap gap-x-5.5 gap-y-2 text-[13px] text-[#C9D2E0]">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 bg-[#F6F5F1]" />
              구독 포함
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 border-[1.5px] border-[#F0A88C]" />
              프리미엄 · 구독자 할인
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 border border-[#4A6285]" />
              준비 중
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/** 강사 모집: 교재 → 검수 → 공개 → 정산 */
export function InstructorFlow() {
  const steps = [
    ["교재 패키지", "본문 · 그림 · 영상 자리"],
    ["검수", "운영자 확인 · 의견"],
    ["공개", "강의 목록 · 무료 미리보기"],
    ["월 정산", "명세 10일 · 지급 15일"],
  ];
  return (
    <section
      className={`${wrap} aio-reveal flex flex-wrap items-center justify-between gap-x-12 gap-y-9 border-b border-line py-16 md:py-22`}
    >
      <div className="flex max-w-[440px] flex-col gap-3">
        <MonoLabel className="text-xs text-signal">For instructors</MonoLabel>
        <h2 className="m-0 text-[28px] font-semibold tracking-[-0.03em] md:text-[32px]">
          현업의 지식을 강의로 만드세요.
        </h2>
        <p className="m-0 text-[16px] leading-[1.8] text-ink-2">
          교재 패키지를 올리면 검수 · 공개 · 월 정산까지 AIONIT가 함께합니다. 강사 모집 안내는 곧 엽니다.
        </p>
      </div>
      {/* 좁은 화면에서는 세로로 쌓고 화살표를 아래로 돌린다 */}
      <ol
        aria-label="강의가 공개되기까지"
        className="m-0 flex w-full list-none flex-col items-stretch p-0 md:w-auto md:flex-row md:flex-wrap md:items-center"
      >
        {steps.map(([title, desc], i) => (
          <li key={title} className="flex flex-col items-stretch md:flex-row md:items-center">
            {i > 0 ? (
              <svg
                viewBox="0 0 40 16"
                aria-hidden="true"
                className="h-4 w-10 shrink-0 self-center text-ink max-md:my-1 max-md:rotate-90"
              >
                <path d="M0 8 H32" stroke="currentColor" strokeWidth="1.5" />
                <path d="M28 2 L36 8 L28 14" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            ) : null}
            <span
              className={`flex flex-col gap-1.5 border px-4.5 py-4 md:min-w-[150px] ${
                i === steps.length - 1
                  ? "border-[#18304F] bg-[#18304F] text-[#F6F5F1]"
                  : "border-line bg-surface"
              }`}
            >
              <MonoLabel className={i === steps.length - 1 ? "text-[#F0A88C]" : "text-signal"}>
                {String(i + 1).padStart(2, "0")}
              </MonoLabel>
              <strong className="text-[15px] font-semibold">{title}</strong>
              <span className={`text-[12px] ${i === steps.length - 1 ? "text-[#C9D2E0]" : "text-ink-2"}`}>
                {desc}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
