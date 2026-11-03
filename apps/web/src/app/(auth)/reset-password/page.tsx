import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "새 비밀번호 정하기" };

type Search = Promise<Record<string, string | string[] | undefined>>;

// 메일 링크 ➔ /api/v1/auth/reset-password/<토큰> ➔ 여기로 (?token= 또는 ?error=INVALID_TOKEN)
export default async function ResetPasswordPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  return (
    <>
      <PageTitle label="New password" title="새 비밀번호 정하기" />
      {token && !params.error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex flex-col gap-6">
          <Notice tone="warn" title="링크가 만료되었거나 이미 쓴 링크입니다">
            비밀번호 재설정 링크는 1시간 동안 한 번만 쓸 수 있습니다.
          </Notice>
          <Link href="/forgot-password">재설정 링크 다시 받기</Link>
        </div>
      )}
    </>
  );
}
