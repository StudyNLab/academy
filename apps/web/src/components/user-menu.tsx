"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authApi } from "@/lib/client-api";

const item =
  "flex min-h-11 w-full items-center px-4 text-left text-[15px] text-ink no-underline hover:bg-sunken hover:text-ink";

/** 머리글 오른쪽 회원 메뉴 (닉네임 ▾). 수강권 · 결제 내역 등은 해당 단계에서 더한다 */
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
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-ink"
      >
        {nickname} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[200px] border border-line bg-surface py-1.5 shadow-float"
        >
          <Link role="menuitem" href="/my" className={item} onClick={() => setOpen(false)}>
            내 정보
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
