"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SvcIcon } from "@/components/icons";

/** 마이페이지 왼쪽 메뉴 (시안 .account-sidebar nav). 지금 화면(아래 화면 포함)은 aria-current */
export function AccountNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const current = (href: string) =>
    href === "/my" ? pathname === "/my" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="마이페이지">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={current(item.href) ? "active" : ""}
          aria-current={current(item.href) ? "page" : undefined}
        >
          {item.label}
          <SvcIcon name="chevron" />
        </Link>
      ))}
    </nav>
  );
}
