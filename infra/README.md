# 서버 운영 안내 (테스트 운영)

| VM | 역할 | 내부망 (academy-int) | 브리지 (사내망) | 노트북에서 SSH |
|---|---|---|---|---|
| Academy-app | Caddy · web · worker (`~/aionit/`) | 172.30.0.10 | 10.20.30.61 (enp0s9) | `ssh -o ProxyJump=user1@10.100.4.52 -p 22061 user1@127.0.0.1` |
| Academy-data | PostgreSQL · Garage · 백업 (`~/aionit/`, 데이터 `/srv/data/`) | 172.30.0.20 | 없음 | `… -p 22062 …` |
| Academy-dev | 개발 서비스 + **이미지 빌드 · 이미지 보관소** | 연결 안 됨 | 10.20.30.63 (enp0s8) | `… -p 22063 …` |

- 모두 호스트 TrainingGround(10.100.4.52)의 VirtualBox VM. VPN 이 필요하다.
- 랜카드: NIC1 NAT(인터넷 · SSH 포트 포워딩, 기본 경로 · DNS 는 여기), app · data 의 NIC2 academy-int, dev NIC2 · app NIC3 브리지(호스트 랜카드 Realtek). 브리지는 **개발 VM 이미지 보관소 ➔ 앱 VM** 이미지 받기에만 쓴다. 게이트웨이 · DNS 를 두지 않는다 (`/etc/netplan/60-bridge.yaml`).
- 브리지 주소는 **고정**(DHCP 쓰지 않음, /8, 운영자 지정 대역 10.20.30.x, 끝자리는 SSH 포트 끝자리). `10.20.30.62` 는 Academy-data 용으로 비워 둔다 (지금은 브리지 없음).
- 개발 VM 은 여전히 academy-int 에 붙지 않는다 (DB · 파일 저장소에 닿지 않음). 보관소(5055)는 앱 VM 브리지 주소에서만 받는다 (`infra/dev-vm/README.md` 의 '이미지 보관소').
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
2. 이미지를 앱 VM 으로 옮김 — 개발 VM 의 보관소(`aionit-registry`)에 `127.0.0.1:5055` 로 올리고, 앱 VM 이 브리지 망으로 `https://10.20.30.63:5055` 에서 바로 받아 간다 (노트북을 거치지 않음). **바뀐 층만** 옮겨진다
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
- 이미지(app VM · 개발 VM) · 보관소에는 **현재 버전과 되돌릴 버전만** 남기고 배포 끝에 정리한다.
- 개발 VM 빌드 캐시는 평소에 정리하지 않는다. 크기 · 기간으로 조금씩 지우면 바닥 층(corepack · 패키지 설치 · ffmpeg)부터 지워져 빌드가 처음부터 돈다 (2026-11-05: 46초 ➔ 150초). 개발 VM 빈 자리가 15GB 밑으로 내려가면 배포 끝에 **모두** 비우고 알린다 (`deploy.sh` 의 `DEV_MIN_FREE_GB`). 그다음 배포 한 번은 빌드가 처음부터라 느리다 (4분쯤, 데비안 저장소가 느리면 더).
- 배포 스크립트를 고치면 `bash infra/scripts/test-deploy.sh` 로 시험한다. ssh · git 을 가짜로 바꿔 VM 세 대를 노트북 임시 폴더로 흉내 내므로 서버에 닿지 않는다 (1분쯤).
- DB 는 마이그레이션 되돌리기를 하지 않는다. 문제가 생기면 `pre-deploy-<태그>` 백업으로 복구하거나 고치는 마이그레이션을 새로 만든다.
- data VM 의 compose 는 배포 때 바꾸지 않는다. 바꿀 때는 data VM 에서 직접 `docker compose up -d` (DB 재시작이 따르므로 신중하게).

## 백업

