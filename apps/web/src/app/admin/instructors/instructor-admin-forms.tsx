"use client";

// AD-15 강사 관리 입력: 등록 · 회원 잇기 · 상태 · 계약 · 수익 비율
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Button, Field, inputClass, Notice } from "@aionit/ui";
import { api, apiDelete } from "@/lib/client-api";
import { useHydrated } from "@/lib/use-hydrated";

type Message = { tone: "done" | "danger"; text: string } | null;

/** 입력 몇 개 + 버튼 하나. 보내고 나면 화면을 새로 그린다 */
function useSubmit(path: string) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function send(body: unknown, done = "저장했습니다.") {
    setBusy(true);
    setMessage(null);
    const result = await api<{ id?: string }>(path, body);
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: result.error.message });
      return null;
    }
    setMessage({ tone: "done", text: done });
    router.refresh();
    return result.data;
  }
  return { message, busy, send };
}

/** 화면이 살아나기 전에 넣은 값은 사라지므로 그때까지 입력을 끈다 (lib/use-hydrated) */
function Frame({ message, children }: { message: Message; children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <fieldset disabled={!hydrated} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {children}
    </fieldset>
  );
}

export function RegisterInstructorForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const { message, busy, send } = useSubmit("/admin/instructors");
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const data = await send({ displayName, email: email || null }, "등록했습니다.");
    if (data?.id) router.push(`/admin/instructors/${data.id}`);
  }
  return (
    <form onSubmit={onSubmit}>
      <Frame message={message}>
        <Field
          label="공개 이름"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <Field
          label="가입한 회원의 이메일 (선택)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="적으면 그 회원에게 강사 역할을 주고 메일로 알립니다. 비우면 프로필만 만들어 운영자가 대신 올립니다 (나중에 이을 수 있습니다)."
        />
        <Button type="submit" disabled={busy || displayName.trim().length < 2} className="self-start">
          강사 등록
        </Button>
      </Frame>
    </form>
  );
}

export function LinkMemberForm({ instructorId }: { instructorId: string }) {
  const [email, setEmail] = useState("");
  const { message, busy, send } = useSubmit(`/admin/instructors/${instructorId}`);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ action: "link", email }, "회원을 이었습니다. 강사 역할을 주고 메일로 알렸습니다.");
      }}
    >
      <Frame message={message}>
        <Field
          label="가입한 회원의 이메일"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" variant="outline" disabled={busy || !email} className="self-start">
          회원 잇기
        </Button>
      </Frame>
    </form>
  );
}

export function StatusForm({ instructorId, current }: { instructorId: string; current: string }) {
  const [status, setStatus] = useState(current);
  const [reason, setReason] = useState("");
  const { message, busy, send } = useSubmit(`/admin/instructors/${instructorId}`);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ action: "status", status, reason });
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            상태
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={`${inputClass} font-normal`}
            >
              <option value="active">활동 중</option>
              <option value="suspended">정지</option>
              <option value="ended">계약 끝남</option>
            </select>
          </label>
          <Field label="사유 (기록에 남습니다)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <p className="m-0 text-[13px] text-ink-2">
          정지 · 계약 끝남이면 강사 화면에서 보기만 합니다 (교재 · 영상 · 정보를 고칠 수 없음). 과정과 판매는
          그대로입니다.
        </p>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || status === current || reason.trim().length < 2}
          className="self-start"
        >
          상태 바꾸기
        </Button>
      </Frame>
    </form>
  );
}

export function ContractForm({ instructorId }: { instructorId: string }) {
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [memo, setMemo] = useState("");
  const { message, busy, send } = useSubmit(`/admin/instructors/${instructorId}`);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(
          { action: "contract", startsOn, endsOn: endsOn || null, memo },
          "계약을 만들었습니다. 강사에게 동의 요청을 보냈습니다.",
        );
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="시작하는 날"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            required
          />
          <Field
            label="끝나는 날 (비우면 없음)"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
        <Field label="메모 (강사에게도 보입니다)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <p className="m-0 text-[13px] text-ink-2">
          지금 시행 중인 강사 이용약관이 붙습니다. 강사가 강사 화면에서 동의하면 고칠 수 없습니다.
        </p>
        <Button type="submit" variant="outline" disabled={busy || !startsOn} className="self-start">
          계약 만들기
        </Button>
      </Frame>
    </form>
  );
}

export function ContractRemove({ contractId }: { contractId: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="min-h-11 border-0 bg-transparent p-0 text-[14px] text-danger underline"
      onClick={async () => {
        if (!window.confirm("동의 전인 이 계약을 지울까요?")) return;
        const result = await apiDelete(`/admin/contracts/${contractId}`);
        if (result.ok) router.refresh();
        else window.alert(result.error.message);
      }}
    >
      지우기
    </button>
  );
}

export function RateForm({ instructorId, tomorrow }: { instructorId: string; tomorrow: string }) {
  const [percent, setPercent] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(tomorrow);
  const [note, setNote] = useState("");
  const { message, busy, send } = useSubmit(`/admin/instructors/${instructorId}`);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ action: "rate", percent, effectiveOn, note }, "새 비율을 등록했습니다.");
      }}
    >
      <Frame message={message}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="단건 매출 강사 비율 (%)"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            inputMode="decimal"
            placeholder="60"
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
        </div>
        <Field label="메모" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="m-0 text-[13px] text-ink-2">
          고치지 않고 새 버전으로 쌓입니다. 시행일(0시) 이후 매출부터 적용되고, 정산 계산에서 씁니다.
        </p>
        <Button type="submit" variant="outline" disabled={busy || !percent} className="self-start">
          비율 등록
        </Button>
      </Frame>
    </form>
  );
}
