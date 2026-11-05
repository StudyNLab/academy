import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@aionit/ui";
import { safeNext } from "@/lib/next-url";
import { socialProviders } from "@/server/providers";
import { getViewer } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** 다른 화면에서 보내온 상태 ➔ 안내 문구 */
function notice(params: Record<string, string | string[] | undefined>) {
  const error = String(params.error ?? "").toLowerCase();
  if (error === "account_not_linked") {
    // A-05 계정 연결: 같은 이메일로 가입한 계정이 이미 있다. 자동으로 잇지 않는다.
    return (
      <Notice tone="warn" title="같은 이메일로 가입한 계정이 이미 있습니다">
        보안을 위해 자동으로 연결하지 않습니다. 원래 쓰던 방식(이메일 · 비밀번호 등)으로 로그인한 뒤{" "}
        <strong>내 정보 ➔ 로그인 연결</strong>에서 이 계정을 연결해 주세요.
      </Notice>
    );
  }
  if (error === "signup_disabled") {
    return (
      <Notice tone="info" title="아직 가입하지 않은 계정입니다">
        <Link href="/signup">회원가입</Link>에서 약관 동의와 닉네임을 정한 뒤 같은 버튼으로 가입해 주세요.
      </Notice>
    );
  }
  if (error === "invalid_token" || error === "token_expired") {
    return (
      <Notice tone="warn" title="인증 링크가 만료되었습니다">
        로그인하면 새 인증 메일을 보내 드립니다.
      </Notice>
    );
  }
  if (error)
    return (
      <Notice tone="danger">
        로그인 중 문제가 생겼습니다. 다시 시도해 주세요. (코드: {error.slice(0, 40)})
      </Notice>
    );
  if (params.verified) return <Notice tone="done">이메일 확인이 끝났습니다. 로그인해 주세요.</Notice>;
  if (params.reset) return <Notice tone="done">비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주세요.</Notice>;
  if (params.withdrawn)
    return <Notice tone="done">탈퇴가 끝났습니다. 그동안 이용해 주셔서 감사합니다.</Notice>;
  return null;
}

// A-03 로그인 (시안 #/login): 구글 · 카카오 ➔ 이메일. 시안의 "로그인 유지" 상자는 아직 기능이 없어 두지 않았다
export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  if (await getViewer()) redirect(next);
  const message = notice(params);
  return (
    <>
      <h1>다시 만나 반가워요.</h1>
      <p className="auth-desc">지난 배움에서 이어서 시작하세요.</p>
      {message ? <div className="mb-5">{message}</div> : null}
      <LoginForm next={next} providers={socialProviders()} />
    </>
  );
}
