import type { Metadata } from "next";
import { PageTitle } from "@/components/page-title";
import { ResendVerification } from "./resend";

export const metadata: Metadata = { title: "인증 메일을 보냈습니다" };

// A-02 이메일 인증: 메일 안내 + 다시 보내기
export default function SignupSentPage() {
  return (
    <>
      <PageTitle label="Verify email" title="메일함을 확인해 주세요">
        <p className="m-0">
          가입한 이메일로 인증 메일을 보냈습니다. 메일의 <strong className="text-ink">이메일 확인하기</strong>{" "}
          버튼을 누르면 가입이 끝납니다. 링크는 1시간 동안 쓸 수 있습니다.
        </p>
      </PageTitle>
      <ResendVerification />
    </>
  );
}
