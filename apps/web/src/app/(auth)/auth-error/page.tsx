import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = { title: "로그인 오류" };

type Search = Promise<Record<string, string | string[] | undefined>>;

// 인증 라이브러리가 따로 갈 곳이 없을 때 보내는 오류 화면
export default async function AuthErrorPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const code = typeof params.error === "string" ? params.error.slice(0, 60) : "unknown";
  return (
    <>
      <PageTitle label="Error" title="로그인을 마치지 못했습니다" />
      <div className="flex flex-col gap-6">
        <Notice tone="danger">
          잠시 뒤 다시 시도해 주세요. 계속되면 1:1 문의로 알려 주세요.{" "}
          <span className="font-mono text-[12px]">(코드: {code})</span>
        </Notice>
        <Link href="/login">로그인으로 돌아가기</Link>
      </div>
    </>
  );
}
