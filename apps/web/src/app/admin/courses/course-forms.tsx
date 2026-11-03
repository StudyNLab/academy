"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Button, Checkbox, Field, inputClass, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

const FIELDS = [
  { value: "ai", label: "AI" },
  { value: "infra", label: "인프라" },
  { value: "security", label: "보안" },
] as const;

export interface CourseFormValues {
  title: string;
  field: "ai" | "infra" | "security";
  level: string;
  ownerInstructorId: string;
  summary: string;
  descriptionMd: string;
  audienceMd: string;
  requirementsMd: string;
  inSubscription: boolean;
}

function Select({
  label,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <select className={`${inputClass} font-normal`} {...rest}>
        {children}
      </select>
    </label>
  );
}

function TextArea({
  label,
  hint,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <textarea className={`${inputClass} min-h-24 py-2.5 font-normal`} {...rest} />
      {hint ? <span className="text-[13px] font-normal text-ink-2">{hint}</span> : null}
    </label>
  );
}

/** 과정 정보 입력 (등록 · 수정 공용). 과정 ID 는 등록 때만 */
function CourseFields({
  values,
  set,
  instructors,
}: {
  values: CourseFormValues;
  set: (patch: Partial<CourseFormValues>) => void;
  instructors: { id: string; name: string }[];
}) {
  return (
    <>
      <Field
        label="과정 이름"
        value={values.title}
        onChange={(e) => set({ title: e.target.value })}
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="분야"
          value={values.field}
          onChange={(e) => set({ field: e.target.value as CourseFormValues["field"] })}
        >
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <Field
          label="수준"
          value={values.level}
          onChange={(e) => set({ level: e.target.value })}
          hint="예: 초급"
        />
      </div>
      <Select
        label="소유 강사"
        value={values.ownerInstructorId}
        onChange={(e) => set({ ownerInstructorId: e.target.value })}
        required
      >
        <option value="">고르세요</option>
        {instructors.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
      <Field label="한 줄 소개" value={values.summary} onChange={(e) => set({ summary: e.target.value })} />
      <TextArea
        label="소개 (마크다운)"
        value={values.descriptionMd}
        onChange={(e) => set({ descriptionMd: e.target.value })}
      />
      <TextArea
        label="이런 분께 (마크다운)"
        value={values.audienceMd}
        onChange={(e) => set({ audienceMd: e.target.value })}
      />
      <TextArea
        label="실습 준비물 (마크다운)"
        value={values.requirementsMd}
        onChange={(e) => set({ requirementsMd: e.target.value })}
        hint="예: LLM API 키 (사용 요금 본인 부담)"
      />
      <Checkbox checked={values.inSubscription} onChange={(e) => set({ inSubscription: e.target.checked })}>
        구독에 포함 (끄면 프리미엄 강의)
      </Checkbox>
    </>
  );
}

const empty: CourseFormValues = {
  title: "",
  field: "ai",
  level: "",
  ownerInstructorId: "",
  summary: "",
  descriptionMd: "",
  audienceMd: "",
  requirementsMd: "",
  inSubscription: true,
};

export function NewCourseForm({ instructors }: { instructors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [values, setValues] = useState<CourseFormValues>(empty);
  const [newInstructor, setNewInstructor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CourseFormValues>) => setValues((v) => ({ ...v, ...patch }));

  async function addInstructor() {
    setError(null);
    const result = await api<{ id: string }>("/admin/instructors", { displayName: newInstructor });
    if (!result.ok) return setError(result.error.message);
    setNewInstructor("");
    set({ ownerInstructorId: result.data.id });
    router.refresh();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api<{ id: string }>("/admin/courses", { slug, ...values });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.push(`/admin/courses/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="과정 ID"
        value={slug}
        onChange={(e) => setSlug(e.target.value.trim())}
        hint="교재 패키지 course.json 의 course_id 와 같게. 영문 소문자 · 숫자 · - (예: ai-agent-basics). 정하면 바꿀 수 없습니다."
        required
      />
      <CourseFields values={values} set={set} instructors={instructors} />
      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field
          label="강사가 목록에 없으면 새로 추가"
          value={newInstructor}
          onChange={(e) => setNewInstructor(e.target.value)}
          className="min-w-[220px] flex-1"
        />
        <Button variant="outline" onClick={addInstructor} disabled={newInstructor.trim().length < 2}>
          강사 추가
        </Button>
      </div>
      <Button
        type="submit"
        disabled={busy || !slug || !values.title || !values.ownerInstructorId}
        className="self-start"
      >
        과정 등록
      </Button>
    </form>
  );
}

export function EditCourseForm({
  courseId,
  initial,
  instructors,
}: {
  courseId: string;
  initial: CourseFormValues;
  instructors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<CourseFormValues>(initial);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CourseFormValues>) => setValues((v) => ({ ...v, ...patch }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api(`/admin/courses/${courseId}`, values);
    setBusy(false);
    setMessage(
      result.ok ? { tone: "done", text: "저장했습니다." } : { tone: "danger", text: result.error.message },
    );
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <CourseFields values={values} set={set} instructors={instructors} />
      <Button type="submit" variant="outline" disabled={busy} className="self-start">
        저장
      </Button>
    </form>
  );
}
