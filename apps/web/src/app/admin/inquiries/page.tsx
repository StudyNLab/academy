import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@aionit/ui";
import { formatDayTime } from "@/components/commerce/format";
import { INQUIRY_STATUS } from "@/components/inquiry-labels";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { adminInquiries } from "@/server/inquiries";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "1:1 문의" };

// AD-13 1:1 문의: 답변을 기다리는 문의 (오래 기다린 순)
export default async function AdminInquiries({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireStaff("operator", "/admin/inquiries");
  const all = (await searchParams).all === "1";
  const rows = await adminInquiries(getDb(), all ? "all" : "open");
  return (
    <>
      <PageTitle label="Inquiries" title="1:1 문의">
        {all ? "모든 문의 (최근 200건)" : "답변을 기다리는 문의"} ·{" "}
        <Link href={all ? "/admin/inquiries" : "/admin/inquiries?all=1"}>
          {all ? "기다리는 것만" : "전체 보기"}
        </Link>
      </PageTitle>
      <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0 text-[15px]">
        {rows.map(({ inquiry, nickname }) => {
          const [label, tone] = INQUIRY_STATUS[inquiry.status];
          return (
            <li key={inquiry.id} className="border-b border-line py-4">
              <Link
                href={`/admin/inquiries/${inquiry.id}`}
                className="flex flex-wrap items-baseline justify-between gap-3 text-ink no-underline"
              >
                <span>
                  <strong className="font-semibold">{inquiry.title}</strong>
                  <span className="text-ink-2">
                    {" "}
                    · {inquiry.category} · {nickname ?? "(탈퇴한 회원)"} · 마지막 글{" "}
                    {formatDayTime(inquiry.lastMessageAt)}
                  </span>
                </span>
                <StatusDot tone={tone}>{label}</StatusDot>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="py-5 text-ink-2">없음</li> : null}
      </ul>
    </>
  );
}
