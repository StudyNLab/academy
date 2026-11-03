# 개발 VM (Academy-dev)

노트북에서 개발할 때 쓰는 PostgreSQL · Garage(S3) · Mailpit 을 띄우는 VM. 테스트 운영 서버(Academy-app · Academy-data)와는 네트워크가 분리되어 있다.

| 항목 | 값 |
|---|---|
| 위치 | 호스트 TrainingGround (10.100.4.52), `D:\VirtualBox VMs\Academy\Academy-dev` |
| 사양 | Ubuntu 24.04.2, 4 vCPU, 6GB, 60GB |
| 접속 | `ssh -o ProxyJump=user1@10.100.4.52 -p 22063 user1@127.0.0.1` (키 로그인만, VPN 필요) |
| 서비스 폴더 | VM 의 `~/aionit-dev/` (`compose.yaml`, `.env`), 데이터 `/srv/dev/` |
| 비밀값 | VM 의 `~/aionit-dev/.env` (DB 비밀번호), `~/aionit-dev/garage-key.txt` (S3 키), `/srv/dev/garage/garage.toml` — 모두 권한 600, Git 에 올리지 않는다 |

## 서비스

| 서비스 | 이미지 | VM 안 주소 | 노트북 터널 주소 |
|---|---|---|---|
| PostgreSQL | `postgres:18.6` | 127.0.0.1:5432 | `localhost:15432` (DB `aionit`, 사용자 `aionit`) |
| Garage S3 API | `dxflrs/garage:v2.5.0` | 127.0.0.1:3900 | `localhost:13900` (버킷 `aionit-dev`, 지역 `garage`) |
| Garage 관리 API | 〃 | 127.0.0.1:3903 | (필요할 때만) |
| Mailpit SMTP | `axllent/mailpit:v1.33.0` | 127.0.0.1:1025 | `localhost:11025` |
| Mailpit 웹 화면 | 〃 | 127.0.0.1:8025 | http://localhost:18025 |

모든 포트는 VM 의 127.0.0.1 에만 열려 있다. 노트북에서는 SSH 터널로만 들어간다.

## 노트북에서 터널 열기

```bash
ssh -N -o ExitOnForwardFailure=yes -o ProxyJump=user1@10.100.4.52 -p 22063 -L 15432:127.0.0.1:5432 -L 13900:127.0.0.1:3900 -L 11025:127.0.0.1:1025 -L 18025:127.0.0.1:8025 user1@127.0.0.1
```

(M0 에서 `pnpm dev:tunnel` 같은 명령으로 묶는다.)

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
