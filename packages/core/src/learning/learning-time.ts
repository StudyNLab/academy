// 유효 학습 시간 (구독 매출 배분의 근거). docs/사이트구조_화면목록.md 9.2 — 모든 값은 정책 버전으로 바꿀 수 있다.
//   영상: 실제로 재생된 구간만, 같은 구간을 다시 본 것은 하루 1번만, 배속은 콘텐츠 시간 기준
//   교재: 화면이 보이고 활동이 있는 동안만 (2분 활동 없으면 화면 쪽이 신호를 멈춘다), 30초 칸마다 최대 30초
//   상한: 수강생 1명 · 과정 1개 · 하루 3시간
//   제외: 그 과정 강사 본인과 운영자

export interface LearningRules {
  version: string;
  dailyCapSec: number;
  /** 학습 신호 한 칸 (화면이 이 간격으로 보낸다) */
  bucketSec: number;
  /** 이 시간 동안 활동이 없으면 화면이 신호를 멈춘다 */
  idleStopSec: number;
  /** 영상을 이만큼 보면 완료 */
  videoCompleteRatio: number;
}

export const LEARNING_RULES_V1: LearningRules = {
  version: "2026-11-v1",
  dailyCapSec: 3 * 3600,
  bucketSec: 30,
  idleStopSec: 120,
  videoCompleteRatio: 0.9,
};

export type Range = [number, number];

/** 겹치는 구간을 합친다 (정렬 · 병합) */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s && s >= 0)
    .map(([s, e]) => [s, e] as Range)
    .sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function rangesLength(ranges: readonly Range[]): number {
  return mergeRanges(ranges).reduce((n, [s, e]) => n + (e - s), 0);
}

export type Heartbeat =
  | { kind: "text"; at: Date; activeSec: number }
  | { kind: "video"; at: Date; videoKey: string; ranges: Range[] };

export interface DailyTime {
  videoSec: number;
  textSec: number;
  effectiveSec: number;
}

/**
 * 한 수강생 · 한 과정 · 하루치 신호 ➔ 유효 학습 시간.
 * 같은 30초 칸에 영상 신호가 있으면 그 칸의 교재 시간은 세지 않는다 (영상을 보며 화면도 보고 있으니 두 번 세지 않게).
 * excluded(강사 본인 · 운영자)면 시간은 세되 유효 시간은 0.
 */
export function dailyLearningTime(
  heartbeats: readonly Heartbeat[],
  options: { excluded?: boolean; rules?: LearningRules } = {},
): DailyTime {
  const rules = options.rules ?? LEARNING_RULES_V1;
  const bucket = (at: Date) => Math.floor(at.getTime() / 1000 / rules.bucketSec);
  const videoBuckets = new Set<number>();
  const rangesByVideo = new Map<string, Range[]>();
  for (const hb of heartbeats) {
    if (hb.kind !== "video") continue;
    videoBuckets.add(bucket(hb.at));
    const list = rangesByVideo.get(hb.videoKey) ?? [];
    list.push(...hb.ranges);
    rangesByVideo.set(hb.videoKey, list);
  }
  const textByBucket = new Map<number, number>();
  for (const hb of heartbeats) {
    if (hb.kind !== "text") continue;
    const b = bucket(hb.at);
    if (videoBuckets.has(b)) continue;
    // 탭을 여러 개 열어도 한 칸에 최대 30초
    textByBucket.set(b, Math.min(rules.bucketSec, (textByBucket.get(b) ?? 0) + Math.max(0, hb.activeSec)));
  }
  const videoSec = Math.round([...rangesByVideo.values()].reduce((n, r) => n + rangesLength(r), 0));
  const textSec = Math.round([...textByBucket.values()].reduce((n, s) => n + s, 0));
  const effectiveSec = options.excluded ? 0 : Math.min(rules.dailyCapSec, videoSec + textSec);
  return { videoSec, textSec, effectiveSec };
}

/** 학습 신호의 날짜 (KST). 하루 상한 · 집계는 한국 날짜 기준 */
export function kstDate(at: Date): string {
  return new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** KST 날짜 하루의 시작 · 끝 (UTC) */
export function kstDayRange(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+09:00`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}
