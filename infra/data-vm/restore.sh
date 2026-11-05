#!/usr/bin/env bash
# AIONIT 데이터 VM 복구 (M10 복구 훈련으로 확인). 빈 VM 에서 백업만으로 DB · 파일 저장소를 되살린다.
# 앞 준비 (infra/README.md "복구"): Docker · virtualbox-guest-utils 설치, 공유 폴더를 /mnt/aionit-backup 에 붙임,
#   설정 묶음(config/data-*.cms)을 백업 개인키로 풀어 ~/aionit 에 둠 (.env · compose.yaml · garage.toml · 키 파일).
#
#   ~/aionit/restore.sh             ➔ 가장 최근 daily DB 백업
#   ~/aionit/restore.sh <dump 경로> ➔ 그 백업 (예: pre-deploy-xxxx)
#
# 하는 일: compose 띄우기 ➔ (있으면) DB 역할 ➔ pg_restore ➔ Garage 배치 · 버킷 · 키(예전 키 그대로) ➔ 파일 복사 ➔ 개수 확인
# 이미 데이터가 있는 VM 에서는 멈춘다 (덮어쓰지 않는다).
set -euo pipefail

SHARE=/mnt/aionit-backup
cd "$(dirname "$0")"
DUMP="${1:-$(ls -t "$SHARE"/db/daily-*.dump | head -1)}"
RCLONE_IMAGE=rclone/rclone:1.75.2
step() { echo "== $(date +%H:%M:%S) $*"; }

for f in .env compose.yaml garage-key.txt garage-backup-key.txt /srv/data/garage/garage.toml; do
  sudo -n test -f "$f" || { echo "$f 가 없습니다 (설정 묶음을 먼저 푸세요)" >&2; exit 1; }
done
mountpoint -q "$SHARE" || { echo "공유 폴더 $SHARE 이 없습니다" >&2; exit 1; }

step "백업 확인: $DUMP"
# sha256 파일의 경로 칸은 보지 않고 값만 비교한다 (2026-11 이전 파일은 VM 안 절대 경로가 적혀 있다)
[ "$(awk '{print $1}' "$DUMP.sha256")" = "$(sha256sum "$DUMP" | awk '{print $1}')" ] || { echo "sha256 이 다릅니다" >&2; exit 1; }

step "DB · Garage 띄우기"
docker compose up -d --quiet-pull
until docker compose exec -T postgres pg_isready -U aionit >/dev/null 2>&1; do sleep 1; done
if [ "$(docker compose exec -T postgres psql -U aionit -d aionit -Atc "select count(*) from pg_tables where schemaname = 'public'")" != 0 ]; then
  echo "DB 에 이미 테이블이 있습니다. 빈 VM 에서만 복구합니다" >&2
  exit 1
fi

step "DB 복구"
# 역할(aionit_app 등)은 DB 백업에 들어 있지 않다. 설정 묶음의 globals.sql(pg_dumpall --globals-only)이 있으면 먼저 넣는다
if [ -f globals.sql ]; then
  grep -v -E '^(CREATE|ALTER) ROLE aionit( |;)' globals.sql |
    docker compose exec -T postgres psql -U aionit -d postgres -q -v ON_ERROR_STOP=0 >/dev/null
fi
docker compose exec -T postgres pg_restore -U aionit -d aionit --exit-on-error < "$DUMP"

step "Garage 배치 · 버킷 · 키"
garage() { docker compose exec -T garage /garage "$@" 2>/dev/null; }
until garage status >/dev/null; do sleep 1; done
NODE=$(garage status | awk '/NO ROLE ASSIGNED/ {print $1; exit}')
if [ -n "$NODE" ]; then
  garage layout assign -z dc1 -c 50G "$NODE" >/dev/null
  garage layout apply --version 1 >/dev/null
fi
import_key() { # 키 파일(garage key info 출력) ➔ 같은 ID · 비밀값으로 다시 만든다 (app VM .env 를 그대로 쓰려고)
  local id secret name
  id=$(awk '/^Key ID:/ {print $3}' "$1")
  secret=$(awk '/^Secret key:/ {print $3}' "$1")
  name=$(awk '/^Key name:/ {print $3}' "$1")
  garage key info "$id" >/dev/null || garage key import --yes -n "$name" "$id" "$secret" >/dev/null
  echo "$id"
}
APP_KEY=$(import_key garage-key.txt)
BACKUP_KEY=$(import_key garage-backup-key.txt)
for bucket in aionit aionit-media; do
  garage bucket info "$bucket" >/dev/null || garage bucket create "$bucket" >/dev/null
  garage bucket allow --read --write --owner "$bucket" --key "$APP_KEY" >/dev/null
  garage bucket allow --read "$bucket" --key "$BACKUP_KEY" >/dev/null
done
garage bucket website --allow aionit-media >/dev/null

step "파일 복사 (백업 ➔ Garage)"
APP_SECRET=$(awk '/^Secret key:/ {print $3}' garage-key.txt)
for bucket in aionit aionit-media; do
  [ -d "$SHARE/files/$bucket" ] || { echo "백업에 $bucket 이 없습니다 (건너뜀)"; continue; }
  docker run --rm --network host -v "$SHARE/files":/backup:ro \
    -e RCLONE_CONFIG_G_TYPE=s3 -e RCLONE_CONFIG_G_PROVIDER=Other -e RCLONE_CONFIG_G_ENDPOINT=http://127.0.0.1:3900 \
    -e RCLONE_CONFIG_G_REGION=garage -e RCLONE_CONFIG_G_FORCE_PATH_STYLE=true \
    -e RCLONE_CONFIG_G_ACCESS_KEY_ID="$APP_KEY" -e RCLONE_CONFIG_G_SECRET_ACCESS_KEY="$APP_SECRET" \
    "$RCLONE_IMAGE" copy "/backup/$bucket" "g:$bucket" --checksum --stats-one-line --stats 0 -q
  docker run --rm --network host -v "$SHARE/files":/backup:ro \
    -e RCLONE_CONFIG_G_TYPE=s3 -e RCLONE_CONFIG_G_PROVIDER=Other -e RCLONE_CONFIG_G_ENDPOINT=http://127.0.0.1:3900 \
    -e RCLONE_CONFIG_G_REGION=garage -e RCLONE_CONFIG_G_FORCE_PATH_STYLE=true \
    -e RCLONE_CONFIG_G_ACCESS_KEY_ID="$APP_KEY" -e RCLONE_CONFIG_G_SECRET_ACCESS_KEY="$APP_SECRET" \
    "$RCLONE_IMAGE" check "/backup/$bucket" "g:$bucket" --one-way -q
  echo "$bucket: $(garage bucket info "$bucket" | awk '/^Objects:/ {print $2}') 개 (백업과 같음)"
done

step "확인"
docker compose exec -T postgres psql -U aionit -d aionit -Atc \
  "select 'DB 테이블 ' || count(*) from pg_tables where schemaname = 'public'"
echo "끝. 다음: crontab.txt 로 매일 백업을 다시 걸고, app VM 의 DATABASE_URL · S3_ENDPOINT 가 이 VM 을 가리키는지 확인"
