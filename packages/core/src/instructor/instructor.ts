// 강사 (M8): 검수 요청 상태 · 계약 상태 · 정산 정보 형식 · 배분 비율 표기 · 판매 · 수강 현황 집계.
// DB 를 모르는 순수 함수로 두고 web 이 부른다. 현황 집계는 사람을 가리키는 값을 받지도 돌려주지도 않는다.

// ---- 교재 버전 검수 (I-05 ➔ AD-04) ----

export type VersionStatusLike =
  "uploaded" | "processing" | "invalid" | "ready" | "in_review" | "rejected" | "published" | "archived";

/**
 * 강사가 검수를 요청할 수 있나: 검사를 통과한 버전(ready), 또는 반려된 버전(영상 연결처럼 교재를 다시
 * 올리지 않고 고칠 수 있는 사유가 있다). 검사에 실패한 반려는 다시 올려야 한다.
 */
export function canRequestReview(version: { status: VersionStatusLike; validationOk: boolean }): boolean {
  if (!version.validationOk) return false;
  return version.status === "ready" || version.status === "rejected";
}

/**
 * 운영자 검수 대기에 넣나: 강사가 요청한 버전, 또는 강사가 아닌 사람(운영자)이 올려 검사를 통과한 버전.
 * 강사가 올리고 아직 요청하지 않은 버전은 강사가 고치는 중이라 넣지 않는다.
 */
export function isWaitingReview(version: {
  status: VersionStatusLike;
  uploadedBy: string | null;
  ownerUserId: string | null;
}): boolean {
  if (version.status === "in_review") return true;
  return version.status === "ready" && (!version.ownerUserId || version.uploadedBy !== version.ownerUserId);
}

/** 강사 화면의 교재 버전 상태 (I-02 · I-03) */
export const INSTRUCTOR_VERSION_STATUS: Record<
  VersionStatusLike,
  { tone: "done" | "warn" | "danger" | "muted"; label: string }
> = {
  uploaded: { tone: "muted", label: "올림 · 검사 대기" },
  processing: { tone: "muted", label: "검사 중" },
  invalid: { tone: "danger", label: "검사 실패" },
  ready: { tone: "warn", label: "검사 통과 · 검수 요청 전" },
  in_review: { tone: "warn", label: "검수 대기" },
  rejected: { tone: "danger", label: "반려" },
  published: { tone: "done", label: "공개 중" },
  archived: { tone: "muted", label: "지난 공개본" },
};

/** 과정 상태 (I-02): 작성 중 / 검수 대기 / 공개 / 반려. 가장 최근 버전과 공개 여부로 정한다 */
export type InstructorCourseState = "draft" | "in_review" | "published" | "rejected" | "hidden";

export function instructorCourseState(input: {
  courseStatus: "draft" | "published" | "hidden";
  latestVersionStatus: VersionStatusLike | null;
}): InstructorCourseState {
  if (input.latestVersionStatus === "in_review") return "in_review";
  if (input.latestVersionStatus === "rejected" && input.courseStatus === "draft") return "rejected";
  if (input.courseStatus === "published") return "published";
  if (input.courseStatus === "hidden") return "hidden";
  return "draft";
}

// ---- 계약 (AD-15) ----

export type ContractState = "unsigned" | "upcoming" | "active" | "ended";

/** today 는 KST 날짜 (YYYY-MM-DD) */
export function contractState(
  contract: { startsOn: string; endsOn: string | null; signedAt: Date | null },
  today: string,
): ContractState {
  if (!contract.signedAt) return "unsigned";
  if (today < contract.startsOn) return "upcoming";
  if (contract.endsOn && today > contract.endsOn) return "ended";
  return "active";
}

export const CONTRACT_STATE_LABEL: Record<ContractState, string> = {
  unsigned: "강사 동의 대기",
  upcoming: "시작 전",
  active: "계약 중",
  ended: "끝남",
};

// ---- 배분 비율 표기 (만분율 정수 ⇄ %) ----

