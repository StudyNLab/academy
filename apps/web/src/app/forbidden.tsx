import type { Metadata } from "next";
import Link from "next/link";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const metadata: Metadata = { title: "권한 없음" };

// P-11 권한 없음 (forbidden() 이 부른다, 시안 #/error?type=403)
export default function Forbidden() {
  return (
    <>
      <SiteHeader />
      <main>
        <ResultPage
          eyebrow="SERVICE STATUS"
          title="이 화면을 볼 권한이 없습니다"
          desc="운영자 · 강사 전용 화면입니다. 권한이 있어야 하는데 이 화면이 보이면 운영자에게 알려 주세요."
          mark="403"
          actions={
            <>
              <Link className="btn primary" href="/learn">
                내 강의실 <SvcIcon name="arrow" />
              </Link>
              <Link className="btn secondary" href="/my/inquiries/new">
                문의하기 <SvcIcon name="arrow" />
              </Link>
            </>
          }
          foot={
            <Link className="small-link block" href="/">
              홈으로 돌아가기
            </Link>
          }
        />
      </main>
      <SiteFooter />
    </>
  );
}
