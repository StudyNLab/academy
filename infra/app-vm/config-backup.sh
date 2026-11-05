#!/usr/bin/env bash
# AIONIT 앱 VM 설정 백업 (M10). data VM 의 backup.sh 가 SSH 로 부르면 암호화한 설정 묶음을 표준 출력으로 내보낸다.
# authorized_keys 의 강제 명령(command=)으로만 불린다: 그 키로는 이 스크립트 말고 아무것도 할 수 없다 (infra/README.md 백업).
# 묶음: ~/aionit 의 .env · compose.yaml · Caddyfile · .previous_tag + Caddy 데이터(내부 인증서 · 도메인 인증서)
# 암호화: 백업 공개 인증서(~/aionit/backup-recipient.pem)로 openssl cms (AES-256). 개인키는 VM 에 두지 않는다
set -euo pipefail

cd "$HOME/aionit"
RECIPIENT=backup-recipient.pem
[ -f "$RECIPIENT" ] || { echo "백업 공개 인증서 $RECIPIENT 가 없습니다" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
chmod 700 "$STAGE"

cp -p .env compose.yaml Caddyfile "$STAGE/"
[ -f .previous_tag ] && cp -p .previous_tag "$STAGE/"
# Caddy 데이터 볼륨 (인증서 · 내부 CA). 컨테이너를 멈추지 않고, 돌고 있는 Caddy 이미지(새로 받지 않음)로 읽기 전용으로 묶는다
IMAGE=$(docker inspect -f '{{.Config.Image}}' aionit-app-caddy-1)
docker run --rm --entrypoint sh -v aionit-app_caddy-data:/data:ro -v "$STAGE":/out "$IMAGE" \
  -c "tar czf /out/caddy-data.tgz -C /data . && chown $(id -u):$(id -g) /out/caddy-data.tgz" >/dev/null

tar czf - -C "$STAGE" . | openssl cms -encrypt -binary -aes256 -outform DER "$RECIPIENT"
