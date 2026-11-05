import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNav } from "@/components/account-nav";
import { SvcIcon } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { getViewer } from "@/server/session";

const items = [
  { href: "/my", label: "내 정보" },
  { href: "/my/entitlements", label: "수강권" },
  { href: "/my/subscription", label: "구독 관리" },
  { href: "/my/payments", label: "결제 · 환불" },
  { href: "/my/questions", label: "내 질문" },
  { href: "/my/inquiries", label: "1:1 문의" },
  { href: "/my/notifications", label: "알림" },
  { href: "/my/security", label: "로그인 · 보안" },
  { href: "/my/withdraw", label: "회원 탈퇴" },
];

// 마이페이지 (시안 .account-layout: 왼쪽 회원 · 메뉴, 오른쪽 내용). 로그인 확인은 화면마다 한다 (돌아올 주소가 다르므로)
export default async function MyLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return (
    <>
      <SiteHeader />
      <main className="wrap account-layout">
        <aside className="account-sidebar">
          <span className="eyebrow">MY AIONIT</span>
          {viewer ? (
            <>
              <div className="avatar" aria-hidden="true">
                {viewer.nickname.slice(0, 1).toUpperCase()}
              </div>
              <strong>{viewer.nickname}</strong>
            </>
          ) : null}
          <p>나의 배움과 이용 관리</p>
          <AccountNav items={items} />
          <Link className="sidebar-foot" href="/learn">
            <SvcIcon name="back" /> 내 강의실로
          </Link>
        </aside>
        <section className="account-content">{children}</section>
      </main>
      <SiteFooter />
    </>
  );
}
