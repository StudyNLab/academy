import type { ReactNode } from "react";
import { StaffLayout } from "@/components/staff-layout";

const menu = [
  { href: "/instructor", label: "대시보드" },
  { href: "/instructor/courses", label: "내 강의" },
  { href: "/instructor/qna", label: "Q&A 답변" },
  { href: "/instructor/settlements", label: "정산" },
  { href: "/instructor/profile", label: "정산 정보 · 프로필" },
];

// 강사 화면 (시안 강사 공간 공통 틀). 권한(강사 역할 + 2단계 인증 + 이어진 강사 프로필, 자기 과정만)은 화면마다 instructorPage 로,
// API 는 requireApiStaff("instructor") + ownedTarget 으로 다시 확인한다.
export default function InstructorLayout({ children }: { children: ReactNode }) {
  return (
    <StaffLayout icon="code" title="강사 공간" menuLabel="강사 메뉴" items={menu}>
      {children}
    </StaffLayout>
  );
}
