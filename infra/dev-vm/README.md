# 개발 VM (Academy-dev)

노트북에서 개발할 때 쓰는 PostgreSQL · Garage(S3) · Mailpit 을 띄우고, 배포 이미지를 빌드 · 보관하는 VM. 테스트 운영 서버의 내부망(academy-int)에는 붙지 않는다. 앱 VM 과는 브리지 망(사내망)으로 이미지 보관소만 이어져 있다.

| 항목 | 값 |
|---|---|
| 위치 | 호스트 TrainingGround (10.100.4.52), `D:\VirtualBox VMs\Academy\Academy-dev` |
| 사양 | Ubuntu 24.04.2, 4 vCPU, 6GB, 60GB |
| 접속 | `ssh -o ProxyJump=user1@10.100.4.52 -p 22063 user1@127.0.0.1` (키 로그인만, VPN 필요) |
| 랜카드 | NIC1 NAT (인터넷 · SSH 포트 포워딩, 기본 경로 · DNS), NIC2 브리지 `enp0s8` 10.20.30.63/8 (게이트웨이 · DNS 없음, `/etc/netplan/60-bridge.yaml`) |
| 서비스 폴더 | VM 의 `~/aionit-dev/` (`compose.yaml`, `.env`), 데이터 `/srv/dev/` |
| 비밀값 | VM 의 `~/aionit-dev/.env` (DB 비밀번호), `~/aionit-dev/garage-key.txt` (S3 키), `/srv/dev/garage/garage.toml` — 모두 권한 600, Git 에 올리지 않는다 |

## 서비스

| 서비스 | 이미지 | VM 안 주소 | 노트북 터널 주소 |
|---|---|---|---|
| PostgreSQL | `postgres:18.6` | 127.0.0.1:5432 | `localhost:15432` (DB `aionit`, 사용자 `aionit`) |
| Garage S3 API | `dxflrs/garage:v2.5.0` | 127.0.0.1:3900 | `localhost:23900` (버킷 `aionit-dev` · 영상 `aionit-dev-media`, 지역 `garage`) |
| Garage 관리 API | 〃 | 127.0.0.1:3903 | (필요할 때만) |
| Mailpit SMTP | `axllent/mailpit:v1.33.0` | 127.0.0.1:1025 | `localhost:11025` |
| Mailpit 웹 화면 | 〃 | 127.0.0.1:8025 | http://localhost:18025 |

위 포트는 모두 VM 의 127.0.0.1 에만 열려 있다. 노트북에서는 SSH 터널로만 들어간다. 브리지 주소에 열린 것은 아래 이미지 보관소 하나다.

## 이미지 보관소 (aionit-registry)

배포 스크립트(`infra/scripts/deploy.sh`)가 빌드한 이미지를 올리고, 앱 VM 이 받아 간다.

| 항목 | 값 |
|---|---|
| 컨테이너 | `aionit-registry` (`registry:2.8.3`, `--restart=always`), 데이터는 docker 볼륨 `aionit-registry` |
| 주소 | `https://127.0.0.1:5055` (개발 VM 이 올릴 때), `https://10.20.30.63:5055` (앱 VM 이 받을 때) |
| 인증서 | 자체 인증서 `~/aionit-registry/certs/registry.crt` · `registry.key`(600), IP 10.20.30.63 · 127.0.0.1, 2036-11 까지. 앱 VM 은 `/etc/docker/certs.d/10.20.30.63:5055/ca.crt` 에 같은 crt 를 두어 이것만 믿는다 (docker 설정 · 재시작 필요 없음) |
| 막기 | systemd `aionit-registry-allow` (이 폴더의 `aionit-registry-allow.service`): docker 체인 `DOCKER-USER` 에 "enp0s8 로 들어온 5055 는 앱 VM 10.20.30.61 가 아니면 버림". docker 가 연 포트는 ufw 를 거치지 않아서 이렇게 막는다 |

