import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACT_STATE_LABEL } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { InstructorRemove } from "@/app/admin/courses/course-forms";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { adminInstructorList, INSTRUCTOR_STATUS } from "@/server/instructors";
import { requireStaff } from "@/server/session";
import { RegisterInstructorForm } from "./instructor-admin-forms";

export const metadata: Metadata = { title: "강사 관리" };

// AD-15 강사 관리: 목록(이어진 회원 · 상태 · 계약 · 과정 수) · 등록
export default async function AdminInstructors() {
  await requireStaff("operator", "/admin/instructors");
  const rows = await adminInstructorList(getDb());

  return (
    <>
      <PageTitle label="Instructors" title="강사">
        <p className="m-0">
          강사를 등록하고 계약 · 수익 비율 · 상태를 관리합니다. 가입한 회원과 이어야 강사 화면에 들어옵니다.
        </p>
      </PageTitle>
      <div className="surface data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="px-2 py-2.5">강사</th>
              <th className="px-2 py-2.5">회원</th>
              <th className="px-2 py-2.5">상태</th>
              <th className="px-2 py-2.5">계약</th>
              <th className="px-2 py-2.5 text-right">과정</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ instructor, nickname, courses, contract }) => {
              const status = INSTRUCTOR_STATUS[instructor.status];
              return (
                <tr key={instructor.id} className="border-b border-line">
                  <td className="px-2 py-3">
                    <Link href={`/admin/instructors/${instructor.id}`}>{instructor.displayName}</Link>
                  </td>
                  <td className="px-2 py-3">{nickname ?? <span className="text-ink-2">잇기 전</span>}</td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <StatusDot tone={status.tone}>{status.label}</StatusDot>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    {contract ? (
                      <StatusDot
                        tone={
                          contract.state === "active"
                            ? "done"
                            : contract.state === "unsigned"
                              ? "warn"
                              : "muted"
                        }
                      >
                        {CONTRACT_STATE_LABEL[contract.state]}
                      </StatusDot>
                    ) : (
                      <span className="text-ink-2">없음</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{courses}</td>
                  <td className="px-2 py-3 text-right">
                    {courses === 0 && !instructor.userId ? (
                      <InstructorRemove instructorId={instructor.id} name={instructor.displayName} />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="py-6 text-ink-2">등록한 강사가 없습니다.</p> : null}
      </div>
      <section className="mt-8 max-w-[560px] surface padded">
        <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">강사 등록</h2>
        <RegisterInstructorForm />
      </section>
    </>
  );
}
