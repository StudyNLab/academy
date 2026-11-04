import { describe, expect, it } from "vitest";
import { courseAccess, daysLeft } from "./entitlement";
import type { EntitlementLike } from "./entitlement";
import {
  dailyLearningTime,
  kstDate,
  kstDayRange,
  LEARNING_RULES_V1,
  mergeRanges,
  rangesLength,
} from "./learning-time";
import type { Heartbeat } from "./learning-time";
import { coursePercent, isChapterDone, isTextDone, isVideoDone, minTextSeconds } from "./progress";

const now = new Date("2026-11-04T12:00:00Z");
const day = 86_400_000;
const course = { id: "c1", inSubscription: true };
const premium = { id: "c2", inSubscription: false };
const ent = (overrides: Partial<EntitlementLike>): EntitlementLike => ({
  id: "e1",
  scope: "course",
  courseId: "c1",
  startsAt: new Date(now.getTime() - day),
  endsAt: null,
  revokedAt: null,
  ...overrides,
});

describe("courseAccess (강의를 볼 수 있나)", () => {
  it("과정 수강권: 그 과정만", () => {
    expect(courseAccess([ent({})], course, now).ok).toBe(true);
    expect(courseAccess([ent({})], premium, now)).toEqual({ ok: false, reason: "none" });
  });

  it("구독 수강권: 구독 포함 과정만 (프리미엄은 안 됨)", () => {
    const sub = ent({ scope: "subscription_catalog", courseId: null });
    expect(courseAccess([sub], course, now).ok).toBe(true);
    expect(courseAccess([sub], premium, now).ok).toBe(false);
  });

  it("경계: 시작 시각부터, 끝나는 시각 직전까지", () => {
    const e = ent({ startsAt: now, endsAt: new Date(now.getTime() + 1000) });
    expect(courseAccess([e], course, now).ok).toBe(true);
    expect(courseAccess([e], course, new Date(now.getTime() + 1000))).toMatchObject({
      ok: false,
      reason: "expired",
    });
    expect(courseAccess([e], course, new Date(now.getTime() - 1))).toEqual({
      ok: false,
      reason: "not_started",
    });
  });

  it("회수한 수강권은 없는 것과 같다", () => {
    expect(courseAccess([ent({ revokedAt: now })], course, now)).toEqual({ ok: false, reason: "none" });
  });

  it("D3: 단건 · 구독 둘 다 있으면 오래 가는 것 (구독이 끝나도 단건으로 계속)", () => {
    const single = ent({ id: "single", endsAt: null });
    const sub = ent({
      id: "sub",
      scope: "subscription_catalog",
      courseId: null,
      endsAt: new Date(now.getTime() + day),
    });
    expect(courseAccess([sub, single], course, now)).toMatchObject({
      ok: true,
      entitlement: { id: "single" },
    });
    const later = new Date(now.getTime() + 2 * day);
    expect(courseAccess([sub, single], course, later)).toMatchObject({
      ok: true,
      entitlement: { id: "single" },
    });
  });

  it("만료 안내 (L-05) 에 마지막 만료일을 준다", () => {
    const ended = new Date(now.getTime() - 3 * day);
    expect(courseAccess([ent({ endsAt: ended })], course, now)).toEqual({
      ok: false,
      reason: "expired",
      lastEndedAt: ended,
    });
  });

  it("남은 날", () => {
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft(new Date(now.getTime() + 12 * day - 1000), now)).toBe(12);
  });
});

