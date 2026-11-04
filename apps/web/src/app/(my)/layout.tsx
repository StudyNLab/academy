import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

const tabs = [
  { href: "/my", label: "내 정보" },
  { href: "/my/entitlements", label: "수강권" },
  { href: "/my/subscription", label: "구독 관리" },
  { href: "/my/payments", label: "결제 내역" },
  { href: "/my/notifications", label: "알림" },
  { href: "/my/questions", label: "내 질문" },
  { href: "/my/inquiries", label: "1:1 문의" },
  { href: "/my/security", label: "로그인 · 보안" },
  { href: "/my/withdraw", label: "회원 탈퇴" },
];

// 마이페이지. 로그인 확인은 화면마다 한다 (돌아올 주소가 다르므로)
export default function MyLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid max-w-[1296px] gap-10 px-5 pt-12 md:grid-cols-[200px_1fr] md:px-14 md:pt-16">
        <nav
          aria-label="마이페이지"
          className="flex gap-x-6 overflow-x-auto border-b border-line md:flex-col md:border-b-0"
        >
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="inline-flex min-h-11 items-center whitespace-nowrap text-ink no-underline"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <main className="max-w-[640px]">{children}</main>
      </div>
      <SiteFooter />
    </>
  );
}
