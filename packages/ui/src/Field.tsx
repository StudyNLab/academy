// 입력 부품 (docs/디자인시스템.md 0 · 4장): 모양은 시안 .field-label · .field · .field-hint · .check-item · .notice
// (apps/web/src/app/site.css). 높이 44, 라벨은 위, 오류는 테두리 + 아래 글 (색만으로 알리지 않는다)
import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
};

export const inputClass =
  "field block min-h-11 focus-visible:border-primary aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger";

export function Field({ label, hint, error, id, className = "", ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={inputId} className="field-label m-0">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
        {...rest}
      />
      {hint && !error ? (
        <p id={hintId} className="field-hint m-0">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-hint m-0 font-medium text-danger">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { children: ReactNode };

/** 체크 상자 + 글. 손가락 영역 44 이상 */
export function Checkbox({ children, className = "", ...rest }: CheckboxProps) {
  return (
    <label className={`check-item min-h-11 ${className}`}>
      <input type="checkbox" className="mt-[5px]" {...rest} />
      <span>{children}</span>
    </label>
  );
}

type Tone = "info" | "done" | "warn" | "danger";

/** 시안 .notice (info) · .notice.warn. done · danger 는 시안에 없어 globals.css 에서 토큰으로 만들었다 */
const toneClass: Record<Tone, string> = { info: "", done: "done", warn: "warn", danger: "danger" };

const toneLabel: Record<Tone, string> = { info: "안내", done: "완료", warn: "주의", danger: "오류" };

/** 화면 안 알림 (시안 .notice: 왼쪽 선 + 옅은 바탕). 색만으로 알리지 않게 작은 라벨을 둔다. role 은 오류만 alert */
export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={["notice", toneClass[tone], "text-[14px] leading-[1.75]"].filter(Boolean).join(" ")}
    >
      <p className="m-0 mb-1 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
        {toneLabel[tone]}
      </p>
      {title ? <strong>{title}</strong> : null}
      {children ? <div className="text-muted">{children}</div> : null}
    </div>
  );
}
