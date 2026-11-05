"use client";

// 강사 화면의 입력: 검수 요청(I-05) · 공개 프로필 · 정산 정보 · 계약 동의(I-09)
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Checkbox, Field, inputClass, Notice } from "@aionit/ui";
import { TextArea } from "@/components/text-area";
import { api } from "@/lib/client-api";

type Message = { tone: "done" | "danger"; text: string } | null;

function Result({ message }: { message: Message }) {
  return message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
}

/** I-05 변경 내용 메모와 함께 검수 요청 */
export function ReviewRequestForm({ versionId, again }: { versionId: string; again: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await api(`/instructor/versions/${versionId}/request-review`, { note });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[560px] flex-col gap-4">
      <h2 className="m-0 text-[21px] font-semibold">{again ? "고친 뒤 다시 검수 요청" : "검수 요청"}</h2>
      <Result message={message} />
      <TextArea
        label="변경 내용 메모 (운영자가 검수할 때 봅니다)"
        value={note}
        onChange={setNote}
        rows={4}
        maxLength={1000}
        hint="예: CH4 도구 호출 예제 수정, 실습 2 영상 연결"
      />
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? "요청하는 중…" : "검수 요청"}
      </Button>
    </form>
  );
}

/** I-09 공개 프로필 (강의 상세 · 강사 소개에 나온다) */
export function ProfileForm({ initial }: { initial: { displayName: string; bioMd: string } }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api("/instructor/profile", values);
    setBusy(false);
    setMessage(
      result.ok ? { tone: "done", text: "저장했습니다." } : { tone: "danger", text: result.error.message },
    );
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Result message={message} />
      <Field
        label="공개 이름"
        value={values.displayName}
        onChange={(e) => setValues((v) => ({ ...v, displayName: e.target.value }))}
        maxLength={50}
        required
      />
      <TextArea
        label="소개 (강의 상세의 강사 소개에 나옵니다)"
        value={values.bioMd}
        onChange={(bioMd) => setValues((v) => ({ ...v, bioMd }))}
        maxLength={3000}
        hint="경력 · 전문 분야 · 강의 방식. 개인 연락처는 적지 마세요."
      />
      <Button type="submit" variant="outline" disabled={busy} className="self-start">
        저장
      </Button>
    </form>
  );
}

/** I-09 정산 정보. 주민등록번호 · 계좌번호는 다시 보여 주지 않는다 (끝 4자리만) */
export function PayoutForm({
  current,
}: {
  current: {
    taxType: "individual" | "business";
    hasRrn: boolean;
    bankName: string;
    accountHolder: string;
  } | null;
}) {
  const router = useRouter();
  const [taxType, setTaxType] = useState<"individual" | "business">(current?.taxType ?? "individual");
  const [rrn, setRrn] = useState("");
  const [businessNo, setBusinessNo] = useState("");
  const [bankName, setBankName] = useState(current?.bankName ?? "");
  const [bankAccount, setBankAccount] = useState("");
  const [accountHolder, setAccountHolder] = useState(current?.accountHolder ?? "");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await api("/instructor/payout", {
      taxType,
      rrn: taxType === "individual" && rrn ? rrn : null,
      businessNo: taxType === "business" ? businessNo : null,
      bankName,
      bankAccount,
      accountHolder,
    });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    setRrn("");
    setBankAccount("");
    setMessage({ tone: "done", text: "저장했습니다. 번호는 암호화해 보관하고 끝 4자리만 보입니다." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" autoComplete="off">
      <Result message={message} />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        소득 구분
        <select
          value={taxType}
          onChange={(e) => setTaxType(e.target.value as typeof taxType)}
          className={`${inputClass} font-normal`}
        >
          <option value="individual">개인 (사업소득 3.3% 원천징수)</option>
          <option value="business">사업자 (세금계산서 발행)</option>
        </select>
      </label>
      {taxType === "individual" ? (
        <Field
          label="주민등록번호"
          value={rrn}
          onChange={(e) => setRrn(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder={current?.hasRrn ? "등록됨 (바꿀 때만 입력)" : "000000-0000000"}
          hint="원천징수 신고에만 씁니다. 암호화해 보관하고 화면에 다시 보여 주지 않습니다."
        />
      ) : (
        <Field
          label="사업자등록번호"
          value={businessNo}
          onChange={(e) => setBusinessNo(e.target.value)}
          inputMode="numeric"
          placeholder="000-00-00000"
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="은행" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
        <Field
          label="예금주"
          value={accountHolder}
          onChange={(e) => setAccountHolder(e.target.value)}
          required
        />
      </div>
      <Field
        label="계좌번호"
        value={bankAccount}
        onChange={(e) => setBankAccount(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
        placeholder={current ? "바꿀 때도 다시 입력해 주세요" : "숫자만 (- 는 빼도 됩니다)"}
        required
      />
      <Button type="submit" variant="outline" disabled={busy || !bankAccount} className="self-start">
        정산 정보 저장
      </Button>
    </form>
  );
}

/** I-09 계약 · 강사 이용약관 동의 */
export function ContractAgree({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Result message={message} />
      <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>
        계약 기간과 강사 이용약관을 읽었고 동의합니다.
      </Checkbox>
      <Button
        disabled={!checked || busy}
        className="self-start"
        onClick={async () => {
          setBusy(true);
          const result = await api(`/instructor/contracts/${contractId}`);
          setBusy(false);
          if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
          router.refresh();
        }}
      >
        동의하기
      </Button>
    </div>
  );
}
