import type { Metadata } from "next";
import { SESSION_POLICY } from "@aionit/core";
import { eq, schema } from "@aionit/db";
import { Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { safeNext } from "@/lib/next-url";
import { getDb } from "@/server/db";
import { requireViewer } from "@/server/session";
import { PasswordChangeForm, TwoFactorSettings } from "./security-forms";

export const metadata: Metadata = { title: "로그인 · 보안" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SecurityPage({ searchParams }: { searchParams: Search }) {
  const viewer = await requireViewer("/my/security");
  const params = await searchParams;
  const accounts = await getDb()
    .select({ providerId: schema.authAccounts.providerId })
    .from(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, viewer.userId));
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const staff = viewer.roles.length > 0;
  // 비밀번호가 없는 회원은 "방금 로그인"으로 본인을 확인한다 (서버 auth.ts 의 before 와 같은 규칙)
  const recentLogin = Date.now() - viewer.sessionCreatedAt.getTime() <= SESSION_POLICY.recentLoginMs;
  const next = typeof params.next === "string" ? safeNext(params.next) : null;

  return (
    <>
      <PageTitle label="Security" title="로그인 · 보안" />
      {params.required && !viewer.twoFactorEnabled ? (
        <div className="mb-6">
          <Notice tone="warn" title="2단계 인증을 켜야 관리 화면에 들어갈 수 있습니다">
            운영자 · 강사는 관리 화면에 들어갈 때 인증 앱의 코드를 한 번 더 입력합니다. 아래에서 켜 주세요.
          </Notice>
        </div>
      ) : null}
      <section className="flex flex-col gap-5 border-t border-line-strong py-7">
        <h2 className="m-0 text-[21px] font-semibold tracking-[-0.02em]">2단계 인증 (OTP)</h2>
        <TwoFactorSettings
          enabled={viewer.twoFactorEnabled}
          hasPassword={hasPassword}
          recentLogin={recentLogin}
          staff={staff}
          next={next}
        />
      </section>
      {hasPassword ? (
        <section className="flex flex-col gap-5 border-t border-line-strong py-7">
          <h2 className="m-0 text-[21px] font-semibold tracking-[-0.02em]">비밀번호 바꾸기</h2>
          <PasswordChangeForm />
        </section>
      ) : null}
    </>
  );
}
