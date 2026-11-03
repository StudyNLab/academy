import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { currentPolicies } from "@/server/consents";
import { getDb } from "@/server/db";
import { socialProviders } from "@/server/providers";
import { getViewer } from "@/server/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "회원가입" };

// A-01 회원가입: 이메일 · 구글 · 카카오. 약관 동의(필수/선택 분리), 만 14세 확인, 닉네임
export default async function SignupPage() {
  if (await getViewer()) redirect("/");
  const policies = await currentPolicies(getDb(), ["terms", "privacy", "marketing"]);
  const titles = Object.fromEntries([...policies].map(([kind, doc]) => [kind, doc.title]));
  return (
    <>
      <PageTitle label="Sign up" title="회원가입">
        <p className="m-0">가입은 무료입니다. 이메일 인증을 마치면 바로 무료 강의를 볼 수 있습니다.</p>
      </PageTitle>
      <SignupForm policyTitles={titles} providers={socialProviders()} />
    </>
  );
}
