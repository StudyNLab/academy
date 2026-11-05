import type { Metadata } from "next";
import Link from "next/link";
import { MonoLabel } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { timeAgo } from "@/components/user-text";
import { getDb } from "@/server/db";
import { myNotifications } from "@/server/notifications";
import { requireViewer } from "@/server/session";
import { MarkAllRead } from "./mark-all-read";

export const metadata: Metadata = { title: "알림" };

const KIND_LABEL = {
  qna_answer: "Q&A 답변",
  qna_question: "새 질문",
  qna_hidden: "Q&A 관리",
  inquiry_answer: "1:1 문의",
  expiry: "수강 기간",
  content_review: "교재 검수",
  instructor_contract: "강사",
  settlement: "정산",
} as const;

// 사이트 알림 (최근 50개). 누르면 읽음으로 바뀌고 그 화면으로 간다. 메일 알림은 내 정보 > 알림 설정
export default async function NotificationsPage() {
  const viewer = await requireViewer("/my/notifications");
  const rows = await myNotifications(getDb(), viewer.userId);
  const unread = rows.filter((n) => !n.readAt).length;
  return (
    <>
      <PageTitle label="Notifications" title="알림">
        새 답변 · 문의 답변 · 수강 기간 알림입니다. 메일로 받을지는{" "}
        <Link href="/my">내 정보 &gt; 알림 설정</Link>
        에서 정합니다.
      </PageTitle>
      {unread > 0 ? <MarkAllRead count={unread} /> : null}
      {rows.length === 0 ? (
        <p className="m-0 border-t border-line-strong pt-6 text-ink-2">새 알림이 없습니다.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
          {rows.map((n) => (
            <li key={n.id} className="border-b border-line">
              {/* 열기 주소가 읽음 처리 후 그 화면으로 보낸다 */}
              <a
                href={`/api/v1/notifications/${n.id}`}
                className="flex flex-col gap-1 py-4 text-ink no-underline hover:bg-sunken"
              >
                <span className="flex items-baseline gap-2">
                  {n.readAt ? null : (
                    <span className="inline-block h-2 w-2 shrink-0 bg-signal" aria-label="읽지 않음" />
                  )}
                  <MonoLabel className="text-[11px] text-ink-2">{KIND_LABEL[n.kind]}</MonoLabel>
                  <span className="text-[12px] text-ink-2">{timeAgo(n.createdAt)}</span>
                </span>
                <span className={`text-[15px] ${n.readAt ? "text-ink-2" : "font-semibold"}`}>{n.title}</span>
                {n.body ? <span className="text-[13px] text-ink-2">{n.body}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
