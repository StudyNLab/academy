import Link from "next/link";
import type { ReactNode } from "react";
import type { IconName } from "@/components/icons";
import { SvcIcon } from "@/components/icons";
import { SideNav } from "@/components/side-nav";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

/** 강사 · 관리자 화면 공통 틀 (시안 .staff-layout: 왼쪽 업무 메뉴 + 오른쪽 내용) */
export function StaffLayout({
  title,
  icon,
  menuLabel,
  items,
  footer = true,
  children,
}: {
  title: string;
  icon: IconName;
  menuLabel: string;
  items: { href: string; label: string }[];
  /** 바닥글 (관리자 화면은 업무 화면이라 두지 않는다) */
  footer?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      {/* 본문(main)은 오른쪽 내용만. 왼쪽 업무 메뉴는 main 밖 (같은 글이 본문에 두 번 잡히지 않게) */}
      <div className="staff-layout">
        <aside className="staff-sidebar">
          <div className="staff-role">
            <SvcIcon name={icon} />
            <div>
              <strong>{title}</strong>
              <small>AIONIT WORKSPACE</small>
            </div>
          </div>
          <SideNav items={items} label={menuLabel} root={items[0]!.href} />
          <Link className="sidebar-foot" href="/learn">
            <SvcIcon name="back" /> 수강생으로 전환
          </Link>
          <p className="field-hint">운영 처리는 사유와 함께 기록합니다.</p>
        </aside>
        <main className="staff-content">{children}</main>
      </div>
      {footer ? <SiteFooter /> : null}
    </>
  );
}
