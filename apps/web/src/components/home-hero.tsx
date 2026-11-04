// P-01 홈 첫 화면 (캔버스 "AIONIT 디자인" › P-01 홈 · 연출 시안).
// 서버실 사진(남색 입힘) 위에, 실습 서버 터미널이 인프라 → 보안 → AI 순서로 14초마다 다시 돈다.
// 움직임 class 는 packages/ui/src/motion.css. 사진: Taylor Vick, Unsplash 라이선스 (docs/디자인시스템.md 3.4).
import Image from "next/image";
import Link from "next/link";
import { MonoLabel } from "@aionit/ui";

const wrap = "mx-auto max-w-[1296px] px-5 md:px-14";

const steps = [
  ["01", "인프라", "aio-s1"],
  ["02", "보안", "aio-s2"],
  ["03", "AI", "aio-s3"],
] as const;

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-[#0E1B2D] text-[#F6F5F1]">
      <Image
        src="/home/server-room.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="aio-zoom object-cover contrast-110"
      />
      {/* 흑백 사진에 남색을 곱하고, 글이 있는 왼쪽을 더 어둡게 */}
      <div aria-hidden="true" className="absolute inset-0 bg-[#132741] opacity-90 mix-blend-multiply" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgb(14_27_45/0.94)_0%,rgb(14_27_45/0.72)_48%,rgb(14_27_45/0.4)_100%)]"
      />

      <div className={`${wrap} relative flex flex-wrap items-center gap-x-16 gap-y-12 py-20 md:py-28`}>
        <div className="flex min-w-0 flex-[6_1_440px] flex-col gap-7">
          <MonoLabel className="aio-up text-xs text-[#F0A88C]">AI on IT · 아이오닛</MonoLabel>
          <h1 className="m-0 text-[44px] leading-[1.1] font-semibold tracking-[-0.04em] md:text-[68px]">
            <span className="aio-up block [animation-delay:0.1s]">IT의 바탕 위에</span>
            <span className="aio-up block [animation-delay:0.5s]">AI를 켜다.</span>
          </h1>
          <p className="aio-up m-0 max-w-[500px] text-[19px] leading-[1.75] font-light text-[#C9D2E0] [animation-delay:0.8s]">
            서버를 다루고, 로그에서 공격을 찾고, AI 로 대응하는 법까지. 현업 강사의 영상과 교재, 그리고 실제
            실습 서버에서.
          </p>
          <div className="aio-up flex flex-wrap items-center gap-x-6 gap-y-4 [animation-delay:1s]">
            <Link
              href="/courses"
              className="inline-flex min-h-[52px] items-center rounded-ui bg-[#F6F5F1] px-7 text-base font-semibold text-[#18304F] no-underline transition-colors duration-150 hover:bg-[#F0A88C] hover:text-[#121A26]"
            >
              강의 보기
            </Link>
            <Link
              href="/subscribe"
              className="group inline-flex min-h-11 items-center gap-2.5 border-b border-[#F6F5F1] font-semibold text-[#F6F5F1] no-underline hover:border-[#F0A88C] hover:text-[#F0A88C]"
            >
              구독으로 전부 듣기{" "}
              <span
                aria-hidden="true"
                className="transition-transform duration-150 group-hover:translate-x-1"
              >
                →
              </span>
            </Link>
          </div>
        </div>

        <figure className="aio-up m-0 flex min-w-0 flex-[6_1_480px] flex-col gap-3 [animation-delay:0.6s]">
          <LabTerminal />
          <figcaption className="self-end font-mono text-[11px] tracking-[0.08em] text-[#9AA3B2] uppercase">
            실습 서버에서 — 인프라를 다루고, 공격을 찾고, AI 로 대응한다
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function LabTerminal() {
  return (
    <div
      role="img"
      aria-label="실습 서버 터미널. 1단계 인프라: 서버에 접속해 nginx 가 동작하는지 확인. 2단계 보안: 로그에서 한 IP 의 반복 로그인 시도 1284건을 찾음. 3단계 AI: 에이전트가 공격을 요약하고 차단 방법을 제안"
      className="border border-[rgb(246_245_241/0.16)] bg-[rgb(9_16_27/0.86)] font-mono text-[12px] leading-[1.95] text-[#E8E6E0] shadow-[0_40px_80px_-40px_rgb(0_0_0/0.7)] md:text-[13px]"
    >
      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-3 border-b border-[rgb(246_245_241/0.12)] px-4.5"
      >
        <span className="flex gap-5 text-[12px]">
          {steps.map(([no, label, cls]) => (
            <span key={no} className={`aio-term-tab inline-flex gap-1.5 pt-2.5 pb-2 ${cls}`}>
              <span className="text-[#F0A88C]">{no}</span> {label}
            </span>
          ))}
        </span>
        <span className="hidden text-[11px] tracking-[0.06em] text-[#7D8899] sm:inline">
          LAB-01 · 실습 서버
        </span>
      </div>
      <div aria-hidden="true" className="min-h-[250px] overflow-x-auto px-5 pt-4.5 pb-5.5">
        <span className="aio-term-line aio-t0">
          <span className="text-[#F0A88C]">$</span> ssh student@lab-01
        </span>
        <span className="aio-term-line aio-t1">
          <span className="text-[#F0A88C]">$</span> systemctl status nginx
        </span>
        <span className="aio-term-line aio-t2">
          <span className="text-[#6FBF8E]">●</span> nginx.service —{" "}
          <span className="text-[#6FBF8E]">active (running)</span>
        </span>
        <span className="block h-2.5" />
        <span className="aio-term-line aio-t3">
          <span className="text-[#F0A88C]">$</span> grep &quot;Failed password&quot; auth.log | wc -l
        </span>
        <span className="aio-term-line aio-t4">
          <span className="text-[#F0A88C]">1284</span>
          {"  "}
          <span className="text-[#9AA3B2]"># 203.0.113.7 에서 반복 로그인 시도</span>
        </span>
        <span className="block h-2.5" />
        <span className="aio-term-line aio-t5">
          <span className="text-[#F0A88C]">$</span> agent &quot;auth.log 요약하고 대응을 제안해 줘&quot;
        </span>
        <span className="aio-term-line aio-t6">
          <span className="text-[#9DB7E8]">›</span> SSH 무차별 대입 1,284회 · 출발지 203.0.113.7
        </span>
        <span className="aio-term-line aio-t7">
          <span className="text-[#9DB7E8]">›</span> 제안: fail2ban 으로 차단, 비밀번호 로그인 끄기
        </span>
      </div>
    </div>
  );
}
