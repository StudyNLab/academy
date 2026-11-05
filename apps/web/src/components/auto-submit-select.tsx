"use client";

import type { ComponentProps } from "react";

/** 고르면 바로 그 form 을 보낸다 (GET 검색 조건). 스크립트가 없으면 form 의 검색 단추로 보낸다 */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(event) => event.currentTarget.form?.requestSubmit()} />;
}
