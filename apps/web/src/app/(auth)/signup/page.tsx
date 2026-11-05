import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentPolicies } from "@/server/consents";
import { getDb } from "@/server/db";
import { socialProviders } from "@/server/providers";
import { getViewer } from "@/server/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "회원가입" };

// A-01 회원가입 (시안 #/signup): 이메일 · 구글 · 카카오. 약관 동의(필수/선택 분리, 모두 동의), 만 14세 확인, 닉네임.
// 구글 · 카카오 가입도 이 화면의 닉네임 · 동의를 쓰므로 시안과 달리 소셜 버튼을 입력칸 아래에 둔다
export default async function SignupPage() {
  if (await getViewer()) redirect("/");
  const policies = await currentPolicies(getDb(), ["terms", "privacy", "marketing"]);
  const titles = Object.fromEntries([...policies].map(([kind, doc]) => [kind, doc.title]));
  return (
    <>
      <h1>다음 실력의 시작.</h1>
      <p className="auth-desc">
        하나의 계정으로 모든 배움을 이어가세요. 가입은 무료이고, 이메일 인증을 마치면 바로 무료 강의를 볼 수
        있습니다.
      </p>
      <SignupForm policyTitles={titles} providers={socialProviders()} />
    </>
  );
}
