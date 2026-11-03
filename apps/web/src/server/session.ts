import "server-only";
import type { Role } from "@aionit/db";
import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";
import { getAuth } from "./auth-instance";
import { getDb } from "./db";
import type { Viewer } from "./viewer";
import { loadViewer, staffAccess } from "./viewer";

/** 화면(서버 컴포넌트)용. 한 요청 안에서는 한 번만 조회한다. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  return loadViewer(getAuth(), getDb(), await headers());
});

/** 로그인이 필요한 화면. 로그인하지 않았으면 로그인 화면으로 보내고, 로그인 뒤 돌아온다. */
export async function requireViewer(next: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}

/** 관리자 · 강사 화면 */
export async function requireStaff(role: Role, next: string): Promise<Viewer> {
  const viewer = await getViewer();
  const access = staffAccess(viewer, role);
  // redirect · forbidden 은 던지므로 아래로 이어지지 않는다
  if (access === "login") redirect(`/login?next=${encodeURIComponent(next)}`);
  if (access === "forbidden") forbidden();
  if (access === "setup_2fa") redirect(`/my/security?required=1&next=${encodeURIComponent(next)}`);
  if (access === "verify_2fa") redirect(`/login/two-factor?stepup=1&next=${encodeURIComponent(next)}`);
  return viewer!;
}
