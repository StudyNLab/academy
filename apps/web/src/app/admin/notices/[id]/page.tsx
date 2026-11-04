import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { noticeById } from "@/server/notices";
import { requireStaff } from "@/server/session";
import { NoticeForm } from "../notice-forms";

export const metadata: Metadata = { title: "공지 고치기" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AD-12 공지 고치기 · 게시 · 게시 내리기 · 지우기
export default async function AdminNotice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff("operator", `/admin/notices/${id}`);
  const notice = UUID.test(id) ? await noticeById(getDb(), id, { includeDraft: true }) : null;
  if (!notice) notFound();
  return (
    <>
      <PageTitle label="Notice" title="공지 고치기">
        <Link href="/admin/notices">← 목록</Link> ·{" "}
        <Link href={`/notices/${notice.id}`}>사이트에서 보기</Link>
      </PageTitle>
      <NoticeForm
        notice={{
          id: notice.id,
          title: notice.title,
          bodyMd: notice.bodyMd,
          pinned: notice.pinned,
          published: notice.published,
        }}
      />
    </>
  );
}
