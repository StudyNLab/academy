# 서버 운영 안내 (테스트 운영)

| VM | 역할 | 내부망 | 노트북에서 SSH |
|---|---|---|---|
| Academy-app | Caddy · web · worker (`~/aionit/`) | 172.30.0.10 | `ssh -o ProxyJump=user1@10.100.4.52 -p 22061 user1@127.0.0.1` |
| Academy-data | PostgreSQL · Garage · 백업 (`~/aionit/`, 데이터 `/srv/data/`) | 172.30.0.20 | `… -p 22062 …` |
| Academy-dev | 개발 서비스 + **이미지 빌드** | 연결 안 됨 | `… -p 22063 …` |

- 모두 호스트 TrainingGround(10.100.4.52)의 VirtualBox VM. VPN 이 필요하다.
- data VM 의 PostgreSQL(5432) · Garage(3900 S3 API · 3902 웹 주소)는 내부망 주소에만 열려 있다. 개발 VM 에서는 닿지 않는다 (확인함).
- Garage 웹 주소(3902, `garage.toml` 의 `[s3_web]`, root_domain `.web.garage`)는 **영상 버킷 `aionit-media` 만** 웹 공개 설정(`garage bucket website --allow aionit-media`)이다. app VM Caddy 가 `/media/*` 요청마다 web 에 재생 토큰을 확인한 뒤 Host `aionit-media.web.garage` 로 프록시한다. 다른 버킷은 웹 공개하지 않는다.
- 비밀값: app VM `~/aionit/.env`, data VM `~/aionit/.env` · `~/aionit/garage-key.txt` · `/srv/data/garage/garage.toml` (모두 600, Git 제외).
- app VM `.env` 의 이름 (값은 VM 에만): `CADDY_TAG` `APP_TAG` `NODE_ENV` `DATABASE_URL` `BETTER_AUTH_SECRET`(VM 에서 `openssl rand` 로 만듦) `BETTER_AUTH_URL`(=https://localhost:18443) `SMTP_URL`(=smtp://mailpit:1025) `MAIL_FROM` `MAILPIT_TAG`, 앱 등록 뒤 `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `KAKAO_CLIENT_ID` `KAKAO_CLIENT_SECRET`, 파일 저장소 `S3_ENDPOINT`(=http://172.30.0.20:3900) `S3_REGION` `S3_BUCKET`(=aionit) `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY`(data VM `garage-key.txt` 의 aionit-app 키), 영상 버킷 `S3_MEDIA_BUCKET`(=aionit-media, M4). 토스페이먼츠 결제위젯 연동 키 `TOSS_CLIENT_KEY` `TOSS_SECRET_KEY`(M5: 토스 문서용 공개 테스트 키 `test_gck_docs_…` / `test_gsk_docs_…`, 실오픈 때 운영자 상점 키). 구독 자동결제 API 개별 연동 키 `TOSS_BILLING_CLIENT_KEY` `TOSS_BILLING_SECRET_KEY`(M6, 운영자 본인 테스트 키. 없으면 구독 신청 · worker 자동결제가 꺼진다). `TOSS_FAKE` 는 개발 서버 전용이라 서버에 두지 않는다.

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
   - 패키지 목록이 그대로면 설치를 건너뛰고, 내려받은 패키지 · Next.js 빌드 결과는 개발 VM 빌드 캐시에서 다시 쓴다
   - 이미지마다 20분을 넘기면 끊는다 (서버는 그대로)
2. 이미지를 앱 VM 으로 옮김 — 개발 VM 의 보관소(`aionit-registry`, `127.0.0.1:5055`) 에 올리고, 배포하는 동안만 노트북을 거치는 SSH 터널로 앱 VM 이 받아 간다. **바뀐 층만** 옮겨진다
3. 서버 설정(compose · Caddyfile · 백업 스크립트) 반영
4. **배포 전 DB 백업** (`pre-deploy-<태그>`) ➔ 마이그레이션
5. 전환 ➔ 상태 확인(`/api/health`). 실패하면 직전 버전으로 자동 되돌림

| 명령 | 쓰임 |
|---|---|
| `deploy.sh` | 커밋한 코드 배포 (커밋 안 된 변경이 있으면 멈춤). 서버에 이미 있는 버전이면 아무것도 하지 않고 끝남 |
| `deploy.sh --force` | 서버에 이미 있는 버전도 처음부터 다시 배포 (서버 파일을 손으로 고쳤을 때 등). 되돌릴 버전은 그대로 |
| `deploy.sh --rollback` | 되돌릴 버전(`~/aionit/.previous_tag`)으로 되돌리기 |
| `deploy.sh --worktree` | 개발 중 시험용. 커밋 전 작업 트리를 `wt-…` 태그로 배포 |

- 모르는 옵션(예: `--rolback` 오타)을 주면 아무것도 하지 않고 멈춘다.
- 단계마다 걸린 시간과 전체 시간을 찍는다. 첫 배포(캐시 · 보관소가 빈 상태)는 느리고, 그다음부터 빨라진다.
- **되돌릴 버전**: app VM `~/aionit/.previous_tag`. 새 버전을 배포하면 그 직전에 돌던 버전이 된다. 같은 버전을 다시 배포(`--force`)하면 바뀌지 않는다. 상태 확인에 실패해 자동으로 되돌리면 원래 값으로 돌려놓는다.
- 같은 버전 `--force` 가 상태 확인에 실패하면 다른 버전으로 자동으로 바꾸지 않는다 (안내대로 `--rollback`).
- `--rollback` 은 되돌릴 버전이 없거나, 지금 버전과 같거나, 그 이미지가 app VM 에 없으면 서버를 건드리지 않고 멈춘다.
- 이미지(app VM · 개발 VM) · 보관소에는 **현재 버전과 되돌릴 버전만** 남기고 배포 끝에 정리한다. 개발 VM 빌드 캐시는 15GB 를 넘지 않게 정리한다.
- 배포 스크립트를 고치면 `bash infra/scripts/test-deploy.sh` 로 시험한다. ssh · git 을 가짜로 바꿔 VM 세 대를 노트북 임시 폴더로 흉내 내므로 서버에 닿지 않는다 (1분쯤).
- DB 는 마이그레이션 되돌리기를 하지 않는다. 문제가 생기면 `pre-deploy-<태그>` 백업으로 복구하거나 고치는 마이그레이션을 새로 만든다.
- data VM 의 compose 는 배포 때 바꾸지 않는다. 바꿀 때는 data VM 에서 직접 `docker compose up -d` (DB 재시작이 따르므로 신중하게).

## 백업

| 항목 | 내용 |
|---|---|
| 무엇 | PostgreSQL 전체 (`pg_dump -Fc`) + sha256, **파일 저장소(Garage 버킷 `aionit`)** — rclone 으로 바뀐 것만 |
| 언제 | 매일 03:30 KST (data VM cron), 배포 직전 |
| 어디 | DB: data VM `/srv/data/backup/db/` (7일) ➔ **호스트 `G:\AIONIT-backup\db\`** (공유 폴더, 35일). 파일: `G:\AIONIT-backup\files\aionit\` (바뀌거나 지워진 파일은 `files\changed\<날짜>\` 에 35일) |
| 기록 | data VM `~/aionit/backup.log` |

- 공유 폴더는 systemd mount 단위 `mnt-aionit\x2dbackup.mount` 로 붙인다. 공유 폴더가 없어도 VM 부팅은 막히지 않는다 (백업 스크립트가 경고만 남김).
- 복구 시험(2026-11-04): 백업을 새 DB 에 `pg_restore` ➔ 테이블 수 원본과 같음(16) ➔ 시험 DB 삭제. **매달 한 번 반복한다.**
- 파일 백업은 **읽기 전용 키**(`aionit-backup`, data VM `~/aionit/garage-backup.env`, 600)로 한다. 백업 스크립트가 지워져도 저장소를 고칠 수 없다. 이미지 `rclone/rclone:1.75.2`.
- 아직 안 한 것: NAS(F:) 로 두 번째 사본 · 파일 복구 훈련(M10).

## 상태 확인

```bash
# app VM
docker ps --format "{{.Names}} {{.Status}}"
curl -sk https://localhost/api/health
docker compose -f ~/aionit/compose.yaml logs -f web
```
