import Link from "next/link";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

// P-11 페이지 없음 (notFound() · 없는 주소, 시안 #/error?type=404)
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main>
        <ResultPage
          eyebrow="SERVICE STATUS"
          title="페이지를 찾을 수 없습니다"
          desc="주소가 바뀌었거나 더는 볼 수 없는 페이지입니다."
          mark="404"
          actions={
            <>
              <Link className="btn primary" href="/courses">
                강의 둘러보기 <SvcIcon name="arrow" />
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
