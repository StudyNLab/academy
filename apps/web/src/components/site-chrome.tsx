// 공통 머리글 · 바닥글 (docs/화면상세기획.md 0.2). 머리글 모양은 aionit-design v2-2026-11-06 components/header.html,
// 바닥글은 시안 AIONIT-Service 의 .site-footer (app/site.css)
import Link from "next/link";
import { LogoWord } from "@aionit/ui";
import { getDb } from "@/server/db";
import { unreadCount } from "@/server/notifications";
import { getViewer } from "@/server/session";
import type { Viewer } from "@/server/viewer";
import { SvcIcon } from "./icons";
import type { MenuLink } from "./mobile-menu";
import { MobileMenu } from "./mobile-menu";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const nav: MenuLink[] = [
  { href: "/courses", label: "강의 둘러보기" },
  { href: "/subscribe", label: "구독 안내" },
  { href: "/faq", label: "이용 안내" },
];

/** 강사 · 운영자에게만 보이는 업무 화면 링크 (권한은 각 화면이 다시 확인한다) */
function staffLinks(viewer: Viewer | null): MenuLink[] {
  return [
    ...(viewer?.roles.includes("instructor") ? [{ href: "/instructor", label: "강사 화면" }] : []),
    ...(viewer?.roles.includes("operator") ? [{ href: "/admin", label: "관리자" }] : []),
  ];
}

function Logo() {
  return (
    <Link href="/" className="logo" aria-label="AIONIT 홈">
      <LogoWord />
    </Link>
  );
}

export async function SiteHeader() {
  const viewer = await getViewer();
  const unread = viewer ? await unreadCount(getDb(), viewer.userId) : 0;
  const staff = staffLinks(viewer);
  const unreadText = unread > 99 ? "99+" : String(unread);
  // 좁은 화면 메뉴: 주 메뉴 + 계정 + 업무 화면
  const menu: MenuLink[] = [
    ...nav,
    { href: "/learn", label: "내 강의실" },
    ...(viewer
      ? [
          { href: "/my", label: "마이페이지" },
          { href: "/my/notifications", label: unread > 0 ? `알림 ${unreadText}` : "알림" },
        ]
      : [
          { href: "/login", label: "로그인" },
          { href: "/signup", label: "회원가입" },
        ]),
    ...staff,
  ];

  return (
    <header className="site-header">
      <div className="wrap nav">
        <Logo />
        <nav className="nav-links" aria-label="주 메뉴">
          {[...nav, ...staff].map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          {viewer ? (
            <>
              {/* 좁은 화면에서는 머리글 한 줄에 들어가도록 숨기고, 메뉴 단추의 점 · 메뉴 안 "알림 n" 으로 보인다 */}
              <Link
                href="/my/notifications"
                className="icon-btn relative max-[760px]:hidden"
                aria-label={unread > 0 ? `알림, 읽지 않은 알림 ${unreadText}개` : "알림"}
              >
                <SvcIcon name="bell" />
                {unread > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1 -right-1 h-[18px] min-w-[18px] rounded-full bg-brand px-1 text-center text-[11px] leading-[18px] font-semibold text-on-primary tabular-nums"
                  >
                    {unreadText}
                  </span>
                ) : null}
              </Link>
              <UserMenu nickname={viewer.nickname} />
            </>
          ) : (
            <Link href="/login" className="nav-login">
              로그인
            </Link>
          )}
          <ThemeToggle className="icon-btn theme-btn" />
          <Link href="/learn" className="classroom">
            내 강의실 <span aria-hidden="true">↗</span>
          </Link>
          <MobileMenu links={menu} signedIn={!!viewer} unread={unread > 0} />
        </div>
      </div>
    </header>
  );
}

/**
 * P-10 사업자 정보 (서버 설정 BUSINESS_*, server/env.ts). 정하기 전에는 빈칸 표시.
 * 빌드 때 미리 그리는 화면에도 들어가므로 getEnv(필수 값 검사) 대신 process.env 를 바로 읽는다
 */
function businessLine(): string[] {
  const env = process.env;
  const blank = "[운영자 입력]";
  return [
    `${env.BUSINESS_NAME || blank} · 대표 ${env.BUSINESS_OWNER || blank}`,
    `사업자등록번호 ${env.BUSINESS_REG_NO || blank} · 통신판매업 신고 ${env.BUSINESS_MAIL_ORDER_NO || blank}`,
    `${env.BUSINESS_ADDRESS || `주소 ${blank}`} · ${env.BUSINESS_CONTACT || `연락처 ${blank}`}`,
  ];
}

export async function SiteFooter() {
  const staff = staffLinks(await getViewer());
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <Logo />
          <nav className="footer-links" aria-label="정책">
            <Link href="/policies/terms">이용약관</Link>
            <Link href="/policies/privacy_policy">
              <strong>개인정보처리방침</strong>
            </Link>
            <Link href="/policies/refund">환불 정책</Link>
            <Link href="/my/inquiries/new">문의하기</Link>
          </nav>
        </div>
        <p className="business-info">
          {businessLine().map((line, i) => (
            <span key={line}>
              {i > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
        <div className="footer-bottom">
          <span>© AIONIT. Build your next.</span>
          <div className="row gap16">
            <Link href="/notices">공지사항</Link>
            <Link href="/faq">자주 묻는 질문</Link>
            {staff.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
