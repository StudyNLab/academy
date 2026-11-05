// 교재 버전 한 개의 검사 결과 · 챕터 · 영상 자리 경고. 운영자 검수(AD-04)와 강사 확인(I-03 · I-05)이 같이 쓴다.
import Link from "next/link";
import type { PackageReport } from "@aionit/content";
import { Notice, StatusDot } from "@aionit/ui";
import type { adminVersion } from "@/server/catalog";
import type { ManageBase } from "./manage-base";

const CHANGE = {
  added: { tone: "done", label: "새 챕터" },
  changed: { tone: "warn", label: "본문 변경" },
  removed: { tone: "danger", label: "사라짐" },
  same: { tone: "muted", label: "변경 없음" },
} as const;

type VersionData = NonNullable<Awaited<ReturnType<typeof adminVersion>>>;

export function VersionReport({ data, base }: { data: VersionData; base: ManageBase }) {
  const { version, course, chapters, unlinked } = data;
  const report = version.validationReport as PackageReport | null;
  return (
    <>
      {report ? (
        <section className="mt-10 border-t border-line-strong pt-6">
          <h2 className="m-0 mb-4 text-[21px] font-semibold">자동 검사</h2>
          {report.ok ? (
            <Notice tone="done" title="구조 · 허용 목록 · 그림 검사 통과" />
          ) : (
            <Notice tone="danger" title={`오류 ${report.errors.length}개 — 고쳐서 다시 올려 주세요`} />
          )}
          {report.errors.length + report.warnings.length > 0 ? (
            <ul className="m-0 mt-4 flex list-none flex-col p-0 text-[14px]">
              {report.errors.map((issue, i) => (
                <li key={`e${i}`} className="border-b border-line py-2 break-words">
                  <span className="font-mono text-[12px] text-danger">오류 · {issue.code}</span>{" "}
                  {issue.message}
                  {issue.where ? <span className="text-ink-2"> ({issue.where})</span> : null}
                </li>
              ))}
              {report.warnings.slice(0, 50).map((issue, i) => (
                <li key={`w${i}`} className="border-b border-line py-2 break-words">
                  <span className="font-mono text-[12px] text-warn">경고 · {issue.code}</span> {issue.message}
                  {issue.where ? <span className="text-ink-2"> ({issue.where})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {report.skipped.length ? (
            <p className="mt-3 text-[13px] break-all text-ink-2">
              규격 밖이라 무시한 파일: {report.skipped.slice(0, 10).join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {chapters.length ? (
        <section className="mt-10 border-t border-line-strong pt-6">
          <h2 className="m-0 mb-4 text-[21px] font-semibold">챕터 · 미리보기</h2>
          {unlinked.length ? (
            <div className="mb-4">
              <Notice tone="warn" title={`영상 자리 ${unlinked.length}개가 아직 연결되지 않았습니다`}>
                공개는 막지 않습니다. 연결 안 된 자리는 수강생 화면에 보이지 않습니다:{" "}
                {unlinked.map((u) => u.key).join(", ")}
                {base === "/instructor" ? (
                  <>
                    {" "}
                    <Link href={`/instructor/courses/${course.id}#slots`}>영상 연결하기 →</Link>
                  </>
                ) : null}
              </Notice>
            </div>
          ) : null}
          <ul className="m-0 flex list-none flex-col p-0 text-[15px]">
            {chapters.map((chapter) => {
              const change = report?.diff?.find((d) => d.key === chapter.key)?.change;
              return (
                <li
                  key={chapter.key}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5"
                >
                  <Link href={`${base}/courses/${course.id}/versions/${version.id}/chapters/${chapter.key}`}>
                    <span className="font-mono text-[12px] text-ink-2">{chapter.key}</span> {chapter.title}
                  </Link>
                  {change ? <StatusDot tone={CHANGE[change].tone}>{CHANGE[change].label}</StatusDot> : null}
                </li>
              );
            })}
            {report?.diff
              ?.filter((d) => d.change === "removed")
              .map((d) => (
                <li key={d.key} className="flex justify-between border-b border-line py-2.5 text-ink-2">
                  <span>
                    <span className="font-mono text-[12px]">{d.key}</span> {d.title}
                  </span>
                  <StatusDot tone="danger">사라짐</StatusDot>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
