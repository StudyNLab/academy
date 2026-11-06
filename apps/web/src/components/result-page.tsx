import type { ReactNode } from "react";
import { SvcIcon } from "@/components/icons";

/**
 * 결과 · 상태 화면 (시안 #/result · #/error 의 .page-heading + .result-card).
 * 결제 · 구독 결과, 권한 없음 · 없는 페이지 같은 한 장짜리 안내에 쓴다.
 */
export function ResultPage({
  eyebrow,
  title,
  desc,
  mark,
  heading,
  body,
  items,
  actions,
  foot,
  status = false,
}: {
  eyebrow: string;
  title: string;
  desc?: ReactNode;
  /** 큰 표시: "done" · "fail" 은 아이콘, 그 밖의 글(403 · PAUSED 등)은 큰 글자 */
  mark?: string;
  heading?: ReactNode;
  body?: ReactNode;
  /** 주문 번호 · 금액 같은 이름 · 값 줄 */
  items?: [string, ReactNode][];
  actions?: ReactNode;
  foot?: ReactNode;
  /** 처리 중처럼 바뀌는 안내면 화면 읽기 프로그램에 알린다 */
  status?: boolean;
}) {
  return (
    <div className="wrap page-main" role={status ? "status" : undefined}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {desc ? <p>{desc}</p> : null}
        </div>
      </div>
      <section className="result-card">
        {mark === "done" || mark === "fail" ? (
          <div className={`result-symbol ${mark === "fail" ? "fail" : ""}`} aria-hidden="true">
            <SvcIcon name={mark === "fail" ? "close" : "check"} />
          </div>
        ) : mark ? (
          <div className="error-number" aria-hidden="true">
            {mark}
          </div>
        ) : null}
        {heading ? <h2>{heading}</h2> : null}
        {body ? <div className="text-muted">{body}</div> : null}
        {items && items.length > 0 ? (
          <dl className="key-values">
            {items.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {actions ? <div className="result-actions">{actions}</div> : null}
        {foot}
      </section>
    </div>
  );
}
