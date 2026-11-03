// 상태는 색만으로 구분하지 않는다: 점 + 글 (docs/디자인시스템.md 4장)
import type { ReactNode } from "react";

type Tone = "done" | "warn" | "danger" | "muted";

const dot: Record<Tone, string> = {
  done: "bg-done",
  warn: "bg-warn",
  danger: "bg-danger",
  muted: "bg-ink-2",
};

export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
      <i aria-hidden="true" className={`inline-block h-[7px] w-[7px] ${dot[tone]}`} />
      {children}
    </span>
  );
}

/** 3px 진도 막대 + 접근성 값 */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-[3px] bg-line"
    >
      <div className="h-full bg-link" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 번호 · 구역 라벨 (Mono 대문자) */
export function MonoLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] tracking-[0.08em] uppercase ${className}`}>{children}</span>;
}