- 배포 스크립트는 보관소가 두 주소에 열려 있지 않으면 같은 볼륨 · 인증서로 다시 만든다. (VM 을 다시 켤 때 브리지 주소가 늦게 붙어 보관소가 127.0.0.1 에만 떠도 다음 배포에서 바로잡힌다.)
- 확인: 앱 VM 에서 `curl --cacert /etc/docker/certs.d/10.20.30.63:5055/ca.crt https://10.20.30.63:5055/v2/` ➔ `{}`. 다른 곳(노트북 등)에서는 시간 초과.
- 앱 VM 주소가 바뀌면 `aionit-registry-allow.service` 의 `APP_BR` 을, 개발 VM 주소가 바뀌면 `deploy.sh` 의 `DEV_BR` · 인증서(IP 가 들어 있음) · 앱 VM `certs.d` 폴더 이름을 함께 바꾼다.
- 인증서를 새로 만들면(`openssl req -x509 … -addext subjectAltName=IP:10.20.30.63,IP:127.0.0.1`) 앱 VM 의 `ca.crt` 도 바꾸고 보관소를 다시 띄운다 (`docker restart aionit-registry`).

## 시험 DB (통합 테스트)

여러 작업 창이 한 시험 DB 를 같이 쓰면 서로 표를 비워 테스트가 깨진다 (2026-11-05 M8 · M9). 그래서 창마다 나눈다 (`apps/web/vitest.config.ts`).

| 어디서 | 시험 DB 이름 |
|---|---|
| 본 폴더 | `TEST_DATABASE_URL` 의 이름 그대로 (`aionit_test`) |
| 작업 창 (`.claude/worktrees/<이름>/`) | `aionit_<이름>_test` (`-` 는 `_`, 예: `m8-instructor-eba35f` ➔ `aionit_m8_instructor_eba35f_test`) |
| `TEST_DB_NAME` 을 주면 | 그 이름 (소문자 · 숫자 · `_`, `_test` 로 끝남). `pnpm test` 로도 넘어간다 (`turbo.json` passThroughEnv) |

- 서버 · 계정 · 비밀번호는 루트 `.env` 의 `TEST_DATABASE_URL` 것을 쓴다. 작업 창은 본 폴더의 `.env` 를 그대로 복사해 오면 된다.
- DB 가 없으면 테스트 시작 때 만들고 마이그레이션을 적용한다 (`apps/web/test/global-setup.ts`, 첫 줄에 `통합 테스트 DB: …` 를 찍는다).
- 다 쓴 창의 DB 는 지워도 된다 (진짜 데이터 없음). VM 에서:

```bash
cd ~/aionit-dev && docker compose exec -T postgres psql -U aionit -d aionit -Atc "select datname from pg_database where datname like '%\_test'"
docker compose exec -T postgres dropdb -U aionit aionit_<이름>_test
```

## 화면 흐름 시험 (e2e)

개발 서버(`next dev`)는 화면을 처음 열 때마다 변환해서 느리다 (같은 `/courses` 가 개발 서버 2~13초, 실제 빌드 0.12초). 전체 e2e 가 25분을 넘겼고, 시험 중 코드를 고치면 다시 변환하느라 시간이 넘쳐 실패했다. 그래서 전체 e2e 는 **노트북의 실제 빌드**로 돌린다 (`apps/web/scripts/e2e-build.mjs`).

```bash
pnpm dev:tunnel                                    # DB · S3 · Mailpit (따로 띄워 둠)
pnpm --filter @aionit/web test:e2e:build           # 전체 (컴퓨터 · 휴대폰 폭)
pnpm --filter @aionit/web test:e2e:build --project=desktop e2e/payment.spec.ts   # 뒤의 인자는 playwright 에 그대로
```

