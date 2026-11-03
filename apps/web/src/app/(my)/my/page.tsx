import type { Metadata } from "next";
import { isDeliverableEmail, nextNicknameChangeAt } from "@aionit/core";
import { eq, schema } from "@aionit/db";
import { PageTitle } from "@/components/page-title";
import { latestConsents } from "@/server/consents";
import { getDb } from "@/server/db";
import { socialProviders } from "@/server/providers";
import { requireViewer } from "@/server/session";
import { LinkedAccounts, MarketingToggle, NicknameForm } from "./my-forms";

export const metadata: Metadata = { title: "내 정보" };

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line-strong py-7">
      <h2 className="m-0 text-[21px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

// M-01 내 정보: 닉네임, 이메일, 로그인 연결(구글 · 카카오), 마케팅 수신 동의
export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await requireViewer("/my");
  const db = getDb();
  const [user] = await db
    .select({ nicknameChangedAt: schema.users.nicknameChangedAt, createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.id, viewer.userId));
  const accounts = await db
    .select({ providerId: schema.authAccounts.providerId })
    .from(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, viewer.userId));
  const consents = await latestConsents(db, viewer.userId);
  const nextChange = nextNicknameChangeAt(user?.nicknameChangedAt ?? null, new Date());
  const params = await searchParams;

  return (
    <>
      <PageTitle label="My page" title="내 정보" />
      <Section title="기본 정보">
        <dl className="m-0 grid grid-cols-[96px_1fr] gap-y-3 text-[15px]">
          <dt className="text-ink-2">이메일</dt>
          <dd className="m-0 break-all">
            {isDeliverableEmail(viewer.email) ? viewer.email : "등록된 이메일 없음 (카카오 로그인)"}
          </dd>
          <dt className="text-ink-2">가입일</dt>
          <dd className="m-0">{user ? date.format(user.createdAt) : "-"}</dd>
        </dl>
        <NicknameForm current={viewer.nickname} nextChangeAt={nextChange ? date.format(nextChange) : null} />
      </Section>
      <Section title="로그인 연결">
        <LinkedAccounts
          linked={accounts.map((a) => a.providerId)}
          available={socialProviders()}
          linkError={params.error ?? null}
        />
      </Section>
      <Section title="알림 · 동의">
        <MarketingToggle agreed={consents.get("marketing")?.agreed ?? false} />
      </Section>
    </>
  );
}
