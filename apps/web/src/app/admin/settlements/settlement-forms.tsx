"use client";

// AD-16 정산 관리 입력: 계산 · 확정 · 지급 기록 · 계좌 보기 · 이의 신청 답변 · 조정 · 배분 정책 새 버전
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button, Field, inputClass, Notice } from "@aionit/ui";
import { api, apiGet } from "@/lib/client-api";

type Message = { tone: "done" | "danger"; text: string } | null;

function useSubmit(path: string) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function send(body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await api(path, body);
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: result.error.message });
      return false;
    }
    setMessage({ tone: "done", text: done });
    router.refresh();
    return true;
  }
  return { message, busy, send };
}

function Frame({ message, children }: { message: Message; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {children}
    </div>
  );
}

export function CalculateForm({ suggested }: { suggested: string }) {
  const [month, setMonth] = useState(suggested);
  const { message, busy, send } = useSubmit("/admin/settlements");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ month }, `${month} 정산을 계산했습니다. 검토한 뒤 확정해 주세요.`);
      }}
    >
      <Frame message={message}>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="정산 월"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
            className="w-[200px]"
          />
          <Button type="submit" disabled={busy || !month}>
            {busy ? "계산 중…" : "계산"}
          </Button>
        </div>
        <p className="m-0 text-[13px] text-ink-2">
          확정 전이면 몇 번이든 다시 계산합니다 (그사이의 환불 · 학습 시간이 반영됩니다). 매월 2일 05:00 에
          지난달을 자동으로 계산합니다.
        </p>
      </Frame>
    </form>
  );
}

export function ConfirmButton({ month, count, total }: { month: string; count: number; total: string }) {
  const { message, busy, send } = useSubmit(`/admin/settlements/${month}/confirm`);
  return (
    <Frame message={message}>
      <Button
        disabled={busy}
        className="self-start"
        onClick={() => {
          if (
            !window.confirm(
              `${month} 정산을 확정할까요?\n강사 ${count}명 · 지급 예정 ${total}\n확정하면 강사에게 명세가 공개되고, 금액은 더 바꿀 수 없습니다 (고칠 것은 다음 달 조정으로).`,
            )
          )
            return;
          void send({}, "확정했습니다. 강사에게 명세를 공개하고 알림을 보냈습니다.");
        }}
      >
        확정 · 명세 공개
      </Button>
    </Frame>
  );
}

export function PayoutForm({
  settlementId,
  today,
  amount,
}: {
  settlementId: string;
  today: string;
  amount: string;
}) {
  const [paidOn, setPaidOn] = useState(today);
  const [memo, setMemo] = useState("");
  const { message, busy, send } = useSubmit(`/admin/settlements/items/${settlementId}`);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !window.confirm(
            `${amount} 을(를) ${paidOn} 에 보낸 것으로 기록할까요? 지급 기록은 고칠 수 없습니다.`,
          )
        )
          return;
        void send({ paidOn, memo }, "지급을 기록했습니다. 강사에게 알렸습니다.");
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="보낸 날"
            type="date"
            max={today}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
          <Field
            label="메모 (이체 은행 · 확인 번호 등)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        <p className="m-0 text-[13px] text-ink-2">
          돈은 시스템 밖에서 계좌이체로 보내고, 여기에는 일자 · 금액 · 담당자만 남깁니다. 금액은 지급 예정액(
          {amount}) 그대로입니다.
        </p>
        <Button type="submit" disabled={busy || !paidOn} className="self-start">
          지급 기록
        </Button>
      </Frame>
    </form>
  );
}

/** 계좌번호 원문은 누를 때만 (부를 때마다 개인정보 조회 기록) */
export function AccountReveal({ settlementId }: { settlementId: string }) {
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      {account ? (
        <span className="font-mono text-[15px]">{account}</span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const result = await apiGet<{ account: string }>(
              `/admin/settlements/items/${settlementId}/account`,
            );
            if (result.ok) setAccount(result.data.account);
            else setError(result.error.message);
          }}
        >
          계좌번호 보기 (조회 기록)
        </Button>
      )}
      {error ? <span className="text-[13px] text-danger">{error}</span> : null}
    </span>
  );
}

export function AnswerForm({ objectionId }: { objectionId: string }) {
  const [answer, setAnswer] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const { message, busy, send } = useSubmit(`/admin/settlement-objections/${objectionId}`);
  const amount = adjustment.trim() === "" ? 0 : Number(adjustment.replaceAll(",", ""));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ answer, adjustment: amount }, "답변했습니다. 강사에게 알렸습니다.");
      }}
    >
      <Frame message={message}>
        <label className="flex flex-col gap-2 text-[14px] font-medium">
          답변 (강사에게 보입니다)
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            className={`${inputClass} font-normal`}
            required
          />
        </label>
        <Field
          label="다음 달 정산에 넣을 조정 금액 (원, 뺄 때는 -, 없으면 비움)"
          value={adjustment}
          onChange={(e) => setAdjustment(e.target.value)}
          inputMode="numeric"
          placeholder="0"
          error={Number.isInteger(amount) ? undefined : "원 단위 정수로 적어 주세요."}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={busy || answer.trim().length < 2 || !Number.isInteger(amount)}
          className="self-start"
        >
          답변
        </Button>
      </Frame>
    </form>
  );
}

