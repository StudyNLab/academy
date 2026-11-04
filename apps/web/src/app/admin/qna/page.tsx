import type { Metadata } from "next";
import Link from "next/link";
import { MonoLabel } from "@aionit/ui";
import { formatDayTime } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { UserText } from "@/components/user-text";
import { getDb } from "@/server/db";
import { hiddenPosts, questionUrl, reportedPosts, staleQuestions } from "@/server/qna";
import { requireStaff } from "@/server/session";
import { ModerateActions } from "./qna-actions";

export const metadata: Metadata = { title: "Q&A 관리" };

const ROLE = {
  asker: "질문",
  learner: "수강생 답변",
  instructor: "강사 답변",
  operator: "운영자 답변",
} as const;

type Post = NonNullable<Awaited<ReturnType<typeof reportedPosts>>[number]["post"]>;

function PostCard({ post, kind }: { post: Post; kind: "question" | "answer" }) {
  return (
    <div className="flex flex-col gap-2">
      <MonoLabel className="text-[11px] text-ink-2">
        {post.courseTitle} · {ROLE[post.authorRole]} · {post.author}
        {post.deleted ? " · 작성자가 지움" : ""}
      </MonoLabel>
      <Link href={post.url} className="text-[16px] font-semibold text-ink">
        {kind === "answer" ? `↳ ${post.title}` : post.title || "(지운 질문)"}
      </Link>
      <div className="max-h-48 overflow-y-auto border-l-2 border-line pl-3">
        <UserText source={post.body || "(내용 없음)"} className="text-[14px]" />
      </div>
      {post.hidden && post.hiddenReason ? (
        <p className="m-0 text-[13px] text-danger">숨김 사유: {post.hiddenReason}</p>
      ) : null}
    </div>
  );
}

// AD-17 Q&A 관리: 신고된 글 (숨김 · 문제없음), 답변 없이 3일 지난 질문, 숨긴 글 (다시 보이기)
export default async function AdminQna() {
  await requireStaff("operator", "/admin/qna");
  const db = getDb();
  const [reported, stale, hidden] = await Promise.all([
    reportedPosts(db),
    staleQuestions(db),
    hiddenPosts(db),
  ]);
  return (
    <>
      <PageTitle label="Q&A" title="Q&A 관리">
        숨긴 글은 작성자 · 강사 · 운영자에게만 보이고, 작성자에게 사유가 알림으로 갑니다. 작업은 기록에
        남습니다.
      </PageTitle>

      <section aria-label="신고된 글" className="mb-12">
        <h2 className="m-0 mb-4 text-[21px] font-semibold tracking-[-0.02em]">신고된 글 {reported.length}</h2>
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
          {reported.map((r) =>
            r.post ? (
              <li
                key={`${r.targetType}:${r.targetId}`}
                className="flex flex-col gap-3 border-b border-line py-5"
              >
                <p className="m-0 text-[13px] text-danger">
                  신고 {r.reasons.length}건 · {[...new Set(r.reasons)].join(", ")} · 처음{" "}
                  {formatDayTime(r.firstAt)}
                </p>
                {r.details.length > 0 ? (
                  <ul className="m-0 pl-5 text-[13px] text-ink-2">
                    {r.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
                <PostCard post={r.post} kind={r.targetType} />
                <ModerateActions
                  targetType={r.targetType}
                  targetId={r.targetId}
                  hidden={r.post.hidden}
                  reported
                />
              </li>
            ) : null,
          )}
          {reported.length === 0 ? <li className="py-5 text-ink-2">없음</li> : null}
        </ul>
      </section>

      <section aria-label="오래된 미답변" className="mb-12">
        <h2 className="m-0 mb-1 text-[21px] font-semibold tracking-[-0.02em]">
          답변 없이 3일 지난 질문 {stale.length}
        </h2>
        <p className="m-0 mb-4 text-[14px] text-ink-2">강사에게 알리거나 운영자가 먼저 답해 주세요.</p>
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0 text-[15px]">
          {stale.map((q) => (
            <li key={q.id} className="border-b border-line py-3">
              <Link href={questionUrl(q.slug, q.chapterKey, q.id)} className="text-ink">
                {q.isSecret ? "🔒 " : ""}
                {q.title}
              </Link>
              <span className="text-[13px] text-ink-2">
                {" "}
                · {q.courseTitle} · {formatDayTime(q.createdAt)}
              </span>
            </li>
          ))}
          {stale.length === 0 ? <li className="py-5 text-ink-2">없음</li> : null}
        </ul>
      </section>

      <section aria-label="숨긴 글">
        <h2 className="m-0 mb-4 text-[21px] font-semibold tracking-[-0.02em]">숨긴 글 {hidden.length}</h2>
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
          {hidden.map((h) => (
            <li
              key={`${h.targetType}:${h.targetId}`}
              className="flex flex-col gap-3 border-b border-line py-5"
            >
              <PostCard post={h.post} kind={h.targetType} />
              <ModerateActions targetType={h.targetType} targetId={h.targetId} hidden reported={false} />
            </li>
          ))}
          {hidden.length === 0 ? <li className="py-5 text-ink-2">없음</li> : null}
        </ul>
      </section>
    </>
  );
}
