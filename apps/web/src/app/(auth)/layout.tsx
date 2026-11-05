import type { ReactNode } from "react";
import Link from "next/link";
import { SvcIcon } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { firstLook } from "@/server/catalog";
import { getDb } from "@/server/db";

// 가입 · 로그인 · 비밀번호 재설정 · 2단계 인증 (시안 .auth-layout): 왼쪽 소개 + 오른쪽 입력 카드.
// 각 화면은 카드 안의 h1 · .auth-desc 부터 그린다
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const look = await firstLook(getDb());
  return (
    <>
      <SiteHeader />
      <main className="auth-layout wrap">
        <aside className="auth-story">
          <span className="eyebrow">BUILD YOUR NEXT.</span>
          <h2>
            이해한 기술이,
            <br />
            나의 실력이 되도록.
          </h2>
          <p>
            영상으로 이해하고,
            <br />
            교재로 정리하고,
            <br />
            실습으로 완성합니다.
          </p>
          <div className="auth-graphic" aria-hidden="true">
            <SvcIcon name="code" />
            <span>READ / BUILD / REPEAT</span>
          </div>
          {look ? (
            <Link className="link-line" href={look.href}>
              {look.preview ? "가입 전에 교재 둘러보기" : "가입 전에 강의 둘러보기"} <SvcIcon name="arrow" />
            </Link>
          ) : null}
        </aside>
        <section className="auth-card">{children}</section>
      </main>
      <SiteFooter />
    </>
  );
}
