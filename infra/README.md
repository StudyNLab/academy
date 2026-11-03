# 서버 운영 안내 (테스트 운영)

| VM | 역할 | 내부망 | 노트북에서 SSH |
|---|---|---|---|
| Academy-app | Caddy · web · worker (`~/aionit/`) | 172.30.0.10 | `ssh -o ProxyJump=user1@10.100.4.52 -p 22061 user1@127.0.0.1` |
| Academy-data | PostgreSQL · Garage · 백업 (`~/aionit/`, 데이터 `/srv/data/`) | 172.30.0.20 | `… -p 22062 …` |
| Academy-dev | 개발 서비스 + **이미지 빌드** | 연결 안 됨 | `… -p 22063 …` |

- 모두 호스트 TrainingGround(10.100.4.52)의 VirtualBox VM. VPN 이 필요하다.
- data VM 의 PostgreSQL(5432) · Garage(3900)는 내부망 주소에만 열려 있다. 개발 VM 에서는 닿지 않는다 (확인함).
- 비밀값: app VM `~/aionit/.env`, data VM `~/aionit/.env` · `~/aionit/garage-key.txt` · `/srv/data/garage/garage.toml` (모두 600, Git 제외).
- app VM `.env` 의 이름 (값은 VM 에만): `CADDY_TAG` `APP_TAG` `NODE_ENV` `DATABASE_URL` `BETTER_AUTH_SECRET`(VM 에서 `openssl rand` 로 만듦) `BETTER_AUTH_URL`(=https://localhost:18443) `SMTP_URL`(=smtp://mailpit:1025) `MAIL_FROM` `MAILPIT_TAG`, 앱 등록 뒤 `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `KAKAO_CLIENT_ID` `KAKAO_CLIENT_SECRET`.

## 사이트 보기 (도메인 전)

호스트의 127.0.0.1:18443 이 app VM 의 443 으로 연결되어 있다. 노트북에서:

```bash
ssh -N -L 18443:127.0.0.1:18443 user1@10.100.4.52
```

그다음 https://localhost:18443 . 인증서는 Caddy 내부 인증서라 브라우저 경고가 뜬다 (도메인이 생기면 Let's Encrypt 로 바뀐다).

## 테스트 서버 메일 보기 (Mailpit)

메일 발송 서비스를 정하기 전에는 app VM 의 Mailpit 이 메일을 받아 모아 둔다 (밖으로 나가지 않는다). 노트북에서:

```bash
ssh -N -o ProxyJump=user1@10.100.4.52 -p 22061 -L 18026:127.0.0.1:8025 user1@127.0.0.1
```

그다음 http://localhost:18026 . (개발 VM 의 Mailpit 은 `pnpm dev:tunnel` 의 http://localhost:18025)

## 첫 운영자 지정

가입 · 메일 인증을 마친 계정에 서버 명령으로 역할을 준다. 그 뒤의 역할 변경은 관리자 화면(회원 ➔ 역할)에서 하고 모두 기록에 남는다.

```bash
# app VM
cd ~/aionit && docker compose run --rm --no-deps worker pnpm --filter @aionit/worker grant-role <이메일> operator "첫 운영자"
```

그 회원은 다시 로그인 ➔ 로그인 · 보안에서 2단계 인증(인증 앱)을 켜야 `/admin` 에 들어간다.

## 배포

```bash
bash infra/scripts/deploy.sh
```

1. 커밋된 HEAD 를 개발 VM 으로 보내 이미지(web · worker) 빌드 — 태그는 커밋 해시
2. 이미지를 앱 VM 으로 옮김 (노트북을 거쳐 `docker save | docker load`, 레지스트리 없음)
3. 서버 설정(compose · Caddyfile · 백업 스크립트) 반영
4. **배포 전 DB 백업** (`pre-deploy-<태그>`) ➔ 마이그레이션
5. 전환 ➔ 상태 확인(`/api/health`). 실패하면 직전 버전으로 자동 되돌림

| 명령 | 쓰임 |
|---|---|
| `deploy.sh` | 커밋한 코드 배포 (커밋 안 된 변경이 있으면 멈춤) |
| `deploy.sh --rollback` | 직전 버전으로 되돌리기 |
| `deploy.sh --worktree` | 개발 중 시험용. 커밋 전 작업 트리를 `wt-…` 태그로 배포 |

- DB 는 마이그레이션 되돌리기를 하지 않는다. 문제가 생기면 `pre-deploy-<태그>` 백업으로 복구하거나 고치는 마이그레이션을 새로 만든다.
- data VM 의 compose 는 배포 때 바꾸지 않는다. 바꿀 때는 data VM 에서 직접 `docker compose up -d` (DB 재시작이 따르므로 신중하게).

## 백업

| 항목 | 내용 |
|---|---|
| 무엇 | PostgreSQL 전체 (`pg_dump -Fc`) + sha256 |
| 언제 | 매일 03:30 KST (data VM cron), 배포 직전 |
| 어디 | data VM `/srv/data/backup/db/` (7일) ➔ **호스트 `G:\AIONIT-backup\db\`** (공유 폴더, 35일) |
| 기록 | data VM `~/aionit/backup.log` |

- 공유 폴더는 systemd mount 단위 `mnt-aionit\x2dbackup.mount` 로 붙인다. 공유 폴더가 없어도 VM 부팅은 막히지 않는다 (백업 스크립트가 경고만 남김).
- 복구 시험(2026-11-04): 백업을 새 DB 에 `pg_restore` ➔ 테이블 수 원본과 같음(16) ➔ 시험 DB 삭제. **매달 한 번 반복한다.**
- 아직 안 한 것: Garage 파일 백업(올릴 파일이 생기는 M2 에서), NAS(F:) 로 두 번째 사본(M10).

## 상태 확인

```bash
# app VM
docker ps --format "{{.Names}} {{.Status}}"
curl -sk https://localhost/api/health
docker compose -f ~/aionit/compose.yaml logs -f web
```
