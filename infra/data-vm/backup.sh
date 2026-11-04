#!/usr/bin/env bash
# AIONIT DB · 파일 백업 (Academy-data VM 에서 실행). 매일 cron 으로, 배포 전에는 배포 스크립트가 부른다.
#   ~/aionit/backup.sh              ➔ daily-YYYYMMDD-HHMM
#   ~/aionit/backup.sh pre-deploy-x ➔ 이름을 붙여서
# 결과: /srv/data/backup/db/*.dump (VM 안) + /mnt/aionit-backup/db/ (호스트 G:\AIONIT-backup, 공유 폴더)
#       + /mnt/aionit-backup/files/aionit (파일 저장소 Garage 버킷 사본, 바뀐 것만)
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

# 파일 저장소(Garage, 교재 · 그림 · 첨부) 백업: 공유 폴더로 바뀐 것만 (rclone sync, 읽기 전용 키 garage-backup.env).
# 바뀌거나 지워진 파일은 지우지 않고 files/changed/<날짜>/ 로 옮겨 둔다. S3 와 같은 모양이라 S3 · R2 로도 그대로 올릴 수 있다.
RCLONE_IMAGE=rclone/rclone:1.75.2
if mountpoint -q /mnt/aionit-backup && [ -f garage-backup.env ]; then
  mkdir -p /mnt/aionit-backup/files/changed
  docker run --rm --network host --env-file garage-backup.env \
    -v /mnt/aionit-backup/files:/backup "$RCLONE_IMAGE" \
    sync garage:aionit /backup/aionit --backup-dir "/backup/changed/$(date +%Y%m%d-%H%M)" \
    --checksum --stats-one-line --stats 0 -q
  echo "파일 백업: /mnt/aionit-backup/files/aionit ($(du -sh /mnt/aionit-backup/files/aionit 2>/dev/null | cut -f1))"
  find /mnt/aionit-backup/files/changed -mindepth 1 -maxdepth 1 -mtime +"$KEEP_SHARE_DAILY_DAYS" -exec rm -rf {} +
else
  echo "경고: 공유 폴더 또는 garage-backup.env 가 없어 파일 백업을 건너뜁니다" >&2
fi
