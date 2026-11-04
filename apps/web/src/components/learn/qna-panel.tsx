"use client";

// L-06 강의 Q&A 패널 (docs/화면상세기획.md 1.6). 데스크톱은 오른쪽에서 열려 본문을 밀어내고, 좁은 화면은 전체 화면.
// 목록(같은 질문 찾기 · 전체 / 미해결 / 내 질문) ➔ 질문 보기(답변 · 해결됨 · 고정 · 신고) ➔ 질문하기(비밀글 · 읽던 Section 자동 연결)
// 권한은 서버가 다시 확인한다. 여기서 버튼을 숨기는 것은 편의일 뿐이다.
import type { SecretMatch } from "@aionit/core";
import { QNA_LIMITS, REPORT_REASONS } from "@aionit/core";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button, Checkbox, Field, inputClass, MonoLabel, Notice } from "@aionit/ui";
import { timeAgo, UserText } from "@/components/user-text";
import { api, apiDelete, apiGet } from "@/lib/client-api";
import type { QnaFilter, QuestionDetail, QuestionListItem } from "@/server/qna";

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "ask" };

interface ListData {
  items: QuestionListItem[];
  canAsk: boolean;
  role: "instructor" | "learner" | "operator";
}

export interface QnaPanelProps {
  courseId: string;
  chapterKey: string;
  /** "CH2 LLM API 호출" */
  chapterName: string;
  /** 지금 읽고 있는 Section (질문에 자동 연결) */
  section: { id: string; title: string } | null;
  /** 알림에서 열면 그 질문부터 */
  openId: string | null;
  onClose: () => void;
  /** 질문 수가 바뀌었을 때 (머리글 숫자 다시 그리기) */
  onChanged: () => void;
}

const ROLE_BADGE = { instructor: "강사", operator: "운영자" } as const;

export function QnaPanel(props: QnaPanelProps) {
  const [view, setView] = useState<View>(
    props.openId ? { kind: "detail", id: props.openId } : { kind: "list" },
  );
  const [listKey, setListKey] = useState(0);
  const back = () => {
    setListKey((k) => k + 1);
    setView({ kind: "list" });
  };

  return (
    <div className="flex h-full flex-col" role="dialog" aria-label="강의 Q&A">
      <div className="flex min-h-[60px] items-center gap-3 border-b border-line px-5">
        {view.kind !== "list" ? (
          <button type="button" onClick={back} className="min-h-11 pr-2 text-ink" aria-label="목록으로">
            ←
          </button>
        ) : null}
        <p className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold">
          Q&amp;A · <span className="font-normal text-ink-2">{props.chapterName}</span>
        </p>
        <button
          type="button"
          onClick={props.onClose}
          className="inline-flex h-11 w-11 items-center justify-center text-ink"
          aria-label="Q&A 닫기"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {view.kind === "list" ? (
          <QuestionList
            key={listKey}
            courseId={props.courseId}
            chapterKey={props.chapterKey}
            onOpen={(id) => setView({ kind: "detail", id })}
            onAsk={() => setView({ kind: "ask" })}
          />
        ) : view.kind === "ask" ? (
          <AskForm
            courseId={props.courseId}
            chapterKey={props.chapterKey}
            section={props.section}
            onDone={(id) => {
              props.onChanged();
              setView({ kind: "detail", id });
            }}
          />
        ) : (
          <QuestionView key={view.id} id={view.id} onChanged={props.onChanged} onGone={back} />
        )}
      </div>
    </div>
  );
}

// ---- 목록 ----

