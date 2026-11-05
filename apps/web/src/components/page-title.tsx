import type { ReactNode } from "react";

/** 화면 제목 (시안 .page-heading): 영문 라벨 + 제목 + 소개 문단 */
export function PageTitle({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{label}</span>
        <h1>{title}</h1>
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}
