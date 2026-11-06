"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SvcIcon } from "@/components/icons";

/**
 * 왼쪽 메뉴 (시안 .account-sidebar nav · .staff-sidebar nav). 지금 화면(아래 화면 포함)은 aria-current.
 * root(첫 항목 주소)는 그 주소일 때만 지금 화면으로 본다
 */
export function SideNav({
  items,
  label,
  root,
  chevron = false,
}: {
  items: { href: string; label: string }[];
  label: string;
  root: string;
  chevron?: boolean;
}) {
  const pathname = usePathname();
  const current = (href: string) =>
    href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={current(item.href) ? "active" : ""}
          aria-current={current(item.href) ? "page" : undefined}
        >
          {item.label}
          {chevron ? <SvcIcon name="chevron" /> : null}
        </Link>
      ))}
    </nav>
  );
}
