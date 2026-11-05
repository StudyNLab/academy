"use client";

import Link from "next/link";
import { useRef } from "react";
import { authApi } from "@/lib/client-api";
import { SvcIcon } from "./icons";

export interface MenuLink {
  href: string;
  label: string;
}

/**
 * 좁은 화면(760px 이하) 머리글의 메뉴 단추 → 주 메뉴 대화상자 (시안 .mobile-menu · .mobile-nav-links).
 * 좁은 화면에서는 회원 메뉴(닉네임 ▾)가 숨으므로 로그인한 사람에게는 로그아웃도 여기에 둔다.
 */
export function MobileMenu({
  links,
  signedIn = false,
  unread = false,
}: {
  links: MenuLink[];
  signedIn?: boolean;
  /** 읽지 않은 알림이 있으면 단추에 점 */
  unread?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  async function logout() {
    await authApi("/sign-out");
    window.location.assign("/");
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn mobile-menu relative"
        aria-label={unread ? "메뉴 열기, 읽지 않은 알림 있음" : "메뉴 열기"}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <SvcIcon name="menu" />
        {unread ? (
          <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-brand" />
        ) : null}
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby="mobile-menu-title"
        // 바깥(흐린 바탕)을 누르면 닫는다
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
      >
        <div className="dialog-head">
          <h2 id="mobile-menu-title">AIONIT</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={close}>
            <SvcIcon name="close" />
          </button>
        </div>
        <div className="dialog-content">
          <nav className="mobile-nav-links" aria-label="전체 메뉴">
            {links.map((link) => (
              <Link key={link.href} href={link.href} onClick={close}>
                {link.label}
                <SvcIcon name="arrow" />
              </Link>
            ))}
            {signedIn ? (
              <button
                type="button"
                onClick={logout}
                className="flex items-center justify-between border-b border-line py-4 text-left text-[16px]"
              >
                로그아웃
              </button>
            ) : null}
          </nav>
        </div>
      </dialog>
    </>
  );
}
