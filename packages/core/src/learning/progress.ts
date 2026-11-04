// 진도 규칙 (docs/화면상세기획.md 1.4)
//   교재 완료: 마지막 Section 까지 내려가고 + 그 챕터에 머문 시간이 최소 기준(글 분량) 이상
//   영상 완료: 90% 이상 재생
//   챕터 완료: 교재 완료 + 모든 영상 완료 + 모든 체크

/** 글 분량에 따른 교재 최소 시간 (초): 1분에 1,500자 훑어 읽는 속도, 1분 ~ 15분 */
export function minTextSeconds(textChars: number): number {
  return Math.min(900, Math.max(60, Math.round(textChars / 25)));
}

export function isTextDone(input: { reachedEnd: boolean; textSeconds: number; textChars: number }): boolean {
  return input.reachedEnd && input.textSeconds >= minTextSeconds(input.textChars);
}

export function isVideoDone(watchedSec: number, durationSec: number | null, ratio = 0.9): boolean {
  return !!durationSec && durationSec > 0 && watchedSec >= durationSec * ratio;
}

export interface ChapterState {
  textDone: boolean;
  /** 이 챕터에서 볼 수 있는(연결된) 영상 key */
  videos: string[];
  videosDone: string[];
  checks: number;
  checksDone: number;
}

export function isChapterDone(state: ChapterState): boolean {
  return (
    state.textDone &&
    state.videos.every((v) => state.videosDone.includes(v)) &&
    state.checksDone >= state.checks
  );
}

/** 과정 진도율 (%): 완료한 챕터 ÷ 지금 공개 버전의 챕터 수. 사라진 챕터의 진도는 빼고 센다 */
export function coursePercent(chapterKeys: readonly string[], completedKeys: readonly string[]): number {
  if (chapterKeys.length === 0) return 0;
  const done = chapterKeys.filter((k) => completedKeys.includes(k)).length;
  return Math.round((done / chapterKeys.length) * 100);
}
