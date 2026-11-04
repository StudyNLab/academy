import Link from "next/link";
import type { ReactNode } from "react";
import { MonoLabel } from "@aionit/ui";
import { SiteHeader } from "@/components/site-chrome";

const menu = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/courses", label: "과정" },
  { href: "/admin/users", label: "회원" },
  { href: "/admin/products", label: "상품 · 가격" },
  { href: "/admin/subscriptions", label: "구독" },
  { href: "/admin/refunds", label: "환불" },
  { href: "/admin/inquiries", label: "1:1 문의" },
  { href: "/admin/qna", label: "Q&A 관리" },
  { href: "/admin/notices", label: "공지 · FAQ" },
  { href: "/admin/logs", label: "기록" },
];

// 관리자 화면. 권한(운영자 + 2단계 인증 + 이 세션 OTP 통과)은 화면마다 requireStaff 로, API 는 requireApiStaff 로 다시 확인한다.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid max-w-[1296px] gap-10 px-5 pt-10 pb-24 md:grid-cols-[180px_1fr] md:px-14">
        <nav
          aria-label="관리자 메뉴"
          className="flex gap-x-6 overflow-x-auto border-b border-line md:flex-col md:border-b-0"
        >
          <MonoLabel className="hidden text-xs text-signal md:block">Admin</MonoLabel>
          {menu.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center whitespace-nowrap text-ink no-underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
    </>
  );
}
