import { sql } from "@aionit/db";
import { getDb } from "@/server/db";

// 상태 확인 (감시 도구 · 배포 스크립트용). 내부 정보는 내보내지 않는다.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("health: db check failed", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
