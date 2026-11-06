import type { ReactNode } from "react";
import { StaffLayout } from "@/components/staff-layout";

const menu = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/courses", label: "과정" },
  { href: "/admin/reviews", label: "검수 대기" },
  { href: "/admin/instructors", label: "강사" },
  { href: "/admin/users", label: "회원" },
  { href: "/admin/products", label: "상품 · 가격" },
  { href: "/admin/subscriptions", label: "구독" },
  { href: "/admin/refunds", label: "환불" },
  { href: "/admin/settlements", label: "정산" },
  { href: "/admin/inquiries", label: "1:1 문의" },
  { href: "/admin/qna", label: "Q&A 관리" },
  { href: "/admin/notices", label: "공지 · FAQ" },
  { href: "/admin/policies", label: "정책 문서" },
  { href: "/admin/logs", label: "기록" },
];

// 관리자 화면 (시안 운영 공간 공통 틀). 권한(운영자 + 2단계 인증 + 이 세션 OTP 통과)은 화면마다 requireStaff 로,
// API 는 requireApiStaff 로 다시 확인한다.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <StaffLayout icon="shield" title="운영 공간" menuLabel="관리자 메뉴" items={menu} footer={false}>
      {children}
    </StaffLayout>
  );
}
