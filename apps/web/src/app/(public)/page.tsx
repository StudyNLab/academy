import Link from "next/link";
import { buttonClass, FieldIcon, LayersIllustration, MonoLabel } from "@aionit/ui";
import type { FieldKey } from "@aionit/ui";
import { CourseList } from "@/components/course-list";
import { HowItWorks, InstructorFlow, SubscribeBand, TextbookStrip } from "@/components/home";
import { listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";

// P-01 홈 (캔버스 "AIONIT 디자인" › P-01 홈 · 그림 보강 시안). 구독 요금은 M6 에서.
const fields: { key: FieldKey; no: string; name: string; desc: string }[] = [
  {
    key: "infra",
    no: "01 · Infra",
    name: "인프라",
    desc: "리눅스 서버 운영, 로그 관리, 네트워크. 실제 서버에서 쓰는 명령과 설정 그대로.",
  },
  {
    key: "security",
    no: "02 · Security",
    name: "보안",
    desc: "보안 관제, SIEM, 침해 대응. 로그에서 공격을 찾아내는 눈을 기른다.",
  },
  {
    key: "ai",
    no: "03 · AI",
    name: "AI",
    desc: "LLM API, AI Agent, 업무 자동화. 동작 원리부터 직접 만들어 본다.",
  },
];

const wrap = "mx-auto max-w-[1296px] px-5 md:px-14";

export default async function HomePage() {
  const courses = (await listCatalog(getDb())).slice(0, 6);
  return (
    <>
      <section
        className={`${wrap} flex flex-wrap items-center gap-x-16 gap-y-12 pt-16 pb-16 md:pt-24 md:pb-22`}
      >
        <div className="flex min-w-0 flex-[6_1_480px] flex-col gap-7">
          <MonoLabel className="text-xs text-signal">AI on IT · 아이오닛</MonoLabel>
          <h1 className="m-0 text-[44px] leading-[1.1] font-semibold tracking-[-0.04em] md:text-[68px]">
            IT의 바탕 위에
            <br />
            AI를 켜다.
          </h1>
          <p className="m-0 max-w-[520px] text-[19px] leading-[1.75] font-light text-ink-2">
            인프라 · 보안 · AI를 현업 강사에게. 영상으로 개념을 잡고, 다시 펼쳐 보는 교재로 정리하고, 실습
            기준으로 스스로 확인합니다.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href="/courses" className={buttonClass("primary", "lg")}>
              강의 보기
            </Link>
            <Link
              href="/subscribe"
              className="inline-flex min-h-11 items-center gap-2.5 border-b border-ink font-semibold text-ink no-underline hover:text-signal"
            >
              구독으로 전부 듣기 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <figure className="m-0 flex min-w-0 flex-[6_1_440px] flex-col gap-2.5">
          <LayersIllustration />
          <figcaption className="self-end font-mono text-[11px] tracking-[0.08em] text-ink-2 uppercase">
            인프라 · 보안이라는 바탕 위에, AI 층을 켠다
          </figcaption>
        </figure>
      </section>

      <section className={`${wrap} pb-16 md:pb-24`}>
        <div className="grid border-t border-line-strong md:grid-cols-3">
          {fields.map((f, i) => (
            <div
              key={f.key}
              className={`flex flex-col gap-3.5 py-8 md:pr-8 ${i > 0 ? "border-t border-line md:border-t-0 md:border-l md:pl-8" : ""}`}
            >
              <FieldIcon field={f.key} className="h-24 w-[120px]" />
              <MonoLabel className="text-xs text-signal">{f.no}</MonoLabel>
              <h2 className="m-0 text-[26px] font-semibold tracking-[-0.025em]">{f.name}</h2>
              <p className="m-0 text-[15px] leading-[1.75] text-ink-2">{f.desc}</p>
              <Link href={`/courses?field=${f.key}`} className="mt-1 text-[14px] font-semibold no-underline">
                {f.name} 강의 →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <TextbookStrip />

      <section className={`${wrap} flex flex-col gap-7 py-16 md:py-24`}>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="m-0 text-[32px] font-semibold tracking-[-0.035em] md:text-[40px]">강의</h2>
          <nav aria-label="분야" className="flex gap-6 text-[15px]">
            <Link
              href="/courses"
              className="border-b-2 border-ink pb-1.5 font-semibold text-ink no-underline"
            >
              전체
            </Link>
            {fields.map((f) => (
              <Link key={f.key} href={`/courses?field=${f.key}`} className="pb-1.5 text-ink-2 no-underline">
                {f.name}
              </Link>
            ))}
          </nav>
        </div>
        <CourseList courses={courses} />
        <Link
          href="/courses"
          className="inline-flex min-h-11 items-center gap-2.5 self-start border-b border-ink font-semibold text-ink no-underline hover:text-signal"
        >
          강의 전체 보기 <span aria-hidden="true">→</span>
        </Link>
      </section>

      <HowItWorks />
      <SubscribeBand />
      <InstructorFlow />
    </>
  );
}
