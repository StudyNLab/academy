-- 1. 기록 테이블은 덧붙이기만 한다 (docs/기술설계.md 3.3).
--    UPDATE 는 언제나 막는다. DELETE 는 보관 기간이 지난 행을 지우는 작업만:
--    같은 트랜잭션 안에서 `set local aionit.retention_purge = 'on'` 을 한 경우에만 된다.
CREATE FUNCTION aionit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% 는 덧붙이기만 할 수 있습니다 (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER login_logs_append_only BEFORE UPDATE OR DELETE ON login_logs
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER pii_access_logs_append_only BEFORE UPDATE OR DELETE ON pii_access_logs
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
-- TRUNCATE 도 막는다 (행 단위 트리거는 TRUNCATE 에 걸리지 않는다)
CREATE FUNCTION aionit_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% 는 비울 수 없습니다', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER login_logs_no_truncate BEFORE TRUNCATE ON login_logs
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER pii_access_logs_no_truncate BEFORE TRUNCATE ON pii_access_logs
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
-- 2. 가입 동의 문서 초안 (실오픈 전 법률 검토 후 새 버전으로 바꾼다, 개발계획 M10)
INSERT INTO policy_documents (kind, version, title, body_md, required, effective_from) VALUES
('terms', '2026-11-04-draft', '이용약관', $md$
> 초안입니다. 테스트 기간에만 쓰고, 실오픈 전에 법률 검토를 거친 새 버전으로 바꿉니다.

1. 이 약관은 AIONIT(이하 "사이트")가 제공하는 온라인 강의 서비스의 이용 조건을 정합니다.
2. 회원은 만 14세 이상이어야 가입할 수 있습니다.
3. 회원은 계정을 다른 사람과 함께 쓰거나 강의 내용을 허락 없이 퍼뜨려서는 안 됩니다.
4. 결제 · 환불은 환불 정책을 따릅니다.
5. 회원은 언제든 마이페이지에서 탈퇴할 수 있습니다. 탈퇴하면 개인정보를 지우고, 강의 Q&A 에 쓴 글은 "탈퇴한 회원"으로 표시해 남깁니다.
$md$, true, '2026-11-04T00:00:00+09:00'),
('privacy', '2026-11-04-draft', '개인정보 수집 · 이용 동의', $md$
> 초안입니다. 테스트 기간에만 쓰고, 실오픈 전에 법률 검토를 거친 새 버전으로 바꿉니다.

| 항목 | 내용 |
|---|---|
| 수집하는 정보 | 이메일, 닉네임, 비밀번호(되돌릴 수 없게 바꾼 값), 구글 · 카카오 계정 식별값, 로그인 기록(시각 · IP · 브라우저) |
| 쓰는 곳 | 회원 확인, 로그인, 강의 제공, 문의 응대, 부정 이용 방지 |
| 보관 기간 | 탈퇴할 때까지. 단, 로그인 기록은 법에 따라 6개월, 결제 기록은 5년 보관 후 지웁니다 |
| 동의하지 않으면 | 가입할 수 없습니다 |
$md$, true, '2026-11-04T00:00:00+09:00'),
('marketing', '2026-11-04-draft', '마케팅 정보 수신 동의', $md$
> 초안입니다.

새 강의 · 할인 소식을 이메일로 받습니다. 동의하지 않아도 가입 · 수강에 아무 제한이 없고, 내 정보에서 언제든 끌 수 있습니다.
$md$, false, '2026-11-04T00:00:00+09:00');
