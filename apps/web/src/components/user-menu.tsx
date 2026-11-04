"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authApi } from "@/lib/client-api";

const item =
  "flex min-h-11 w-full items-center px-4 text-left text-[15px] text-ink no-underline hover:bg-sunken hover:text-ink";

/** 머리글 오른쪽 회원 메뉴 (닉네임 ▾, docs/화면상세기획.md 0.2) */
export function UserMenu({ nickname, unread = 0 }: { nickname: string; unread?: number }) {
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
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-ink"
      >
        {/* 좁은 화면: 머리글 한 줄(로고 · 내 강의실 · 닉네임 · 밝기 버튼)에 들어가도록 긴 닉네임은 … 로 줄인다 */}
        <span className="max-w-[6.5em] truncate md:max-w-[16em]">{nickname}</span>
        {unread > 0 ? (
          <span
            className="absolute top-2 -left-2.5 h-2 w-2 bg-signal md:hidden"
            aria-label={`읽지 않은 알림 ${unread}개`}
          />
        ) : null}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[200px] border border-line bg-surface py-1.5 shadow-float"
        >
          <Link role="menuitem" href="/my" className={item} onClick={() => setOpen(false)}>
            내 정보
          </Link>
          <Link
            role="menuitem"
            href="/my/notifications"
            className={`${item} md:hidden`}
            onClick={() => setOpen(false)}
          >
            알림{unread > 0 ? ` ${unread > 99 ? "99+" : unread}` : ""}
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
