import Link from "next/link";
import { buttonClass, MonoLabel } from "@aionit/ui";
import { CourseList } from "@/components/course-list";
import { listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";

// P-01 홈: 첫 화면 · 분야 · 강의 목록 (M2). 구독 안내 요약은 M6 에서.
const fields = [
  {
    no: "01 · Infra",
    name: "인프라",
    desc: "리눅스 서버 운영, 로그 관리, 네트워크. 실제 서버에서 쓰는 명령과 설정 그대로.",
  },
  {
    no: "02 · Security",
    name: "보안",
    desc: "보안 관제, SIEM, 침해 대응. 로그에서 공격을 찾아내는 눈을 기른다.",
  },
  { no: "03 · AI", name: "AI", desc: "LLM API, AI Agent, 업무 자동화. 동작 원리부터 직접 만들어 본다." },
];

export default async function HomePage() {
  const courses = (await listCatalog(getDb())).slice(0, 6);
  return (
    <>
      <section className="mx-auto flex max-w-[1296px] flex-col gap-7 px-5 pt-20 pb-20 md:px-14 md:pt-26">
        <MonoLabel className="text-xs text-signal">AI on IT · 아이오닛</MonoLabel>
        <h1 className="m-0 text-[44px] leading-[1.1] font-semibold tracking-[-0.04em] md:text-[68px]">
          IT의 바탕 위에
          <br />
          AI를 켜다.
        </h1>
        <p className="m-0 max-w-[540px] text-[19px] leading-[1.75] font-light text-ink-2">
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
      </section>

      <section className="mx-auto max-w-[1296px] px-5 md:px-14">
        <div className="grid border-t border-line-strong md:grid-cols-3">
          {fields.map((f, i) => (
            <div
              key={f.name}
              className={`flex flex-col gap-3.5 py-7 md:pr-8 ${i > 0 ? "border-t border-line md:border-t-0 md:border-l md:pl-8" : ""}`}
            >
              <MonoLabel className="text-xs text-signal">{f.no}</MonoLabel>
              <h2 className="m-0 text-[26px] font-semibold tracking-[-0.025em]">{f.name}</h2>
              <p className="m-0 text-[15px] leading-[1.75] text-ink-2">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-[1296px] px-5 md:px-14">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">강의</h2>
          <Link href="/courses">전체 보기 →</Link>
        </div>
        <CourseList courses={courses} />
      </section>
    </>
  );
}
