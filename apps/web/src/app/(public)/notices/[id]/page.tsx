import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDay } from "@/components/commerce/format";
import { SvcIcon } from "@/components/icons";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { getDb } from "@/server/db";
import { noticeById } from "@/server/notices";
import { getViewer } from "@/server/session";
import { staffAccess } from "@/server/viewer";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 게시 전 공지는 운영자(2단계 인증 통과)만 미리 본다 */
async function load(id: string) {
  if (!UUID.test(id)) return null;
  const viewer = await getViewer();
  return noticeById(getDb(), id, { includeDraft: staffAccess(viewer, "operator") === "ok" });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const notice = await load((await params).id);
  return { title: notice?.title ?? "공지" };
}

// P-07 공지 하나 (시안 #/notice)
export default async function NoticePage({ params }: { params: Params }) {
  const notice = await load((await params).id);
  if (!notice) notFound();
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <Link href="/notices">공지</Link>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">NOTICE</span>
          <h1>{notice.title}</h1>
          <p>{notice.published ? formatDay(notice.publishedAt!) : "게시 전 (운영자 미리보기)"}</p>
        </div>
      </div>
      <article className="surface padded editorial">
        <SimpleMarkdown source={notice.bodyMd} />
        <div className="form-actions">
          <Link className="btn secondary" href="/notices">
            공지 목록 <SvcIcon name="arrow" />
          </Link>
        </div>
      </article>
    </div>
  );
}
