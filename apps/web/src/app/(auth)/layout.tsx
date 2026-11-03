import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

// 가입 · 로그인 · 비밀번호 재설정: 공통 머리글 + 좁은 한 줄 (입력에 집중)
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[480px] px-5 pt-14 pb-10 md:pt-20">{children}</main>
      <SiteFooter />
    </>
  );
}
