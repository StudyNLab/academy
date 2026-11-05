import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { instructorPage } from "@/server/instructor-page";
import type { InstructorQnaFilter } from "@/server/instructors";
import { instructorQuestions } from "@/server/instructors";
import { questionUrl } from "@/server/qna";
import { kstDay } from "../labels";

export const metadata: Metadata = { title: "Q&A 답변" };

const FILTERS: { value: InstructorQnaFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "unanswered", label: "미답변" },
  { value: "open", label: "미해결" },
];

// I-06 Q&A 답변: 내 강의의 질문 (미답변 먼저, 오래 기다린 순). 누르면 학습 화면의 Q&A 패널에서 그 질문이 열리고
// 거기서 답변 · 위에 고정(자주 나오는 질문)을 한다. 질문자는 닉네임만 보인다
export default async function InstructorQna({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { db, instructor } = await instructorPage("/instructor/qna");
  const { f } = await searchParams;
  const filter = FILTERS.find((x) => x.value === f)?.value ?? "all";
  const questions = await instructorQuestions(db, instructor, filter);
  const waiting = questions.filter((q) => q.unanswered && !q.hidden).length;

  return (
    <>
      <PageTitle label="Q&A" title="Q&A 답변">
        <p className="m-0">
          강사 · 운영자 답변이 아직 없는 질문이 먼저, 오래 기다린 순으로 보입니다. 누르면 학습 화면에서 그
          질문이 열립니다. 자주 나오는 질문은 거기서 [위에 고정] 해 두세요.
        </p>
      </PageTitle>
      <nav aria-label="질문 고르기" className="mb-4 flex flex-wrap gap-x-5 border-b border-line">
        {FILTERS.map((x) => (
          <Link
            key={x.value}
            href={x.value === "all" ? "/instructor/qna" : `/instructor/qna?f=${x.value}`}
            aria-current={x.value === filter ? "page" : undefined}
            className={`inline-flex min-h-11 items-center no-underline ${x.value === filter ? "font-semibold text-ink" : "text-ink-2"}`}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      {filter !== "open" ? (
        <p className="mt-0 text-[14px] text-ink-2">답변을 기다리는 질문 {waiting}개</p>
      ) : null}
      {questions.length === 0 ? <p className="text-ink-2">질문이 없습니다.</p> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {questions.map((q) => (
          <li key={q.id} className="border-b border-line py-3">
            <Link href={questionUrl(q.courseSlug, q.chapterKey, q.id)} className="text-[15px]">
              {q.title || "(지운 질문)"}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
              {q.unanswered && !q.hidden ? (
                <StatusDot tone="warn">미답변</StatusDot>
              ) : q.status === "resolved" ? (
                <StatusDot tone="done">해결됨</StatusDot>
              ) : (
                <StatusDot tone="muted">답변함 · 미해결</StatusDot>
              )}
              {q.isSecret ? <span className="font-mono text-[12px]">비밀글</span> : null}
              {q.pinned ? <span className="font-mono text-[12px]">고정</span> : null}
              {q.hidden ? <span className="font-mono text-[12px] text-danger">숨김</span> : null}
              <span>
                {q.courseTitle} · {q.chapterKey} · 답변 {q.answerCount} · {kstDay.format(q.createdAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
