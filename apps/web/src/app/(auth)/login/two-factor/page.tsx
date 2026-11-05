import type { Metadata } from "next";
import { safeNext } from "@/lib/next-url";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "2단계 인증" };

type Search = Promise<Record<string, string | string[] | undefined>>;

// 비밀번호 다음 OTP. stepup=1: 이미 로그인했지만 관리자 · 강사 화면에 들어가려면 이 세션에서 OTP 를 한 번 더 받는다
export default async function TwoFactorPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const stepUp = params.stepup === "1";
  return (
    <>
      <h1>2단계 인증</h1>
      <p className="auth-desc">
        {stepUp
          ? "관리 화면에 들어가기 전에 인증 앱의 6자리 코드를 한 번 더 확인합니다."
          : "인증 앱(Google Authenticator 등)에 보이는 6자리 코드를 입력해 주세요."}
      </p>
      <TwoFactorForm next={next} />
    </>
  );
}
