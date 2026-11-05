import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@aionit/ui";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "새 비밀번호 정하기" };

type Search = Promise<Record<string, string | string[] | undefined>>;

// A-04 새 비밀번호 (시안 #/reset). 메일 링크 ➔ /api/v1/auth/reset-password/<토큰> ➔ 여기로 (?token= 또는 ?error=INVALID_TOKEN)
export default async function ResetPasswordPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  return (
    <>
      <h1>새 비밀번호를 정하세요.</h1>
      <p className="auth-desc">다른 곳에서 쓰지 않는 비밀번호를 권합니다.</p>
      {token && !params.error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex flex-col gap-5">
          <Notice tone="warn" title="링크가 만료되었거나 이미 쓴 링크입니다">
            비밀번호 재설정 링크는 1시간 동안 한 번만 쓸 수 있습니다.
          </Notice>
          <Link className="btn primary full" href="/forgot-password">
            재설정 링크 다시 받기
          </Link>
        </div>
      )}
    </>
  );
}
