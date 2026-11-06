"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * 화면이 브라우저에서 살아났는지 (hydration 이 끝났는지). 서버 HTML 과 hydration 전에는 false.
 * 그 사이에 바꾼 입력은 React 가 받지 못해 사라지므로, 입력 양식은 이 값이 true 가 될 때까지 끈다.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
