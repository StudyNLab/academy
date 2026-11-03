import type { ReactNode } from "react";
import { MonoLabel } from "@aionit/ui";

/** 화면 제목: Mono 라벨 + 제목 + 소개 문단 */
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
    <div className="mb-8 flex flex-col gap-3">
      <MonoLabel className="text-xs text-signal">{label}</MonoLabel>
      <h1 className="m-0 text-[32px] leading-[1.2] font-semibold tracking-[-0.035em] md:text-[40px]">
        {title}
      </h1>
      {children ? <div className="m-0 text-[16px] leading-[1.75] text-ink-2">{children}</div> : null}
    </div>
  );
}
