import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@aionit/ui";
import { formatDay } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { allNotices } from "@/server/notices";
import { requireStaff } from "@/server/session";
import { NoticeForm } from "./notice-forms";

export const metadata: Metadata = { title: "공지" };

// AD-12 공지 목록 + 새 공지. 자주 묻는 질문은 /admin/faqs
export default async function AdminNotices() {
  await requireStaff("operator", "/admin/notices");
  const rows = await allNotices(getDb());
  return (
    <>
      <PageTitle label="Notices" title="공지">
        사이트 바닥글의 공지 화면에 보입니다 · <Link href="/admin/faqs">자주 묻는 질문 관리 →</Link>
      </PageTitle>
      <ul className="m-0 mb-12 flex list-none flex-col border-t border-line-strong p-0 text-[15px]">
        {rows.map((n) => (
          <li key={n.id} className="border-b border-line py-3">
            <Link
              href={`/admin/notices/${n.id}`}
              className="flex flex-wrap items-baseline justify-between gap-3 text-ink no-underline"
            >
              <span>
                {n.pinned ? <span className="mr-2 font-mono text-[12px] text-signal">고정</span> : null}
                <strong className="font-semibold">{n.title}</strong>
                <span className="text-ink-2"> · {formatDay(n.publishedAt ?? n.createdAt)}</span>
              </span>
              <StatusDot tone={n.publishedAt ? "done" : "muted"}>
                {n.publishedAt ? "게시" : "임시 저장"}
              </StatusDot>
            </Link>
          </li>
        ))}
        {rows.length === 0 ? <li className="py-5 text-ink-2">아직 공지가 없습니다.</li> : null}
      </ul>
      <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">새 공지</h2>
      <NoticeForm />
    </>
  );
}
