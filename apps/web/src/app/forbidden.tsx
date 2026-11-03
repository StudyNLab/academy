import Link from "next/link";
import { MonoLabel } from "@aionit/ui";

// P-11 권한 없음 (forbidden() 이 부른다)
export default function Forbidden() {
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 pt-24">
      <MonoLabel className="text-xs text-signal">403 · Forbidden</MonoLabel>
      <h1 className="m-0 text-[36px] font-semibold tracking-[-0.035em]">이 화면을 볼 권한이 없습니다</h1>
      <p className="m-0 text-[16px] leading-[1.75] text-ink-2">
        운영자 · 강사 전용 화면입니다. 권한이 있어야 하는데 이 화면이 보이면 운영자에게 알려 주세요.
      </p>
      <Link href="/">홈으로</Link>
    </main>
  );
}
