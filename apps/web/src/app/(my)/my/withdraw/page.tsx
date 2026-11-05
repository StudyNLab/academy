import type { Metadata } from "next";
import Link from "next/link";
import { eq, schema } from "@aionit/db";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { requireViewer } from "@/server/session";
import { WithdrawForm } from "./withdraw-form";

export const metadata: Metadata = { title: "회원 탈퇴" };

// M-06 회원 탈퇴: 남은 수강권 · 구독 안내(M3 · M6 에서 채움), 개인정보 처리 안내, Q&A 글 · 1:1 문의 처리 안내 (이용약관 제10조 · 제13조)
export default async function WithdrawPage() {
  const viewer = await requireViewer("/my/withdraw");
  const accounts = await getDb()
    .select({ providerId: schema.authAccounts.providerId })
    .from(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, viewer.userId));
  return (
    <>
      <PageTitle label="Withdraw" title="회원 탈퇴">
        <p className="m-0">탈퇴하면 되돌릴 수 없습니다. 아래 내용을 확인해 주세요.</p>
      </PageTitle>
      <ul className="surface padded m-0 mb-8 flex flex-col gap-3 pl-12 text-[15px] leading-[1.75]">
        <li>이메일 · 닉네임 등 개인정보는 바로 지웁니다. 같은 이메일로 다시 가입하면 새 회원이 됩니다.</li>
        <li>가진 수강권 · 구독은 모두 끝나며 되살릴 수 없습니다. 환불이 필요하면 탈퇴 전에 요청해 주세요.</li>
        <li>
          강의 Q&A 에 쓴 글은 다른 수강생을 위해 남기고, 글쓴이는 &quot;탈퇴한 회원&quot;으로 보입니다. 지우고
          싶은 글은 탈퇴 전에 지워 주세요.
        </li>
        <li>1:1 문의는 분쟁 해결을 위해 마지막 글부터 3년 보관한 뒤 지웁니다.</li>
        <li>
          결제 기록(5년)과 로그인 기록(6개월)은 법에 따라 보관한 뒤 지웁니다. 이 기록에는 이메일 · 닉네임이
          들어 있지 않습니다. 자세한 내용은 <Link href="/policies/privacy_policy">개인정보처리방침</Link>을 봐
          주세요.
        </li>
      </ul>
      <WithdrawForm needsPassword={accounts.some((a) => a.providerId === "credential")} />
    </>
  );
}
