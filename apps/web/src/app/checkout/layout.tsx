import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const metadata: Metadata = { title: "주문서", robots: { index: false } };

// C-01 주문서 · C-03 결제 완료 / 실패 (시안 #/checkout · #/result, 화면마다 .wrap.page-main). 로그인 확인은 화면마다 한다
export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
