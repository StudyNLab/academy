# 운영 서버 (클라우드 한 대) 옮기는 순서

> 왜 이 구성인지는 `docs/클라우드_배포_검토.md`. 여기는 **실제로 옮길 때의 순서**다. 아직 서버는 없다 (2026-11-07).
> 테스트 서버(사무실 VM 두 대)는 그대로 두고 **시험 서버**로 쓴다. 배포는 테스트 서버에 먼저(`deploy.sh`), 확인한 뒤 운영 서버에(`deploy.sh --cloud`).

## 무엇이 어디에

| 파일 | 서버의 자리 | 하는 일 |
|---|---|---|
| `infra/cloud/compose.yaml` | `~/aionit/compose.yaml` | Caddy · web · worker · PostgreSQL · Garage 를 한 서버에. 밖에는 80 · 443 만 연다. 배포 때마다 복사 |
| `infra/cloud/Caddyfile` | `~/aionit/Caddyfile` | 도메인 + Let's Encrypt, 관리자 화면 IP 제한, `/media` 는 garage 컨테이너에서. 배포 때마다 검사 뒤 복사 |
| `infra/cloud/backup.conf` | `~/aionit/backup.conf` | 같은 `backup.sh` 를 한 서버용으로 (쌓는 곳 `/srv/backup`, app 설정은 같은 서버에서). 배포 때마다 복사 |
| `infra/app-vm/config-backup.sh` | `~/aionit/config-backup.sh` | app 쪽 설정 · Caddy 인증서 묶음 (암호화). 배포 때마다 복사 |
| `infra/cloud/monitor/*` | `~/aionit-monitor/` | 감시 (Gatus). 배포와 따로, 손으로 복사 |
| `infra/cloud/pull-backup.sh` | 사무실 **테스트 서버 data VM** `~/aionit/pull-backup.sh` | 운영 서버 백업을 매일 사무실(G: ➔ F:)로 받아 옴 |
| `infra/scripts/deploy.sh --cloud` | 노트북 | 배포 대상만 운영 서버로. 빌드는 그대로 사무실 개발 VM, 이미지는 노트북을 거친 SSH 터널로 바뀐 층만 |

## 순서

