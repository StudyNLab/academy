import type { Metadata } from "next";
import type { ReactNode } from "react";

// 화면(page.tsx)이 클라이언트 컴포넌트라 탭 제목은 여기서 준다
export const metadata: Metadata = { title: "비밀번호 찾기" };

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
