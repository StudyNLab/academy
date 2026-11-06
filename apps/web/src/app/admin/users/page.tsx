import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { inputClass, StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { maskEmail, searchUsers } from "@/server/admin-queries";
import { getDb } from "@/server/db";
import { recordPiiAccess } from "@/server/records";
import { requireStaff } from "@/server/session";
import { ROLE_LABEL, STATUS_TONE, STATUS_LABEL } from "../labels";

export const metadata: Metadata = { title: "회원 관리" };

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

// AD-08 회원 관리 (M1: 검색 · 상세 · 역할 · 이용 정지. 수강권 발급은 M3)
export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await requireStaff("operator", "/admin/users");
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const db = getDb();
  const users = await searchUsers(db, q);
  // 목록은 이메일을 가려 보여 주지만, 이메일로 검색했다면 조회 기록을 남긴다
  if (q) {
    await recordPiiAccess(db, {
      actorId: viewer.userId,
      subjectUserId: null,
      fields: ["email", "nickname"],
      purpose: "회원 검색",
      headers: await headers(),
    });
  }

  return (
    <>
      <PageTitle label="Members" title="회원" />
      <form className="mb-6 flex max-w-[480px] gap-3" role="search">
        <label htmlFor="q" className="sr-only">
          이메일 · 닉네임 검색
        </label>
        <input id="q" name="q" defaultValue={q} placeholder="이메일 또는 닉네임" className={inputClass} />
        <button
          type="submit"
          className="min-h-11 shrink-0 border border-primary px-5 font-semibold text-primary"
        >
          검색
        </button>
      </form>
      <div className="surface data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="px-2 py-2.5">닉네임</th>
              <th className="px-2 py-2.5">이메일</th>
              <th className="px-2 py-2.5">상태</th>
              <th className="px-2 py-2.5">역할</th>
              <th className="px-2 py-2.5">2단계</th>
              <th className="px-2 py-2.5 text-right">가입일</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-line">
                <td className="px-2 py-3">
                  <Link href={`/admin/users/${user.id}`}>{user.nickname ?? "(없음)"}</Link>
                </td>
                <td className="px-2 py-3 font-mono text-[13px]">{maskEmail(user.email)}</td>
                <td className="px-2 py-3">
                  <StatusDot tone={STATUS_TONE[user.status]}>
                    {STATUS_LABEL[user.status]}
                    {!user.emailVerified && user.status === "active" ? " · 메일 미인증" : ""}
                  </StatusDot>
                </td>
                <td className="px-2 py-3">
                  {user.roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]).join(", ") || "-"}
                </td>
                <td className="px-2 py-3">{user.twoFactorEnabled ? "켬" : "-"}</td>
                <td className="px-2 py-3 text-right tabular-nums">{date.format(user.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 ? <p className="py-8 text-ink-2">찾는 회원이 없습니다.</p> : null}
      </div>
    </>
  );
}
