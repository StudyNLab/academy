import type { Metadata } from "next";
import { ResendVerification } from "./resend";

export const metadata: Metadata = { title: "인증 메일을 보냈습니다" };

// A-02 이메일 인증 (시안 #/verify): 메일 안내 + 다시 보내기. 시안의 "인증 상태 확인"은 로그인으로 대신한다
// (메일의 링크를 누르면 로그인 화면에 "이메일 확인이 끝났습니다"가 뜬다)
export default function SignupSentPage() {
  return (
    <>
      <h1>메일함을 확인해 주세요.</h1>
      <p className="auth-desc">
        메일의 <strong className="text-ink">이메일 확인하기</strong> 버튼을 누르면 가입이 끝납니다. 링크는
        1시간 동안 쓸 수 있습니다.
      </p>
      <ResendVerification />
    </>
  );
}
