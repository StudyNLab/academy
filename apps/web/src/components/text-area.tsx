"use client";

import { useId } from "react";
import { inputClass } from "@aionit/ui";

/** 여러 줄 입력 (라벨은 위, Field 와 같은 모양) */
export function TextArea({
  label,
  value,
  onChange,
  rows = 8,
  maxLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        className={`${inputClass} py-2.5 font-[inherit] leading-[1.6]`}
      />
      {hint ? <p className="m-0 text-[13px] leading-[1.6] text-ink-2">{hint}</p> : null}
    </div>
  );
}
