"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authApi } from "@/lib/client-api";
import { SvcIcon } from "./icons";

const item =
  "flex min-h-11 w-full items-center px-4 text-left text-[15px] font-normal text-ink no-underline hover:bg-soft hover:text-ink";

/**
 * 머리글 오른쪽 회원 메뉴 (닉네임 ▾, docs/화면상세기획.md 0.2). 시안의 "마이페이지" 자리(.nav-login)에 둔다.
 * 좁은 화면에서는 .nav-login 이 숨고, 같은 메뉴를 MobileMenu 가 보여 준다.
 */
export function UserMenu({ nickname }: { nickname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function logout() {
    await authApi("/sign-out");
    window.location.assign("/");
  }

  return (
    <div ref={ref} className="nav-login relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1 text-ink"
      >
        <span className="max-w-[12em] truncate">{nickname}</span>
        <SvcIcon name="chevron" className="!h-4 !w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 min-w-[200px] overflow-hidden rounded-[9px] border border-line bg-surface py-1.5 shadow-float"
        >
          <Link role="menuitem" href="/my" className={item} onClick={() => setOpen(false)}>
            내 정보
          </Link>
          <Link role="menuitem" href="/my/entitlements" className={item} onClick={() => setOpen(false)}>
            수강권
          </Link>
          <Link role="menuitem" href="/my/subscription" className={item} onClick={() => setOpen(false)}>
            구독 관리
          </Link>
          <Link role="menuitem" href="/my/payments" className={item} onClick={() => setOpen(false)}>
            결제 내역
          </Link>
          <Link role="menuitem" href="/my/questions" className={item} onClick={() => setOpen(false)}>
            내 질문
          </Link>
          <Link role="menuitem" href="/my/inquiries" className={item} onClick={() => setOpen(false)}>
            1:1 문의
          </Link>
          <Link role="menuitem" href="/my/security" className={item} onClick={() => setOpen(false)}>
            로그인 · 보안
          </Link>
          <button role="menuitem" type="button" className={`${item} border-t border-line`} onClick={logout}>
            로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}
