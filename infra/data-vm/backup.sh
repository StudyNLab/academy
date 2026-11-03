#!/usr/bin/env bash
# AIONIT DB 백업 (Academy-data VM 에서 실행). 매일 cron 으로, 배포 전에는 배포 스크립트가 부른다.
#   ~/aionit/backup.sh              ➔ daily-YYYYMMDD-HHMM
#   ~/aionit/backup.sh pre-deploy-x ➔ 이름을 붙여서
# 결과: /srv/data/backup/db/*.dump (VM 안) + /mnt/aionit-backup/db/ (호스트 G:\AIONIT-backup, 공유 폴더)
set -euo pipefail

LABEL="${1:-daily-$(date +%Y%m%d-%H%M)}"
LOCAL_DIR=/srv/data/backup/db
SHARE_DIR=/mnt/aionit-backup/db
KEEP_LOCAL_DAYS=7
KEEP_SHARE_DAILY_DAYS=35

cd "$(dirname "$0")"
mkdir -p "$LOCAL_DIR"

# pg_dump 사용자 지정 형식(-Fc): 압축 + pg_restore 로 골라서 복구 가능. 실패하면 반쪽 파일을 남기지 않는다.
docker compose exec -T postgres pg_dump -U aionit -d aionit -Fc > "$LOCAL_DIR/${LABEL}.dump.part"
mv "$LOCAL_DIR/${LABEL}.dump.part" "$LOCAL_DIR/${LABEL}.dump"
sha256sum "$LOCAL_DIR/${LABEL}.dump" > "$LOCAL_DIR/${LABEL}.dump.sha256"
echo "백업: $LOCAL_DIR/${LABEL}.dump ($(du -h "$LOCAL_DIR/${LABEL}.dump" | cut -f1))"

# 호스트 G: 로 복사 (공유 폴더가 붙어 있을 때)
if mountpoint -q /mnt/aionit-backup; then
  mkdir -p "$SHARE_DIR"
  cp "$LOCAL_DIR/${LABEL}.dump" "$LOCAL_DIR/${LABEL}.dump.sha256" "$SHARE_DIR/"
  (cd "$SHARE_DIR" && sha256sum -c --quiet "${LABEL}.dump.sha256")
  echo "복사: $SHARE_DIR/${LABEL}.dump (검증 통과)"
  find "$SHARE_DIR" -name 'daily-*' -mtime +"$KEEP_SHARE_DAILY_DAYS" -delete
else
  echo "경고: 공유 폴더 /mnt/aionit-backup 이 없어 VM 안에만 남겼습니다" >&2
fi

find "$LOCAL_DIR" -name '*.dump*' -mtime +"$KEEP_LOCAL_DAYS" -delete
