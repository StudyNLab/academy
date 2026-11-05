import Link from "next/link";
import type { ReactNode } from "react";
import { MonoLabel } from "@aionit/ui";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

const menu = [
  { href: "/instructor", label: "대시보드" },
  { href: "/instructor/courses", label: "내 강의" },
  { href: "/instructor/qna", label: "Q&A 답변" },
  { href: "/instructor/settlements", label: "정산" },
  { href: "/instructor/profile", label: "정산 정보 · 프로필" },
];

// 강사 화면. 권한(강사 역할 + 2단계 인증 + 이어진 강사 프로필, 자기 과정만)은 화면마다 instructorPage 로,
// API 는 requireApiStaff("instructor") + ownedTarget 으로 다시 확인한다.
export default function InstructorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid max-w-[1296px] gap-10 px-5 pt-10 pb-24 md:grid-cols-[180px_1fr] md:px-14">
        <nav
          aria-label="강사 메뉴"
          className="flex gap-x-6 overflow-x-auto border-b border-line md:flex-col md:border-b-0"
        >
          <MonoLabel className="hidden text-xs text-signal md:block">Instructor</MonoLabel>
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
      <SiteFooter />
    </>
  );
}
