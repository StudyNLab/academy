// 입력 부품 (docs/디자인시스템.md 4장): 높이 44, 라벨은 위, 오류는 테두리 + 아래 글 (색만으로 알리지 않는다)
import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
};

export const inputClass =
  "block min-h-11 w-full rounded-ui border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-2/70 focus-visible:border-primary aria-[invalid=true]:border-danger aria-[invalid=true]:border-2";

export function Field({ label, hint, error, id, className = "", ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
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
        <p id={hintId} className="m-0 text-[13px] leading-[1.6] text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="m-0 text-[13px] leading-[1.6] font-medium text-danger">
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
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-[15px] leading-[1.5] ${className}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--primary)]"
        {...rest}
      />
      <span>{children}</span>
    </label>
  );
}

type Tone = "info" | "done" | "warn" | "danger";

const toneBorder: Record<Tone, string> = {
  info: "border-signal",
  done: "border-done",
  warn: "border-warn",
  danger: "border-danger",
};

const toneLabel: Record<Tone, string> = { info: "안내", done: "완료", warn: "주의", danger: "오류" };

/** 화면 안 알림 (여백 메모처럼 위 2px 선 + 라벨). role 은 오류만 alert */
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
      className={`border-t-2 ${toneBorder[tone]} bg-surface px-4 py-3.5 text-[14px] leading-[1.7]`}
    >
      <p className="m-0 font-mono text-[11px] tracking-[0.08em] text-ink-2 uppercase">{toneLabel[tone]}</p>
      {title ? <p className="m-0 mt-1 font-semibold">{title}</p> : null}
      {children ? <div className="mt-1 text-ink-2">{children}</div> : null}
    </div>
  );
}