| 항목 | 내용 |
|---|---|
| DB | PostgreSQL 전체 (`pg_dump -Fc`) + sha256 (파일 이름만 적는다) |
| 파일 | Garage 버킷 **`aionit`(교재 · 그림 · 첨부 · 영상 원본) · `aionit-media`(영상 변환 결과)** — rclone 으로 바뀐 것만 |
| 설정 | data VM: `.env` · compose · `garage.toml` · Garage 키 파일 · 백업 키 · crontab · **DB 역할(`pg_dumpall --globals-only`)** ➔ 암호화 묶음. **app VM**: `.env` · compose · Caddyfile · `.previous_tag` · Caddy 데이터(인증서) ➔ data VM 이 강제 명령 키로 받아 감 (이미 암호화된 채) |
| 언제 | 매일 03:30 KST (data VM cron, DB · 파일 · 설정), 배포 직전 (DB 만, `pre-deploy-<태그>`) |
| 어디 | 호스트 `G:\AIONIT-backup\` (공유 폴더, data VM `/mnt/aionit-backup`): `db\` · `files\aionit\` · `files\aionit-media\` · `files\changed\<날짜>\<버킷>\` · `config\data-<날짜>.cms` · `config\app-<날짜>.cms`. DB 는 VM 안 `/srv/data/backup/db/` 에도 7일 |
| 보관 | DB 매일 35일 · **매주(일요일) 5주 · 매월(1일) 6개월** · 배포 전 90일. 바뀐 · 지운 파일 35일. 설정 35일 |
| 기록 | data VM `~/aionit/backup.log`. 매일 백업이 끝나면 감시에 결과를 알린다 (`~/aionit/monitor.env`) |

- 공유 폴더는 systemd mount 단위 `mnt-aionit\x2dbackup.mount` 로 붙인다. 공유 폴더가 없어도 VM 부팅은 막히지 않는다. 매일 백업은 실패로 끝나고(감시에 알림), 배포 전 백업은 배포를 막지 않는다.
- 파일 백업은 **읽기 전용 키**(`aionit-backup`, data VM `~/aionit/garage-backup.env`, 600)로 한다. 두 버킷 모두 읽기만 (`garage bucket allow --read aionit-media --key aionit-backup`, 2026-11-05). 이미지 `rclone/rclone:1.75.2`.
- **설정 암호화**: `openssl cms`(AES-256) + 백업 공개 인증서 `~/aionit/backup-recipient.pem`(RSA 4096, 2036-11 까지, SHA-256 지문 `2D:A6:68:43:…:CB:22`). **개인키는 VM · G: 에 두지 않는다** (운영자 보관). 풀기: `openssl cms -decrypt -binary -inform DER -inkey <개인키> -in data-<날짜>.cms | tar xzf - -C <폴더>`.
- 배포 스크립트가 배포 때마다 `infra/data-vm/backup.sh` 를 data VM 에 덮어쓴다. 서버의 백업 스크립트를 바꾸려면 저장소 파일을 고친다.

### app VM 설정 받기 (2026-11-05 운영자 허락)

- data VM `~/.ssh/aionit_config_pull` (ed25519) 의 공개키를 app VM `~/.ssh/authorized_keys` 에 **강제 명령**으로 등록: `command="/home/user1/aionit/config-backup.sh",from="172.30.0.20",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding`. 그 키로는 `config-backup.sh` 만 돈다 (다른 명령을 보내도 같은 결과, 포트 포워딩 "administratively prohibited" 확인). 예전 파일 `authorized_keys.bak-m10`
- app VM `config-backup.sh`(700)가 묶음을 `backup-recipient.pem` 으로 암호화해 내보내므로 data VM 은 평문을 보지 않는다
- 끄려면: app VM `authorized_keys` 의 `aionit-data config pull` 줄을 지운다 (백업 스크립트는 받기 실패 경고만 남긴다)

### 아직 없는 것

| 무엇 | 왜 |
|---|---|
| NAS(F:) 두 번째 사본 | 운영자 결정 대기 |

## 복구

**복구 훈련 (2026-11-05, M10)**: 빈 VM 에서 백업만으로 data VM 을 되살렸다. 기록은 `docs/개발기록/M10.md`. **매달 한 번 반복한다** (아래 1 ~ 5, 끝나면 훈련 VM 을 지운다).

1. 빈 VM: 호스트에서 Academy-data 의 설치 직후 스냅샷으로 연결된 복제를 만든다 (훈련 때는 내부망을 떼고 SSH 포트를 바꾼다. 실제 복구는 Academy-data 와 같게: 내부망 academy-int · 172.30.0.20)
   ```
   VBoxManage clonevm Academy-data --snapshot base0_clean --options link --name Academy-restore --groups /Academy --register
   VBoxManage discardstate Academy-restore
   VBoxManage modifyvm Academy-restore --memory 3072 --nic2 none --natpf1 delete ssh --natpf1 "ssh,tcp,127.0.0.1,22064,,22"
   VBoxManage sharedfolder add Academy-restore --name aionit-backup --hostpath "G:\AIONIT-backup" --readonly
   VBoxManage startvm Academy-restore
   ```
2. 프로그램: `sudo apt-get install -y docker.io docker-compose-v2 virtualbox-guest-utils`, `sudo usermod -aG docker user1`, 공유 폴더 붙이기 `sudo mount -t vboxsf -o ro,uid=1000,gid=1000 aionit-backup /mnt/aionit-backup`
3. 설정: 운영자 PC 에서 `config\data-<가장 최근>.cms` 를 개인키로 풀어 VM `~/aionit/` 에 두고, `sudo install -m 600 garage.toml /srv/data/garage/garage.toml`, `/srv/data/postgres` · `/srv/data/garage/{meta,data}` 만들기 (훈련 때는 compose 의 `172.30.0.20:` 을 `127.0.0.1:` 로)
4. `~/aionit/restore.sh` (`infra/data-vm/restore.sh`): 백업 sha256 확인 ➔ DB · Garage 띄우기 ➔ DB 역할 ➔ `pg_restore` ➔ Garage 배치 · 버킷 · **예전 키 그대로**(app VM `.env` 를 바꾸지 않아도 된다) ➔ 파일 복사 · 대조 ➔ 개수
5. 확인: 원본(또는 백업 시점)과 테이블별 행 수, 트리거 수, 버킷별 개수, 영상 웹 주소 200
6. 실제 복구라면: `crontab.txt` 로 매일 백업 다시 걸기, 공유 폴더 mount 단위, app VM 에서 `/api/health`

- app VM 은 상태가 없다 (DB · 파일은 data VM). 새 app VM 은 Docker 설치 ➔ `config\app-<날짜>.cms` 를 풀어 `~/aionit/` 에 `.env` · compose · Caddyfile, Caddy 인증서는 `docker volume create aionit-app_caddy-data` 뒤 `caddy-data.tgz` 를 풀어 넣기 ➔ `deploy.sh --force` 로 되살린다.
- 개발 VM(이미지 보관소 · 빌드 캐시)은 백업하지 않는다. 다시 만들 수 있다 (`infra/dev-vm/README.md`).

## 상태 확인

```bash
# app VM
docker ps --format "{{.Names}} {{.Status}}"
curl -sk https://localhost/api/health
docker compose -f ~/aionit/compose.yaml logs -f web
```