function QuestionList({
  courseId,
  chapterKey,
  onOpen,
  onAsk,
}: {
  courseId: string;
  chapterKey: string;
  onOpen: (id: string) => void;
  onAsk: () => void;
}) {
  const [filter, setFilter] = useState<QnaFilter>("all");
  const [wholeCourse, setWholeCourse] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = useId();

  // 같은 질문 찾기: 입력이 멈추고 0.3초 뒤에 찾는다
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let stale = false;
    const params = new URLSearchParams({ courseId, filter });
    if (!wholeCourse) params.set("chapterKey", chapterKey);
    if (search) params.set("q", search);
    void apiGet<ListData>(`/qna?${params}`).then((result) => {
      if (stale) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else setError(result.error.message);
    });
    return () => {
      stale = true;
    };
  }, [courseId, chapterKey, filter, wholeCourse, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="sr-only">같은 질문 찾기</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 같은 질문 찾기"
            className={inputClass}
          />
        </label>
        {data?.canAsk ? (
          <Button size="md" onClick={onAsk}>
            질문하기
          </Button>
        ) : null}
      </div>
      <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0 text-[14px]">
        <legend className="sr-only">보기</legend>
        {(
          [
            ["all", "전체"],
            ["open", "미해결"],
            ["mine", "내 질문"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={name}
              checked={filter === value}
              onChange={() => setFilter(value)}
              className="accent-[var(--primary)]"
            />
            {label}
          </label>
        ))}
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-ink-2">
          <input
            type="checkbox"
            checked={wholeCourse}
            onChange={(e) => setWholeCourse(e.target.checked)}
            className="accent-[var(--primary)]"
          />
          과정 전체
        </label>
      </fieldset>
      {data && !data.canAsk && data.role !== "learner" ? (
        <p className="m-0 text-[13px] text-ink-2">
          {ROLE_BADGE[data.role]}로 보고 있습니다. 질문은 수강생만 쓰고, 답변 · 고정은 할 수 있습니다.
        </p>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!data && !error ? <p className="m-0 text-[14px] text-ink-2">불러오는 중…</p> : null}
      {data && data.items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-t border-line pt-5 text-[14px] text-ink-2">
          <p className="m-0">
            {search
              ? "찾는 질문이 없습니다. 새로 질문해 보세요."
              : filter === "mine"
                ? "아직 남긴 질문이 없습니다."
                : "아직 질문이 없습니다. 막히는 곳이 있으면 처음으로 물어보세요."}
          </p>
        </div>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col border-t border-line p-0">
          {data.items.map((item) => (
            <li key={item.id} className="border-b border-line">
              <QuestionRow item={item} showChapter={wholeCourse} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function QuestionRow({
  item,
  showChapter,
  onOpen,
}: {
  item: QuestionListItem;
  showChapter: boolean;
  onOpen: (id: string) => void;
}) {
  const locked = item.view === "locked";
  const icon = item.pinned ? "📌" : locked ? "🔒" : item.status === "resolved" ? "✅" : "❓";
  const label = item.pinned ? "고정" : locked ? "비밀글" : item.status === "resolved" ? "해결됨" : "미해결";
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span aria-label={label} role="img">
          {icon}
        </span>
        <span className={`min-w-0 flex-1 ${locked ? "text-ink-2" : "font-medium text-ink"}`}>
          {item.pinned ? <span className="text-[13px] text-signal">강사 고정 · </span> : null}
          {locked ? "비밀글입니다" : item.title}
          {item.isSecret && !locked ? <span className="text-[13px] text-ink-2"> · 🔒 비밀글</span> : null}
          {item.hidden ? <span className="text-[13px] text-danger"> · 숨김</span> : null}
        </span>
      </span>
      <span className="mt-1 flex flex-wrap gap-x-2 pl-7 text-[12px] text-ink-2">
        {item.staffAnswered ? <span className="font-semibold text-signal">강사 답변</span> : null}
        <span>답변 {item.answerCount}</span>
        <span>{timeAgo(item.createdAt)}</span>
        {item.author ? <span>{item.mine ? "내 질문" : item.author}</span> : null}
        {showChapter ? <span>{item.chapterName ?? "이전 버전의 질문"}</span> : null}
      </span>
    </>
  );
  return locked ? (
    <div className="py-3 text-[14px]">{body}</div>
  ) : (
    <button type="button" onClick={() => onOpen(item.id)} className="block w-full py-3 text-left text-[14px]">
      {body}
    </button>
  );
}

// ---- 질문하기 ----

/** API 키처럼 보이는 글자가 있다고 서버가 알려 주면 한 번 더 확인받는다 (저장을 막지는 않는다) */
function SecretWarning({
  matches,
  onEdit,
  onConfirm,
  busy,
}: {
  matches: SecretMatch[];
  onEdit: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 border-t-2 border-warn bg-surface px-4 py-3.5 text-[14px]"
    >
      <p className="m-0 font-semibold">API 키처럼 보이는 글자가 있습니다. 키를 지우고 올려 주세요.</p>
      <ul className="m-0 pl-5 text-ink-2">
        {matches.map((m, i) => (
          <li key={i}>
            {m.kind}: <code className="font-mono">{m.masked}</code>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] text-ink-2">
        올린 키는 다른 수강생도 볼 수 있습니다. 이미 올렸다면 그 키는 발급한 곳에서 바로 폐기하세요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onEdit}>
          고쳐서 올리기
        </Button>
        <Button size="sm" variant="outline" onClick={onConfirm} disabled={busy}>
          키가 아닙니다. 그대로 올리기
        </Button>
      </div>
    </div>
  );
}

function BodyInput({
  label,
  value,
  onChange,
  rows = 7,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  id?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <textarea
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={QNA_LIMITS.bodyMax}
        className={`${inputClass} py-2.5 font-[inherit] leading-[1.6]`}
      />
      <p className="m-0 text-[13px] leading-[1.6] text-ink-2">
        코드는 <code className="font-mono">```</code> 로 앞뒤를 감싸면 코드 블록으로 보입니다.
      </p>
    </div>
  );
}

function AskForm({
  courseId,
  chapterKey,
  section,
  onDone,
}: {
  courseId: string;
  chapterKey: string;
  section: { id: string; title: string } | null;
  onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [secret, setSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<SecretMatch[] | null>(null);
  // 질문하기를 누른 때의 Section 을 붙인다 (쓰는 동안 스크롤해도 바뀌지 않게)
  const [linked] = useState(section);

  async function send(confirmSecret: boolean) {
    setBusy(true);
    setError(null);
    const result = await api<{ id: string }>("/qna", {
      courseId,
      chapterKey,
      sectionId: linked?.id ?? null,
      title,
      body,
      secret,
      confirmSecret,
    });
    setBusy(false);
    if (result.ok) return onDone(result.data.id);
    if (result.error.code === "SECRET_SUSPECTED") return setWarning(result.error.details as SecretMatch[]);
    setError(result.error.message);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <MonoLabel className="text-xs text-signal">질문하기</MonoLabel>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={QNA_LIMITS.titleMax}
        required
      />
      <BodyInput label="내용" value={body} onChange={setBody} />
      {linked ? (
        <p className="m-0 text-[13px] text-ink-2">
          연결된 곳: <strong className="font-semibold text-ink">{linked.title}</strong>
        </p>
      ) : null}
      <Checkbox checked={secret} onChange={(e) => setSecret(e.target.checked)}>
        비밀글 (나 · 강사 · 운영자만 봅니다)
      </Checkbox>
      {warning ? (
        <SecretWarning
          matches={warning}
          busy={busy}
          onEdit={() => setWarning(null)}
          onConfirm={() => void send(true)}
        />
      ) : (
        <Button type="submit" disabled={busy || title.trim().length < 2 || body.trim().length < 2}>
          질문 올리기
        </Button>
      )}
    </form>
  );
}

// ---- 질문 보기 ----

function QuestionView({ id, onChanged, onGone }: { id: string; onChanged: () => void; onGone: () => void }) {
  const [data, setData] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiGet<QuestionDetail>(`/qna/${id}`);
    if (result.ok) setData(result.data);
    else setError(result.error.message);
  }, [id]);

  useEffect(() => {
    let stale = false;
    void apiGet<QuestionDetail>(`/qna/${id}`).then((result) => {
      if (stale) return;
      if (result.ok) setData(result.data);
      else setError(result.error.message);
    });
    return () => {
      stale = true;
    };
  }, [id]);

  async function act(action: "resolve" | "reopen" | "pin" | "unpin" | "delete") {
    if (action === "delete" && !window.confirm("이 질문을 지울까요? 내용은 남지 않습니다.")) return;
    const result = await api(`/qna/${id}/${action}`);
    if (!result.ok) return setError(result.error.message);
    onChanged();
    if (action === "delete") return onGone();
    await load();
  }

  async function removeAnswer(answerId: string) {
    if (!window.confirm("이 답변을 지울까요?")) return;
    const result = await apiDelete(`/qna/answers/${answerId}`);
    if (!result.ok) return setError(result.error.message);
    await load();
  }

  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <p className="m-0 text-[14px] text-ink-2">불러오는 중…</p>;
  const { question, answers, can } = data;

  return (
    <article className="flex flex-col gap-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="done">{notice}</Notice> : null}
      <header className="flex flex-col gap-2">
        <p className="m-0 flex flex-wrap gap-x-2 text-[12px] text-ink-2">
          {question.pinned ? <span className="text-signal">📌 강사 고정</span> : null}
          <span className={question.status === "resolved" ? "font-semibold text-done" : ""}>
            {question.status === "resolved" ? "✅ 해결됨" : "❓ 미해결"}
          </span>
          {question.isSecret ? <span>🔒 비밀글</span> : null}
          <span>{question.chapterName ?? "이전 버전의 질문"}</span>
        </p>
        <h2 className="m-0 text-[19px] leading-[1.4] font-semibold tracking-[-0.02em]">{question.title}</h2>
        <p className="m-0 text-[13px] text-ink-2">
          {question.mine ? "내 질문" : question.author} · {timeAgo(question.createdAt)}
        </p>
      </header>
      {question.hidden ? (
        <Notice tone="warn">
          운영자가 숨긴 글입니다{question.hiddenReason ? ` (사유: ${question.hiddenReason})` : ""}. 다른
          수강생에게는 보이지 않습니다.
        </Notice>
      ) : null}
      <UserText source={question.body} />
      <div className="flex flex-wrap gap-2">
        {can.resolve ? (
          question.status === "open" ? (
            <Button size="sm" onClick={() => void act("resolve")}>
              해결됨
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void act("reopen")}>
              다시 열기
            </Button>
          )
        ) : null}
        {can.pin ? (
          <Button size="sm" variant="outline" onClick={() => void act(question.pinned ? "unpin" : "pin")}>
            {question.pinned ? "고정 풀기" : "위에 고정"}
          </Button>
        ) : null}
        {can.delete ? (
          <Button size="sm" variant="outline" onClick={() => void act("delete")}>
            지우기
          </Button>
        ) : null}
        {can.report ? (
          <ReportButton
            targetType="question"
            targetId={question.id}
            reported={question.reported}
            onDone={() => setNotice("신고했습니다. 운영자가 확인합니다.")}
          />
        ) : null}
      </div>

      <section aria-label="답변" className="flex flex-col gap-4 border-t border-line-strong pt-5">
        <MonoLabel className="text-xs text-ink-2">답변 {answers.length}</MonoLabel>
        {answers.length === 0 ? (
          <p className="m-0 text-[14px] text-ink-2">아직 답변이 없습니다.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {answers.map((answer) => (
              <li
                key={answer.id}
                className={`flex flex-col gap-2 border-t pt-3 ${answer.authorRole !== "learner" ? "border-t-2 border-signal" : "border-line"}`}
              >
                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2">
                  {answer.authorRole !== "learner" ? <Badge>{ROLE_BADGE[answer.authorRole]}</Badge> : null}
                  <span className="font-semibold text-ink">{answer.mine ? "나" : answer.author}</span>
                  <span>{timeAgo(answer.createdAt)}</span>
                </p>
                {answer.body === null ? (
                  <p className="m-0 text-[14px] text-ink-2">운영자가 숨긴 답변입니다.</p>
                ) : (
                  <>
                    {answer.hidden ? (
                      <p className="m-0 text-[13px] text-danger">
                        숨김{answer.hiddenReason ? ` · 사유: ${answer.hiddenReason}` : ""}
                      </p>
                    ) : null}
                    <UserText source={answer.body} />
                  </>
                )}
                <div className="flex flex-wrap gap-3 text-[13px]">
                  {answer.mine ? (
                    <button
                      type="button"
                      className="min-h-9 text-ink-2"
                      onClick={() => void removeAnswer(answer.id)}
                    >
                      지우기
                    </button>
                  ) : null}
                  {answer.canReport ? (
                    <ReportButton
                      targetType="answer"
                      targetId={answer.id}
                      reported={answer.reported}
                      plain
                      onDone={() => setNotice("신고했습니다. 운영자가 확인합니다.")}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
        {can.answer ? (
          <AnswerForm
            questionId={question.id}
            onDone={async () => {
              onChanged();
              await load();
            }}
          />
        ) : null}
      </section>
    </article>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center border border-signal px-1.5 font-mono text-[11px] tracking-[0.04em] text-signal">
      {children}
    </span>
  );
}

function AnswerForm({ questionId, onDone }: { questionId: string; onDone: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<SecretMatch[] | null>(null);

  async function send(confirmSecret: boolean) {
    setBusy(true);
    setError(null);
    const result = await api(`/qna/${questionId}/answers`, { body, confirmSecret });
    setBusy(false);
    if (result.ok) {
      setBody("");
      setWarning(null);
      return onDone();
    }
    if (result.error.code === "SECRET_SUSPECTED") return setWarning(result.error.details as SecretMatch[]);
    setError(result.error.message);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <BodyInput label="답변 쓰기" value={body} onChange={setBody} rows={5} />
      {warning ? (
        <SecretWarning
          matches={warning}
          busy={busy}
          onEdit={() => setWarning(null)}
          onConfirm={() => void send(true)}
        />
      ) : (
        <Button
          type="submit"
          variant="outline"
          disabled={busy || body.trim().length < 2}
          className="self-start"
        >
          답변 올리기
        </Button>
      )}
    </form>
  );
}

function ReportButton({
  targetType,
  targetId,
  reported,
  plain = false,
  onDone,
}: {
  targetType: "question" | "answer";
  targetId: string;
  reported: boolean;
  plain?: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(reported);
  const [error, setError] = useState<string | null>(null);

  if (done) return <span className="inline-flex min-h-9 items-center text-[13px] text-ink-2">신고함</span>;
  if (!open)
    return plain ? (
      <button type="button" className="min-h-9 text-ink-2" onClick={() => setOpen(true)}>
        신고
      </button>
    ) : (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        신고
      </Button>
    );

  async function submit() {
    const result = await api("/qna/reports", { targetType, targetId, reason, detail: detail || null });
    if (!result.ok) return setError(result.error.message);
    setDone(true);
    onDone();
  }

  return (
    <div className="flex w-full flex-col gap-2 border border-line bg-surface p-3 text-[14px]">
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">신고 사유</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
          <option value="">고르세요</option>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">더 알려 줄 것 (선택)</span>
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={500}
          className={inputClass}
        />
      </label>
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={!reason} onClick={() => void submit()}>
          신고하기
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          그만두기
        </Button>
      </div>
    </div>
  );
}
