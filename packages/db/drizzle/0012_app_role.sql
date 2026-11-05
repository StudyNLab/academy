-- 앱 DB 계정 권한 분리 (M10, docs/기술설계.md 3.3)
-- 서버의 web · worker 는 aionit_app 으로 접속하고, 마이그레이션만 소유자 계정(이 파일을 실행하는 계정)으로 한다.
-- aionit_app 은 표를 만들거나 지우지 못하고, 기록 · 결제 테이블은 고치거나 지울 권한이 없다 (트리거보다 한 겹 더).
-- 보관 기간이 지난 기록은 소유자 권한 함수 aionit_purge_protected_records() 만 지운다. 기준 시각은 DB 의 now() 라서
-- 앱이 "먼 미래" 를 넘겨 전부 지울 수 없다.
-- 개발 · 테스트 DB 는 소유자 계정 그대로 쓴다 (역할만 만들어 둔다, 로그인 불가). 서버에서 켜는 법은 infra/README.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aionit_app') THEN
    CREATE ROLE aionit_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO aionit_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aionit_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aionit_app;
--> statement-breakpoint
-- 앞으로 이 계정이 만드는 표도 같은 권한 (기록 테이블을 새로 만들면 그 마이그레이션에서 REVOKE 를 함께 쓴다.
-- 빠뜨리면 apps/web/test/db-roles.test.ts 가 잡는다)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aionit_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aionit_app;
--> statement-breakpoint
-- 덧붙이기만 하는 기록 · 버전 테이블: 읽기 · 넣기만
REVOKE UPDATE, DELETE ON audit_logs, login_logs, pii_access_logs, prices, subscriber_discount_policies,
  revenue_policies, settlement_adjustments, payouts, inquiry_messages FROM aionit_app;
--> statement-breakpoint
-- 상태는 바뀌지만 지우지 않는 결제 · 구독 · 문의 기록
REVOKE DELETE ON orders, order_items, payments, refunds, subscriptions, subscription_cycles, subscription_notices,
  inquiries FROM aionit_app;
--> statement-breakpoint
-- 보관 기간 정리 (worker 가 매일 04:10 에 부른다). 기간은 packages/core RETENTION 과 같다:
-- 로그인 기록 회원 183일 · 운영자 · 강사 730일, 운영자 작업 · 개인정보 조회 730일, 1:1 문의 마지막 글부터 1095일
CREATE FUNCTION aionit_purge_protected_records() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  login_n bigint;
  audit_n bigint;
  pii_n bigint;
  inquiry_n bigint;
BEGIN
  PERFORM set_config('aionit.retention_purge', 'on', true);
  DELETE FROM login_logs
    WHERE (privileged = 'no' AND at < now() - interval '183 days')
       OR (privileged = 'yes' AND at < now() - interval '730 days');
  GET DIAGNOSTICS login_n = ROW_COUNT;
  DELETE FROM audit_logs WHERE at < now() - interval '730 days';
  GET DIAGNOSTICS audit_n = ROW_COUNT;
  DELETE FROM pii_access_logs WHERE at < now() - interval '730 days';
  GET DIAGNOSTICS pii_n = ROW_COUNT;
  DELETE FROM inquiry_messages
    WHERE inquiry_id IN (SELECT id FROM inquiries WHERE last_message_at < now() - interval '1095 days');
  DELETE FROM inquiries WHERE last_message_at < now() - interval '1095 days';
  GET DIAGNOSTICS inquiry_n = ROW_COUNT;
  PERFORM set_config('aionit.retention_purge', 'off', true);
  RETURN jsonb_build_object('loginLogs', login_n, 'auditLogs', audit_n, 'piiAccessLogs', pii_n,
    'inquiries', inquiry_n);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION aionit_purge_protected_records() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION aionit_purge_protected_records() TO aionit_app;
--> statement-breakpoint
-- 작업 대기열(pg-boss)은 앱이 표를 만들고 고친다 (대기열마다 표를 만든다). 그 스키마는 앱 계정 것으로 한다
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'pgboss') THEN
    CREATE SCHEMA pgboss AUTHORIZATION aionit_app;
    RETURN;
  END IF;
  ALTER SCHEMA pgboss OWNER TO aionit_app;
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p', 'v', 'S')
      -- 열에 딸린 시퀀스(serial · identity)는 표와 함께 바뀐다
      AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')))
  LOOP
    IF r.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE pgboss.%I OWNER TO aionit_app', r.relname);
    ELSIF r.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW pgboss.%I OWNER TO aionit_app', r.relname);
    ELSE
      EXECUTE format('ALTER TABLE pgboss.%I OWNER TO aionit_app', r.relname);
    END IF;
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pgboss'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO aionit_app', r.fn);
  END LOOP;
  FOR r IN
    SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pgboss' AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('ALTER TYPE pgboss.%I OWNER TO aionit_app', r.typname);
  END LOOP;
END
$$;