- 하는 일: `next build` (빌드 폴더 `apps/web/.next-e2e`) ➔ `next start` (:3800) + worker ➔ playwright ➔ 서버 · worker 를 내림. 띄운 PID 와 걸린 시간을 찍는다. 서버 · worker 기록은 `.next-e2e/e2e-logs/`.
- 포트 3800 은 `.claude/launch.json` 의 개발 서버(3000 ~ 3700)와 겹치지 않는다. 이미 쓰고 있으면 멈춘다 (`E2E_PORT` 로 바꾼다).
- `E2E_SKIP_BUILD=1`: 지난 빌드를 그대로 띄운다 (시험 파일만 고쳤을 때). `E2E_WORKER=0`: worker 를 띄우지 않는다 (이미 떠 있는 worker 를 쓸 때).
- DB · S3 · Mailpit 은 개발 서버와 같다 (루트 `.env`, 개발 VM 터널). 테스트 서버는 쓰지 않는다.
- 2026-11-06 전체: 빌드 34초 + 서버 준비 4초 + playwright 13분 5초 = **13분 43초** (12개 통과, 화면 폭 전용 10개 건너뜀). 개발 서버로는 25분 넘게 걸렸다.

실제 빌드는 `NODE_ENV=production` 이라 개발 서버와 다른 곳:

| 무엇 | 실제 빌드에서 | 시험용 빌드 |
|---|---|---|
| 가짜 결제 (`TOSS_FAKE=1`) | 꺼짐 | 빌드할 때 `AIONIT_E2E_BUILD=1` 을 넣어 이 빌드에서만 켠다. 이 값은 실행할 때가 아니라 **빌드할 때 코드에 박힌다** (`next.config.ts` `env`). 서버 이미지(Dockerfile)는 이 값 없이 빌드하므로 앱 VM 에서 환경변수를 넣어도 켜지지 않는다 (일반 빌드에 `TOSS_FAKE=1 AIONIT_E2E_BUILD=1` 을 주고 띄워도 가짜 결제 주소가 404 인 것을 확인) |
| 세션 쿠키 `Secure` | `BETTER_AUTH_URL` 이 https 일 때만 | `BETTER_AUTH_URL=http://localhost:3800` 이라 붙지 않는다 (http 에서도 로그인됨) |
| CSP `upgrade-insecure-requests` | 붙음 | 그대로 둔다. Chrome 은 localhost 를 올리지 않아 문제없다 |
| 메일 발송 · 로그인 횟수 제한 · 2단계 인증 | 개발 서버와 같음 | 같음 (횟수 제한은 시험이 시작 때 개발 DB 카운터를 비운다) |

화면을 고치면서 한두 개만 볼 때는 지금처럼 떠 있는 개발 서버로 `E2E_BASE_URL=http://localhost:<포트> pnpm --filter @aionit/web test:e2e`.

## 노트북에서 터널 열기

```bash
ssh -N -o ExitOnForwardFailure=yes -o ProxyJump=user1@10.100.4.52 -p 22063 -L 15432:127.0.0.1:5432 -L 23900:127.0.0.1:3900 -L 11025:127.0.0.1:1025 -L 18025:127.0.0.1:8025 user1@127.0.0.1
```

`pnpm dev:tunnel` 이 같은 일을 한다 (`tunnel.mjs`).

노트북 포트는 Windows 예약 범위를 피한다. S3 는 처음에 13900 이었는데 Windows 가 13816–14015 를 예약해 `bind: Permission denied` 로 터널이 안 열려서 **23900** 으로 옮겼다 (2026-11-06). 예약 범위 보기: `netsh interface ipv4 show excludedportrange protocol=tcp`. 포트를 바꾸면 `.env` 의 `S3_ENDPOINT` 도 같이 바꾼다.

## VM 에서 관리

```bash
cd ~/aionit-dev
docker compose ps
docker compose logs -f postgres
docker compose exec garage /garage status
```

- 이미지 버전을 올릴 때는 `.env` 의 `*_TAG` 를 바꾸고 `docker compose pull && docker compose up -d`.
- 개발 DB 는 언제든 지우고 다시 만들 수 있는 데이터만 둔다 (진짜 데이터 금지).
- 되돌리기: VirtualBox 스냅샷 `base1_dev_services` (서비스가 처음 뜬 상태).
