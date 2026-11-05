# 개발 VM (Academy-dev)

노트북에서 개발할 때 쓰는 PostgreSQL · Garage(S3) · Mailpit 을 띄우고, 배포 이미지를 빌드 · 보관하는 VM. 테스트 운영 서버의 내부망(academy-int)에는 붙지 않는다. 앱 VM 과는 브리지 망(사내망)으로 이미지 보관소만 이어져 있다.

| 항목 | 값 |
|---|---|
| 위치 | 호스트 TrainingGround (10.100.4.52), `D:\VirtualBox VMs\Academy\Academy-dev` |
| 사양 | Ubuntu 24.04.2, 4 vCPU, 6GB, 60GB |
| 접속 | `ssh -o ProxyJump=user1@10.100.4.52 -p 22063 user1@127.0.0.1` (키 로그인만, VPN 필요) |
| 랜카드 | NIC1 NAT (인터넷 · SSH 포트 포워딩, 기본 경로 · DNS), NIC2 브리지 `enp0s8` 10.100.3.168/8 (게이트웨이 · DNS 없음, `/etc/netplan/60-bridge.yaml`) |
| 서비스 폴더 | VM 의 `~/aionit-dev/` (`compose.yaml`, `.env`), 데이터 `/srv/dev/` |
| 비밀값 | VM 의 `~/aionit-dev/.env` (DB 비밀번호), `~/aionit-dev/garage-key.txt` (S3 키), `/srv/dev/garage/garage.toml` — 모두 권한 600, Git 에 올리지 않는다 |

## 서비스

| 서비스 | 이미지 | VM 안 주소 | 노트북 터널 주소 |
|---|---|---|---|
| PostgreSQL | `postgres:18.6` | 127.0.0.1:5432 | `localhost:15432` (DB `aionit`, 사용자 `aionit`) |
| Garage S3 API | `dxflrs/garage:v2.5.0` | 127.0.0.1:3900 | `localhost:13900` (버킷 `aionit-dev` · 영상 `aionit-dev-media`, 지역 `garage`) |
| Garage 관리 API | 〃 | 127.0.0.1:3903 | (필요할 때만) |
| Mailpit SMTP | `axllent/mailpit:v1.33.0` | 127.0.0.1:1025 | `localhost:11025` |
| Mailpit 웹 화면 | 〃 | 127.0.0.1:8025 | http://localhost:18025 |

위 포트는 모두 VM 의 127.0.0.1 에만 열려 있다. 노트북에서는 SSH 터널로만 들어간다. 브리지 주소에 열린 것은 아래 이미지 보관소 하나다.

## 이미지 보관소 (aionit-registry)

배포 스크립트(`infra/scripts/deploy.sh`)가 빌드한 이미지를 올리고, 앱 VM 이 받아 간다.

| 항목 | 값 |
|---|---|
| 컨테이너 | `aionit-registry` (`registry:2.8.3`, `--restart=always`), 데이터는 docker 볼륨 `aionit-registry` |
| 주소 | `https://127.0.0.1:5055` (개발 VM 이 올릴 때), `https://10.100.3.168:5055` (앱 VM 이 받을 때) |
| 인증서 | 자체 인증서 `~/aionit-registry/certs/registry.crt` · `registry.key`(600), IP 10.100.3.168 · 127.0.0.1, 2036-11 까지. 앱 VM 은 `/etc/docker/certs.d/10.100.3.168:5055/ca.crt` 에 같은 crt 를 두어 이것만 믿는다 (docker 설정 · 재시작 필요 없음) |
| 막기 | systemd `aionit-registry-allow` (이 폴더의 `aionit-registry-allow.service`): docker 체인 `DOCKER-USER` 에 "enp0s8 로 들어온 5055 는 앱 VM 10.100.3.169 가 아니면 버림". docker 가 연 포트는 ufw 를 거치지 않아서 이렇게 막는다 |

- 배포 스크립트는 보관소가 두 주소에 열려 있지 않으면 같은 볼륨 · 인증서로 다시 만든다.
- 확인: 앱 VM 에서 `curl --cacert /etc/docker/certs.d/10.100.3.168:5055/ca.crt https://10.100.3.168:5055/v2/` ➔ `{}`. 다른 곳(노트북 등)에서는 시간 초과.
- 앱 VM 주소가 바뀌면 `aionit-registry-allow.service` 의 `APP_BR` 을, 개발 VM 주소가 바뀌면 `deploy.sh` 의 `DEV_BR` · 인증서(IP 가 들어 있음) · 앱 VM `certs.d` 폴더 이름을 함께 바꾼다.
- 인증서를 새로 만들면(`openssl req -x509 … -addext subjectAltName=IP:10.100.3.168,IP:127.0.0.1`) 앱 VM 의 `ca.crt` 도 바꾸고 보관소를 다시 띄운다 (`docker restart aionit-registry`).

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
