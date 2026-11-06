import type { Metadata } from "next";
import Link from "next/link";
import { formatDay } from "@/components/commerce/format";
import { SvcIcon } from "@/components/icons";
import { getDb } from "@/server/db";
import { publishedNotices } from "@/server/notices";

export const metadata: Metadata = { title: "공지" };

// P-07 공지 목록 (시안 #/notices): 고정 ➔ 최신순
export default async function NoticesPage() {
  const rows = await publishedNotices(getDb());
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <span>공지</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">NOTICE</span>
          <h1>AIONIT의 새로운 소식.</h1>
          <p>서비스와 강의에 관한 안내를 확인하세요.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="surface padded text-muted">아직 공지가 없습니다.</p>
      ) : (
        <div className="surface">
          {rows.map((n) => (
            <Link key={n.id} className="notice-row" href={`/notices/${n.id}`}>
              <span>
                <span className={n.pinned ? "tag" : "tag tag-outline"}>{n.pinned ? "고정" : "공지"}</span>
              </span>
              <h2>{n.title}</h2>
              <time dateTime={n.publishedAt!.toISOString()}>{formatDay(n.publishedAt!)}</time>
              <SvcIcon name="arrow" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
