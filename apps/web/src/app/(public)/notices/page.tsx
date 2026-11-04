import type { Metadata } from "next";
import Link from "next/link";
import { MonoLabel } from "@aionit/ui";
import { formatDay } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { publishedNotices } from "@/server/notices";

export const metadata: Metadata = { title: "공지" };

// P-07 공지 목록: 고정 ➔ 최신순
export default async function NoticesPage() {
  const rows = await publishedNotices(getDb());
  return (
    <div className="mx-auto max-w-[760px] px-5 pt-16 md:px-0">
      <PageTitle label="Notice" title="공지" />
      {rows.length === 0 ? (
        <p className="m-0 border-t border-line-strong pt-6 text-ink-2">아직 공지가 없습니다.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
          {rows.map((n) => (
            <li key={n.id} className="border-b border-line">
              <Link
                href={`/notices/${n.id}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 text-ink no-underline"
              >
                <span className="text-[16px] font-semibold">
                  {n.pinned ? <span className="mr-2 font-mono text-[12px] text-signal">고정</span> : null}
                  {n.title}
                </span>
                <MonoLabel className="text-[12px] text-ink-2">{formatDay(n.publishedAt!)}</MonoLabel>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
