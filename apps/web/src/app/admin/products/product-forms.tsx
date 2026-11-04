"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

const select = "min-h-11 rounded-ui border border-line bg-surface px-3 text-[15px] font-normal";

/** datetime-local (KST 로 적은 값) ➔ ISO. 비우면 지금부터 */
function kstInputToIso(value: string): string | null {
  return value ? new Date(`${value}:00+09:00`).toISOString() : null;
}

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(path: string, body: unknown, done?: () => void) {
    setBusy(true);
    setError(null);
    const result = await api(path, body);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    done?.();
    router.refresh();
  }
  return { error, busy, send };
}

export function NewProductForm({ courses }: { courses: { id: string; title: string }[] }) {
  const { error, busy, send } = useSubmit();
  const [type, setType] = useState<"course" | "extension">("course");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [name, setName] = useState("");
  const [days, setDays] = useState("365");
  const [amount, setAmount] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(
      "/admin/products",
      { type, courseId, name, accessDays: days ? Number(days) : null, amount: Number(amount) },
      () => {
        setName("");
        setAmount("");
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-line-strong pt-5">
      <h2 className="m-0 text-[19px] font-semibold">상품 만들기</h2>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          종류
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as "course" | "extension";
              setType(next);
              setDays(next === "extension" ? "90" : "365");
            }}
            className={select}
          >
            <option value="course">단건 강의</option>
            <option value="extension">연장권</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          과정
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={select}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Field
        label="상품 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="예: AI Agent 개발 · 초급 (1년)"
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={type === "extension" ? "늘리는 날수" : "수강 기간 (일, 비우면 무제한)"}
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
          required={type === "extension"}
        />
        <Field
          label="가격 (원, 부가세 포함)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={busy || !courseId || !name.trim() || !amount}
        className="self-start"
      >
        상품 만들기
      </Button>
    </form>
  );
}

export function NewPriceForm({ productId }: { productId: string }) {
  const { error, busy, send } = useSubmit();
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(
          `/admin/products/${productId}/prices`,
          { amount: Number(amount), effectiveFrom: kstInputToIso(from) },
          () => {
            setAmount("");
            setFrom("");
          },
        );
      }}
      className="flex flex-col gap-3"
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="새 가격 (원)"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
        required
      />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        시행 시각 (KST, 비우면 지금부터)
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={select}
        />
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={busy || !amount} className="self-start">
        새 가격 저장
      </Button>
    </form>
  );
}

export function ProductStatusButton({
  productId,
  status,
}: {
  productId: string;
  status: "on_sale" | "stopped";
}) {
  const { error, busy, send } = useSubmit();
  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void send(`/admin/products/${productId}`, { status: status === "on_sale" ? "stopped" : "on_sale" })
        }
        className="self-start text-[14px] text-ink-2 underline"
      >
        {status === "on_sale" ? "판매 멈추기" : "다시 판매하기"}
      </button>
    </div>
  );
}

export function DiscountForm({
  current,
  history,
}: {
  current: number | null;
  history: { id: string; rate: number; from: string }[];
}) {
  const { error, busy, send } = useSubmit();
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send("/admin/discounts", { ratePercent: Number(rate), effectiveFrom: kstInputToIso(from) }, () =>
          setRate(""),
        );
      }}
      className="flex flex-col gap-4 border-t border-line-strong pt-5"
    >
      <h2 className="m-0 text-[19px] font-semibold">구독자 할인 (프리미엄 강의)</h2>
      <p className="m-0 text-[14px] text-ink-2">
        지금 {current === null ? "없음" : `${current}%`}. 구독 중인 사람이 구독에 포함되지 않은 강의를 살 때
        적용합니다.
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="할인율 (%)"
          inputMode="numeric"
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/\D/g, ""))}
          required
        />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          시행 시각 (KST)
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={select}
          />
        </label>
      </div>
      <Button type="submit" variant="outline" disabled={busy || !rate} className="self-start">
        할인율 저장
      </Button>
      {history.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-ink-2">
          {history.map((h) => (
            <li key={h.id}>
              {h.from} 부터 {h.rate}%
            </li>
          ))}
        </ol>
      ) : null}
    </form>
  );
}
