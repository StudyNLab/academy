import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { userDetail } from "@/server/admin-queries";
import { getDb } from "@/server/db";
import { recordPiiAccess } from "@/server/records";
import { requireStaff } from "@/server/session";
import { LOGIN_RESULT_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_TONE } from "../../labels";
import { RoleForm, StatusForm } from "./admin-user-forms";

export const metadata: Metadata = { title: "회원 상세" };

const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireStaff("operator", `/admin/users/${id}`);
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const detail = await userDetail(db, id);
  if (!detail) notFound();
  const { user, accounts, logins, roleHistory } = detail;
  // 운영자가 회원 개인정보를 봤다는 기록 (개인정보 안전성 확보조치 기준)
  await recordPiiAccess(db, {
    actorId: viewer.userId,
    subjectUserId: user.id,
    fields: ["email", "nickname", "login_logs"],
    purpose: "회원 상세 조회",
    headers: await headers(),
  });

  return (
    <>
      <PageTitle label="Member" title={user.nickname ?? "(탈퇴한 회원)"} />
      <dl className="m-0 grid grid-cols-[120px_1fr] gap-y-3 border-t border-line-strong pt-6 text-[15px]">
        <dt className="text-ink-2">이메일</dt>
        <dd className="m-0 break-all">
          {user.email.endsWith(".invalid") ? "(없음)" : user.email}{" "}
          {user.emailVerified ? "· 인증됨" : "· 미인증"}
        </dd>
        <dt className="text-ink-2">상태</dt>
        <dd className="m-0">
          <StatusDot tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</StatusDot>
        </dd>
        <dt className="text-ink-2">로그인 방식</dt>
        <dd className="m-0">
          {accounts.map((a) => (a.providerId === "credential" ? "이메일" : a.providerId)).join(", ") || "-"}
        </dd>
        <dt className="text-ink-2">2단계 인증</dt>
        <dd className="m-0">{user.twoFactorEnabled ? "켬" : "끔"}</dd>
        <dt className="text-ink-2">역할</dt>
        <dd className="m-0">
          {user.roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]).join(", ") || "없음"}
        </dd>
        <dt className="text-ink-2">가입</dt>
        <dd className="m-0">{time.format(user.createdAt)}</dd>
      </dl>

      {user.status !== "withdrawn" ? (
        <div className="mt-10 grid gap-10 md:grid-cols-2">
          <RoleForm userId={user.id} roles={user.roles} self={user.id === viewer.userId} />
          <StatusForm userId={user.id} status={user.status} self={user.id === viewer.userId} />
        </div>
      ) : null}

      <h2 className="mt-12 mb-3 text-[19px] font-semibold">역할 이력</h2>
      <ul className="m-0 flex list-none flex-col p-0 text-[14px]">
        {roleHistory.map((r) => (
          <li key={r.id} className="border-b border-line py-2.5">
            {ROLE_LABEL[r.role]} · {time.format(r.grantedAt)} 부여
            {r.revokedAt ? ` · ${time.format(r.revokedAt)} 회수` : " · 유지 중"}
            {r.reason ? <span className="text-ink-2"> — {r.reason}</span> : null}
          </li>
        ))}
        {roleHistory.length === 0 ? <li className="py-2.5 text-ink-2">없음</li> : null}
      </ul>

      <h2 className="mt-12 mb-3 text-[19px] font-semibold">최근 로그인 기록</h2>
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-y-2 border-line-strong text-left font-mono text-[12px]">
            <th className="px-2 py-2">시각</th>
            <th className="px-2 py-2">방식</th>
            <th className="px-2 py-2">결과</th>
            <th className="px-2 py-2">IP</th>
          </tr>
        </thead>
        <tbody>
          {logins.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="px-2 py-2 tabular-nums">{time.format(l.at)}</td>
              <td className="px-2 py-2">{l.method}</td>
              <td className="px-2 py-2">{LOGIN_RESULT_LABEL[l.result] ?? l.result}</td>
              <td className="px-2 py-2 font-mono text-[13px]">{l.ip ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
