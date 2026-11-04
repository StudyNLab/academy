"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@aionit/ui";
import { api } from "@/lib/client-api";

/** 구매하기 · 연장권: 주문(가격 스냅샷)을 만들고 주문서(C-01)로. 로그인 전이면 로그인 뒤 이 화면으로 돌아온다 */
export function BuyButton({
  productId,
  label,
  loggedIn,
  returnTo,
  variant = "primary",
  size = "lg",
  className = "w-full",
}: {
  productId: string;
  label: string;
  loggedIn: boolean;
  returnTo: string;
  variant?: "primary" | "outline";
  size?: "lg" | "md" | "sm";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!loggedIn) return router.push(`/login?next=${encodeURIComponent(returnTo)}`);
    setBusy(true);
    setError(null);
    const result = await api<{ orderId: string }>("/orders", { productId });
    if (!result.ok) {
      setBusy(false);
      if (result.error.status === 401) return router.push(`/login?next=${encodeURIComponent(returnTo)}`);
      return setError(result.error.message);
    }
    router.push(`/checkout/${result.data.orderId}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className={buttonClass(variant, size, className)}
      >
        {busy ? "주문서를 여는 중…" : label}
      </button>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
