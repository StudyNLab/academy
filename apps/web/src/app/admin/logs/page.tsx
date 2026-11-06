import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { recentAudit, recentLogins } from "@/server/admin-queries";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { ACTION_LABEL, LOGIN_RESULT_LABEL } from "../labels";

export const metadata: Metadata = { title: "기록" };

const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "short",
  timeStyle: "medium",
});
const th = "px-2 py-2.5 text-left font-mono text-[12px] tracking-[0.04em]";
const td = "px-2 py-2.5 align-top";

// AD-14 기록: 관리자 작업 기록(audit_logs) · 로그인 기록(login_logs). 둘 다 고칠 수 없다 (DB 트리거)
export default async function AdminLogs({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireStaff("operator", "/admin/logs");
  const tab = (await searchParams).tab === "login" ? "login" : "audit";
  const db = getDb();

  return (
    <>
      <PageTitle label="Logs" title="기록">
        <p className="m-0">
          최근 100건. 기록은 덧붙이기만 하고 고치거나 지울 수 없습니다 (보관: 운영자 작업 2년 · 회원 로그인
          6개월).
        </p>
      </PageTitle>
      <nav aria-label="기록 종류" className="mb-6 flex gap-6 border-b border-line">
        <Link
          href="/admin/logs"
          aria-current={tab === "audit" ? "page" : undefined}
          className="inline-flex min-h-11 items-center aria-[current=page]:font-semibold aria-[current=page]:text-signal"
        >
          관리자 작업
        </Link>
        <Link
          href="/admin/logs?tab=login"
          aria-current={tab === "login" ? "page" : undefined}
          className="inline-flex min-h-11 items-center aria-[current=page]:font-semibold aria-[current=page]:text-signal"
        >
          로그인
        </Link>
      </nav>
      <div className="overflow-x-auto">
        {tab === "audit" ? (
          <table className="data-table">
            <thead>
              <tr>
                <th className={th}>시각</th>
                <th className={th}>누가</th>
                <th className={th}>작업</th>
                <th className={th}>대상</th>
                <th className={th}>내용</th>
                <th className={th}>IP</th>
              </tr>
            </thead>
            <tbody>
              {(await recentAudit(db)).map((log) => (
                <tr key={log.id} className="border-b border-line">
                  <td className={`${td} tabular-nums`}>{time.format(log.at)}</td>
                  <td className={td}>{log.actorNickname ?? (log.actorId ? "(탈퇴)" : "시스템")}</td>
                  <td className={td}>{ACTION_LABEL[log.action] ?? log.action}</td>
                  <td className={td}>
                    {log.targetType === "user" && log.targetId ? (
                      <Link href={`/admin/users/${log.targetId}`}>회원</Link>
                    ) : (
                      (log.targetType ?? "-")
                    )}
                  </td>
                  <td className={`${td} font-mono text-[12px] text-ink-2`}>
                    {log.after ? JSON.stringify(log.after) : "-"}
                  </td>
                  <td className={`${td} font-mono text-[12px]`}>{log.ip ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className={th}>시각</th>
                <th className={th}>회원</th>
                <th className={th}>방식</th>
                <th className={th}>결과</th>
                <th className={th}>IP</th>
              </tr>
            </thead>
            <tbody>
              {(await recentLogins(db)).map((log) => (
                <tr key={log.id} className="border-b border-line">
                  <td className={`${td} tabular-nums`}>{time.format(log.at)}</td>
                  <td className={td}>
                    {log.userId ? (
                      <Link href={`/admin/users/${log.userId}`}>{log.nickname ?? "(탈퇴)"}</Link>
                    ) : (
                      "(모름)"
                    )}
                    {log.privileged === "yes" ? <span className="text-ink-2"> · 운영</span> : null}
                  </td>
                  <td className={td}>{log.method}</td>
                  <td className={td}>{LOGIN_RESULT_LABEL[log.result] ?? log.result}</td>
                  <td className={`${td} font-mono text-[12px]`}>{log.ip ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
