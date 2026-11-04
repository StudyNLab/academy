import type { Metadata } from "next";
import Link from "next/link";
import { MonoLabel, StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { timeAgo } from "@/components/user-text";
import { getDb } from "@/server/db";
import { myQuestions, questionUrl } from "@/server/qna";
import { requireViewer } from "@/server/session";

export const metadata: Metadata = { title: "내 질문" };

// 내가 남긴 강의 질문 (모든 강의). 누르면 학습 화면의 Q&A 로 연다
export default async function MyQuestionsPage() {
  const viewer = await requireViewer("/my/questions");
  const rows = await myQuestions(getDb(), viewer.userId);
  return (
    <>
      <PageTitle label="Questions" title="내 질문">
        강의 학습 화면의 Q&amp;A 에서 남긴 질문입니다.
      </PageTitle>
      {rows.length === 0 ? (
        <p className="m-0 border-t border-line-strong pt-6 text-ink-2">
          아직 남긴 질문이 없습니다. 학습 화면 위의 Q&amp;A 를 눌러 질문할 수 있습니다.{" "}
          <Link href="/learn">내 강의실 →</Link>
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
          {rows.map((q) => (
            <li key={q.id} className="border-b border-line">
              <Link
                href={questionUrl(q.courseSlug, q.chapterKey, q.id)}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 text-ink no-underline"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <MonoLabel className="text-[11px] text-ink-2">{q.courseTitle}</MonoLabel>
                  <span className="text-[16px] font-semibold">
                    {q.title}
                    {q.isSecret ? (
                      <span className="ml-2 text-[13px] font-normal text-ink-2">비밀글</span>
                    ) : null}
                  </span>
                  <span className="text-[13px] text-ink-2">
                    답변 {q.answerCount} · {timeAgo(q.createdAt)}
                    {q.hidden ? " · 운영자가 숨김" : ""}
                  </span>
                </span>
                <StatusDot tone={q.status === "resolved" ? "done" : "warn"}>
                  {q.status === "resolved" ? "해결됨" : "미해결"}
                </StatusDot>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