export function AdjustmentForm({ instructors }: { instructors: { id: string; name: string }[] }) {
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const { message, busy, send } = useSubmit("/admin/settlement-adjustments");
  const value = Number(amount.replaceAll(",", ""));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(
          { instructorId, amount: value, reason },
          "조정을 남겼습니다. 다음에 계산하는 달에 들어갑니다.",
        );
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-[14px] font-medium">
            강사
            <select
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              className={`${inputClass} font-normal`}
            >
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="금액 (원, 뺄 때는 -)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            required
          />
        </div>
        <Field
          label="사유 (강사에게 보입니다)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        <Button
          type="submit"
          variant="outline"
          disabled={
            busy || !instructorId || !Number.isInteger(value) || value === 0 || reason.trim().length < 2
          }
          className="self-start"
        >
          조정 남기기
        </Button>
      </Frame>
    </form>
  );
}

export function DefaultPolicyForm({
  tomorrow,
  current,
}: {
  tomorrow: string;
  current: { single: string; pool: string; fee: string; capHours: string };
}) {
  const [singleRate, setSingle] = useState(current.single);
  const [poolRate, setPool] = useState(current.pool);
  const [pgFeeRate, setFee] = useState(current.fee);
  const [dailyCapHours, setCap] = useState(current.capHours);
  const [effectiveOn, setEffectiveOn] = useState(tomorrow);
  const [note, setNote] = useState("");
  const { message, busy, send } = useSubmit("/admin/revenue-policies");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(
          { scope: "default", singleRate, poolRate, pgFeeRate, dailyCapHours, effectiveOn, note },
          "새 기본 정책을 등록했습니다. 강사들에게 알렸습니다.",
        );
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="단건 강사 비율 (%)"
            value={singleRate}
            onChange={(e) => setSingle(e.target.value)}
            inputMode="decimal"
            required
          />
          <Field
            label="구독 강사 풀 비율 (%)"
            value={poolRate}
            onChange={(e) => setPool(e.target.value)}
            inputMode="decimal"
            required
          />
          <Field
            label="추정 결제 수수료율 (%)"
            value={pgFeeRate}
            onChange={(e) => setFee(e.target.value)}
            inputMode="decimal"
            hint="결제에 실제 수수료가 기록되지 않았을 때만 씁니다."
            required
          />
          <Field
            label="유효 학습 시간 하루 상한 (시간)"
            value={dailyCapHours}
            onChange={(e) => setCap(e.target.value)}
            inputMode="decimal"
            hint="수강생 1명 · 과정 1개 · 하루"
            required
          />
          <Field
            label="시행일"
            type="date"
            min={tomorrow}
            value={effectiveOn}
            onChange={(e) => setEffectiveOn(e.target.value)}
            required
          />
          <Field
            label="이름 · 메모 (예: 기본 정책 v2)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <p className="m-0 text-[13px] text-ink-2">
          고치지 않고 새 버전으로 쌓입니다. 시행일(0시, KST) 이후 매출부터 적용되고, 이미 확정된 정산은 바뀌지
          않습니다. 강사에게 불리한 변경(비율을 내리거나 수수료율을 올림)은 30일 뒤부터 시행할 수 있습니다.
        </p>
        <Button type="submit" disabled={busy || !note.trim()} className="self-start">
          기본 정책 새 버전 등록
        </Button>
      </Frame>
    </form>
  );
}

export function CoursePolicyForm({
  tomorrow,
  courses,
}: {
  tomorrow: string;
  courses: { id: string; title: string }[];
}) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [singleRate, setSingle] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(tomorrow);
  const [note, setNote] = useState("");
  const { message, busy, send } = useSubmit("/admin/revenue-policies");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(
          { scope: "course", courseId, singleRate: singleRate || null, effectiveOn, note },
          singleRate ? "과정 예외를 등록했습니다." : "과정 예외를 푸는 새 버전을 등록했습니다.",
        );
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-[14px] font-medium">
            과정
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className={`${inputClass} font-normal`}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="이 과정의 단건 강사 비율 (%)"
            value={singleRate}
            onChange={(e) => setSingle(e.target.value)}
            inputMode="decimal"
            hint="비우면 예외를 풀고 강사 · 기본 비율로 돌아갑니다."
          />
          <Field
            label="시행일"
            type="date"
            min={tomorrow}
            value={effectiveOn}
            onChange={(e) => setEffectiveOn(e.target.value)}
            required
          />
          <Field label="메모" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={busy || !courseId} className="self-start">
          과정 예외 등록
        </Button>
      </Frame>
    </form>
  );
}