/** 6000 ➔ "60%", 6250 ➔ "62.5%" */
export function formatRate(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** "60" · "62.5" · "60%" ➔ 만분율. 0 ~ 100, 소수 둘째 자리까지 */
export function parseRatePercent(input: string): number | null {
  const value = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const bp = Math.round(Number(value) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

// ---- 정산 정보 형식 (I-09) ----

const digits = (value: string) => value.replace(/[\s-]/g, "");

/** 계좌번호: 숫자 6 ~ 20자리 (하이픈 · 띄어쓰기는 지운다) */
export function normalizeBankAccount(input: string): string | null {
  const value = digits(input);
  return /^\d{6,20}$/.test(value) ? value : null;
}

/**
 * 주민등록번호: 숫자 13자리, 앞 6자리가 날짜, 7번째가 1 ~ 8.
 * (2020년 10월부터 뒷자리가 무작위라 검증 숫자는 보지 않는다)
 */
export function normalizeRrn(input: string): string | null {
  const value = digits(input);
  if (!/^\d{13}$/.test(value)) return null;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const gender = Number(value[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || gender < 1 || gender > 8) return null;
  return value;
}

/** 사업자등록번호: 숫자 10자리 + 국세청 검증 숫자 */
export function normalizeBusinessNo(input: string): string | null {
  const value = digits(input);
  if (!/^\d{10}$/.test(value)) return null;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const d = [...value].map(Number);
  let sum = weights.reduce((acc, w, i) => acc + w * d[i]!, 0);
  sum += Math.floor((5 * d[8]!) / 10);
  return (10 - (sum % 10)) % 10 === d[9] ? value : null;
}

export const formatBusinessNo = (value: string) =>
  `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;

/** 화면에는 끝 4자리만 */
export const maskTail = (last4: string) => `•••• ${last4}`;

// ---- 판매 · 수강 현황 (I-07). 사람을 가리키는 값은 받지 않는다 ----

export const PROGRESS_BUCKETS = [
  { label: "0%", min: 0, max: 0 },
  { label: "1 ~ 24%", min: 1, max: 24 },
  { label: "25 ~ 49%", min: 25, max: 49 },
  { label: "50 ~ 74%", min: 50, max: 74 },
  { label: "75 ~ 99%", min: 75, max: 99 },
  { label: "100%", min: 100, max: 100 },
] as const;

/** 수강생마다의 진도율(%) 목록 ➔ 구간별 인원 */
export function progressDistribution(percents: readonly number[]): { label: string; count: number }[] {
  return PROGRESS_BUCKETS.map((b) => ({
    label: b.label,
    count: percents.filter((p) => p >= b.min && p <= b.max).length,
  }));
}

export interface ChapterFunnelRow {
  key: string;
  /** 이 챕터를 연 사람 */
  started: number;
  /** 이 챕터를 끝낸 사람 */
  completed: number;
}

/**
 * 챕터별 시작 · 완료 인원 (챕터 순서대로) + 이탈 구간: 앞 챕터를 끝낸 사람 중 다음 챕터를 열지 않은 사람이
 * 가장 많은 곳. learners 는 사람마다 연 챕터 · 끝낸 챕터 key 모음 (누구인지는 받지 않는다).
 */
export function chapterFunnel(
  chapterKeys: readonly string[],
  learners: readonly { started: ReadonlySet<string>; completed: ReadonlySet<string> }[],
): { rows: ChapterFunnelRow[]; dropAfter: string | null; dropCount: number } {
  const rows = chapterKeys.map((key) => ({
    key,
    started: learners.filter((l) => l.started.has(key)).length,
    completed: learners.filter((l) => l.completed.has(key)).length,
  }));
  let dropAfter: string | null = null;
  let dropCount = 0;
  for (let i = 0; i + 1 < chapterKeys.length; i += 1) {
    const here = chapterKeys[i]!;
    const next = chapterKeys[i + 1]!;
    const lost = learners.filter((l) => l.completed.has(here) && !l.started.has(next)).length;
    if (lost > dropCount) {
      dropAfter = here;
      dropCount = lost;
    }
  }
  return { rows, dropAfter, dropCount };
}

/** KST 기준 월 (YYYY-MM) */
export function kstMonth(at: Date): string {
  return new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

/** 지금부터 거슬러 n개월 (오래된 달 먼저) */
export function recentMonths(now: Date, n: number): string[] {
  const [y, m] = kstMonth(now).split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const total = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  });
}

export interface MonthlySales {
  month: string;
  /** 판매 건수 (결제된 주문 항목) */
  sales: number;
  /** 결제액 합계 */
  gross: number;
  /** 그 달에 끝난 환불액 */
  refunded: number;
  net: number;
}

/** 월별 매출. 결제는 결제한 달, 환불은 환불이 끝난 달에 센다 (정산과 같은 기준) */
export function monthlySales(
  months: readonly string[],
  sales: readonly { paidAt: Date; amount: number }[],
  refunds: readonly { doneAt: Date; amount: number }[],
): MonthlySales[] {
  return months.map((month) => {
    const sold = sales.filter((s) => kstMonth(s.paidAt) === month);
    const gross = sold.reduce((acc, s) => acc + s.amount, 0);
    const refunded = refunds
      .filter((r) => kstMonth(r.doneAt) === month)
      .reduce((acc, r) => acc + r.amount, 0);
    return { month, sales: sold.length, gross, refunded, net: gross - refunded };
  });
}
