// 공통 머리글 · 바닥글 (docs/화면상세기획.md 0.2)
import Link from "next/link";
import { buttonClass, Wordmark } from "@aionit/ui";
import { getViewer } from "@/server/session";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const nav = [
  { href: "/courses", label: "강의" },
  { href: "/subscribe", label: "구독" },
];

const navLink = "inline-flex min-h-11 items-center whitespace-nowrap text-ink no-underline";

export async function SiteHeader() {
  const viewer = await getViewer();
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex min-h-[72px] max-w-[1296px] flex-wrap items-center justify-between gap-x-6 px-5 pt-3 md:flex-nowrap md:gap-x-10 md:px-14 md:pt-0">
        <Link href="/" aria-label="AIONIT 홈" className="text-[22px] text-ink no-underline hover:text-ink">
          <Wordmark />
        </Link>
        {/* 좁은 화면: 메뉴는 둘째 줄로 내려간다 */}
        <nav
          aria-label="주 메뉴"
          className="order-last flex w-full gap-x-6 text-[15px] md:order-none md:w-auto md:flex-1 md:justify-end md:gap-x-8"
        >
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={navLink}>
              {item.label}
            </Link>
          ))}
          {viewer?.roles.includes("instructor") ? (
            <Link href="/instructor" className={navLink}>
              강사 화면
            </Link>
          ) : null}
          {viewer?.roles.includes("operator") ? (
            <Link href="/admin" className={navLink}>
              관리자
            </Link>
          ) : null}
          {viewer ? null : (
            <Link href="/login" className={navLink}>
              로그인
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-x-5 md:gap-x-6">
          {viewer ? (
            <>
              <Link href="/learn" className={`${navLink} text-[15px]`}>
                내 강의실
              </Link>
              <UserMenu nickname={viewer.nickname} />
            </>
          ) : (
            <Link href="/signup" className={buttonClass("primary", "md")}>
              무료로 시작하기
            </Link>
          )}
          {/* 밝게 · 어둡게 (학습 화면과 같은 버튼). 맨 오른쪽, 그림이 본문 오른쪽 끝에 맞도록 버튼 여백만큼 당긴다 */}
          <span className="-mr-3 flex">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line py-12">
      <div className="mx-auto flex max-w-[1296px] flex-wrap justify-between gap-7 px-5 text-[13px] leading-[1.9] text-ink-2 md:px-14">
        <div className="flex flex-col gap-2.5">
          <span className="text-lg text-ink">
            <Wordmark />
          </span>
          <span>[상호] · 대표 [이름] · 사업자등록번호 [번호] · 통신판매업 신고 [번호]</span>
        </div>
        <nav aria-label="정책" className="flex flex-wrap items-start gap-x-5 gap-y-2">
          <Link href="/policies/terms" className="text-ink-2">
            이용약관
          </Link>
          <Link href="/policies/privacy" className="font-semibold text-ink">
            개인정보처리방침
          </Link>
          <Link href="/policies/refund" className="text-ink-2">
            환불 정책
          </Link>
        </nav>
      </div>
    </footer>
  );
}