describe("유효 학습 시간 (정산 9.2)", () => {
  const t = (sec: number) => new Date(Date.UTC(2026, 10, 4, 1, 0, 0) + sec * 1000);
  const text = (sec: number, activeSec = 30): Heartbeat => ({ kind: "text", at: t(sec), activeSec });
  const video = (sec: number, ranges: [number, number][], videoKey = "ch01_main"): Heartbeat => ({
    kind: "video",
    at: t(sec),
    videoKey,
    ranges,
  });

  it("구간 합치기", () => {
    expect(
      mergeRanges([
        [10, 20],
        [0, 5],
        [15, 30],
        [40, 40],
        [-5, 3],
      ]),
    ).toEqual([
      [0, 5],
      [10, 30],
    ]);
    expect(
      rangesLength([
        [0, 10],
        [5, 15],
      ]),
    ).toBe(15);
  });

  it("교재: 30초 칸마다 최대 30초 (탭 두 개여도 한 번)", () => {
    expect(dailyLearningTime([text(0), text(5), text(30)])).toEqual({
      videoSec: 0,
      textSec: 60,
      effectiveSec: 60,
    });
  });

  it("영상: 같은 구간을 다시 본 것은 하루 1번만, 배속은 콘텐츠 시간 (2배속 10분 = 10분)", () => {
    const rewatch = [video(0, [[0, 300]]), video(300, [[0, 300]]), video(600, [[300, 600]])];
    expect(dailyLearningTime(rewatch).videoSec).toBe(600);
    // 2배속: 5분(벽시계) 동안 콘텐츠 0 ~ 600초
    expect(dailyLearningTime([video(0, [[0, 600]])]).videoSec).toBe(600);
  });

  it("영상을 보는 칸의 교재 시간은 두 번 세지 않는다", () => {
    expect(dailyLearningTime([video(0, [[0, 30]]), text(5), text(60)])).toEqual({
      videoSec: 30,
      textSec: 30,
      effectiveSec: 60,
    });
  });

  it("하루 3시간 상한", () => {
    const beats = Array.from({ length: 500 }, (_, i) => text(i * 30)); // 4시간 10분
    const result = dailyLearningTime(beats);
    expect(result.textSec).toBe(15000);
    expect(result.effectiveSec).toBe(LEARNING_RULES_V1.dailyCapSec);
  });

  it("강사 본인 · 운영자는 유효 시간 0", () => {
    expect(dailyLearningTime([text(0)], { excluded: true })).toEqual({
      videoSec: 0,
      textSec: 30,
      effectiveSec: 0,
    });
  });

  it("KST 날짜 (자정 경계)", () => {
    expect(kstDate(new Date("2026-11-04T14:59:59Z"))).toBe("2026-11-04");
    expect(kstDate(new Date("2026-11-04T15:00:00Z"))).toBe("2026-11-05");
    expect(kstDayRange("2026-11-05")).toEqual({
      from: new Date("2026-11-04T15:00:00Z"),
      to: new Date("2026-11-05T15:00:00Z"),
    });
  });
});

describe("진도", () => {
  it("교재 완료: 끝까지 + 최소 시간 (1분 ~ 15분)", () => {
    expect(minTextSeconds(100)).toBe(60);
    expect(minTextSeconds(15000)).toBe(600);
    expect(minTextSeconds(1_000_000)).toBe(900);
    expect(isTextDone({ reachedEnd: true, textSeconds: 599, textChars: 15000 })).toBe(false);
    expect(isTextDone({ reachedEnd: true, textSeconds: 600, textChars: 15000 })).toBe(true);
    expect(isTextDone({ reachedEnd: false, textSeconds: 9999, textChars: 15000 })).toBe(false);
  });

  it("영상 완료: 90%", () => {
    expect(isVideoDone(539, 600)).toBe(false);
    expect(isVideoDone(540, 600)).toBe(true);
    expect(isVideoDone(100, null)).toBe(false);
  });

  it("챕터 완료: 교재 + 모든 영상 + 모든 체크", () => {
    const base = { textDone: true, videos: ["a", "b"], videosDone: ["a", "b"], checks: 3, checksDone: 3 };
    expect(isChapterDone(base)).toBe(true);
    expect(isChapterDone({ ...base, videosDone: ["a"] })).toBe(false);
    expect(isChapterDone({ ...base, checksDone: 2 })).toBe(false);
    expect(isChapterDone({ ...base, textDone: false })).toBe(false);
    expect(isChapterDone({ ...base, videos: [], videosDone: [], checks: 0, checksDone: 0 })).toBe(true);
  });

  it("과정 진도율: 지금 버전의 챕터 기준 (사라진 챕터는 빼고)", () => {
    expect(coursePercent(["ch01", "ch02", "ch03"], ["ch01", "ch09"])).toBe(33);
    expect(coursePercent([], [])).toBe(0);
  });
});
