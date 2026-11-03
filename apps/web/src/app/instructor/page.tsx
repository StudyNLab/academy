import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { PageTitle } from "@/components/page-title";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "강사 화면" };

// I-01 강사 대시보드 자리. M1 은 들어오는 조건(강사 역할 + 2단계 인증)만, 내용은 M8 에서
export default async function InstructorHome() {
  const viewer = await requireStaff("instructor", "/instructor");
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1296px] px-5 pt-16 md:px-14">
        <PageTitle label="Instructor" title={`${viewer.nickname} 강사님`}>
          <p className="m-0">
            내 강의 · Q&A 답변 · 판매 현황 · 정산 내역은 다음 단계(M8)에서 이곳에 생깁니다.
          </p>
        </PageTitle>
      </main>
      <SiteFooter />
    </>
  );
}