| # | 무엇 | 누가 |
|---|---|---|
| 0 | AWS 가입 ➔ **바로 유료 플랜으로 전환**(남은 크레딧은 그대로 쓰인다) ➔ 루트 2단계 인증 ➔ 예산 알림(예: 월 $20) ➔ Claude 용 **Lightsail · SES 만 쓰는 키** 발급 ➔ `E:\온라인아카데미_비밀보관\` 에. 도메인 구입. 사무실 공인 IP 알려주기 | 운영자 |
| 1 | 서버 만들기: Lightsail 서울(ap-northeast-2) Ubuntu 24.04 · **2GB 요금제**, 고정 IP 붙이기, 방화벽 22 는 사무실 공인 IP 만 · 80 · 443 은 모두, 자동 스냅샷 켜기 | Claude |
| 2 | 서버 기본: 보안 업데이트 · 자동 보안 업데이트, `docker.io docker-compose-v2 rsync`, user1 을 docker 그룹에, **스왑 2GB**(`/swapfile`), 저널 상한(`infra/vm-common/journald-aionit.conf`), 시간 맞추기, 폴더 `/srv/data/postgres` · `/srv/data/garage/{meta,data}` · `/srv/backup`(user1 소유) · `~/aionit` | Claude |
| 3 | 노트북 `~/.ssh/config` 에 `Host aionit-cloud` (고정 IP · user1 · 키). 운영 서버에서 `ssh aionit-cloud docker ps` 확인 | Claude |
| 4 | 테스트 서버 시험 데이터 정리 (`docs/베타오픈_체크리스트.md` 1-13, 운영자 확인 뒤, DB 백업 먼저) | Claude (운영자 확인) |
| 5 | 비밀값 · 설정 (값은 서버에만, 아래 '`.env` 에서 바뀌는 것') ➔ `docker compose up -d postgres garage` | Claude |
| 6 | 데이터 옮기기: 테스트 서버에서 `backup.sh` 수동 ➔ 운영 서버에 DB 역할(`globals.sql`) ➔ `pg_restore` ➔ Garage 배치 · 버킷 · **예전 키 그대로** ➔ 파일(rclone) ➔ 테이블별 행 수 · 버킷별 개수 대조. 순서는 `infra/data-vm/restore.sh` 와 같고, 그 스크립트를 한 서버(주소 · compose 위치)에 맞춰 쓴다 | Claude |
| 7 | DNS: 도메인 A 레코드 ➔ 고정 IP, SES 인증(DKIM CNAME 3개 · SPF · DMARC) | 운영자(도메인 업체 화면) 또는 키를 주면 Claude |
| 8 | SES 발송 제한 해제 신청 (계정 주인 몫, 문안은 Claude) | 운영자 |
| 9 | 첫 배포 `bash infra/scripts/deploy.sh --cloud` ➔ Caddy 가 인증서를 받는다 ➔ 화면 · 로그인 · 영상 · 메일 확인 | Claude |
| 10 | 감시: `~/aionit-monitor` 에 `infra/cloud/monitor/*` + `.env` ➔ 알림 메일 시험 (`infra/README.md` 감시와 같은 순서) | Claude |
| 11 | 백업: cron 03:30 `backup.sh`, 사무실 받아 오기(아래), **운영 서버에서 복구 훈련 1번** | Claude |
| 12 | 바깥 감시: 테스트 서버 Gatus 에 운영 사이트(`https://<도메인>/api/health` · 인증서 30일) 항목을 더함 ➔ 운영 서버가 통째로 멈춰도 알림 | Claude |
| 13 | 보안 직접 점검(`docs/보안점검.md` 2장) ➔ 초대 시작 | 운영자 |

## `.env` 에서 바뀌는 것 (테스트 서버 app VM `.env` 기준)

| 이름 | 운영 서버 |
|---|---|
| `APP_TAG` | 처음에는 `none` (첫 배포가 채운다) |
| `SITE_HOST` · `ACME_EMAIL` · `ADMIN_ALLOW_IPS` | 새로 (Caddyfile 자리). `ADMIN_ALLOW_IPS` 는 사무실 공인 IP 대역, 여럿이면 빈칸으로 |
| `BETTER_AUTH_URL` | `https://<도메인>` |
| `DATABASE_URL` | 주소만 `postgres:5432` (계정 `aionit_app` 그대로) |
| `S3_ENDPOINT` | `http://garage:3900` |
| `SMTP_URL` · `MAIL_FROM` | SES 서울 SMTP (`email-smtp.ap-northeast-2.amazonaws.com:587`) · 도메인 주소. `MAILPIT_TAG` 는 지운다 |
| `POSTGRES_TAG` · `GARAGE_TAG` | 테스트 서버 data VM `.env` 와 같은 값 |
| `WORKER_MEM_LIMIT` | 2GB 서버는 `1g` (기본값). 서버를 키우면 올린다 |
| `MONITOR_WORKER_PUSH_URL` | 그대로 (`http://gatus:8080/…`, 감시가 같은 망에 붙는다) |
| 그 밖 (앱 비밀값 · 로그인 · 토스 · 사업자 정보 · S3 키) | **그대로 옮긴다**. 앱 비밀값이 바뀌면 영상 키를 풀 수 없다 |

- `~/aionit/.env.data`: `POSTGRES_PASSWORD` 하나 (DB 소유자, postgres 컨테이너에만). 테스트 서버 data VM `.env` 의 값
- `~/aionit/.env.migrate`: `MIGRATION_DATABASE_URL` (소유자 계정, 주소만 `postgres:5432`)
- `/srv/data/garage/garage.toml`: 테스트 서버의 것 그대로 (설정 백업에 있다). S3 API · 웹 주소가 `0.0.0.0` / `[::]` 에 묶여 있는지 확인 (컨테이너 망 안에서만 닿는다)
- `~/aionit/garage-backup.env`: 읽기 전용 키 그대로, 주소만 `http://garage:3900`
- `~/aionit/monitor.env`: `BACKUP_PUSH_URL=http://127.0.0.1:8085/api/v1/endpoints/backup_daily-backup/external`
- `~/aionit/backup-recipient.pem`: 테스트 서버와 같은 공개 인증서 (개인키는 운영자 PC 에만)
- 모두 600

## 백업 받아 오기 (사무실)

1. 테스트 서버 data VM 에서 키 만들기: `ssh-keygen -t ed25519 -N '' -f ~/.ssh/aionit_cloud_backup -C 'aionit-office backup pull'`
2. 운영 서버 `~/.ssh/authorized_keys` 에 **읽기 전용으로만**: `command="rrsync -ro /srv/backup",restrict ssh-ed25519 AAAA… aionit-office backup pull`
3. 운영 서버 방화벽 22 에 사무실 공인 IP (테스트 서버도 그 IP 로 나간다)
4. data VM `~/aionit/cloud-backup.env`: `CLOUD_BACKUP_HOST=<고정 IP>` (`CLOUD_BACKUP_USER` 는 기본 user1), `pull-backup.sh` 복사, `crontab`: `10 4 * * * ~/aionit/pull-backup.sh`
5. 결과: `G:\AIONIT-backup\cloud\` ➔ 04:30 호스트 예약 작업이 `F:` 로 (지금 흐름 그대로). 기록 data VM `~/aionit/pull-backup.log`

## 서버 키우기 (메모리가 모자라면)

- 기준: 평소 `free -m` 의 available 이 300MB 밑이거나 스왑을 계속 쓰면.
- Lightsail 스냅샷 ➔ 그 스냅샷으로 4GB 요금제 새 서버 ➔ 고정 IP 옮겨 붙이기 ➔ 옛 서버 지우기 (멈추는 시간 약 15분, 추정). `.env` 의 `WORKER_MEM_LIMIT` 를 `2g` 로.
