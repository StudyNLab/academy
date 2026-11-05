#!/usr/bin/env bash
# AIONIT DB · 파일 · 설정 백업 (Academy-data VM 에서 실행). 매일 cron 으로, 배포 전에는 배포 스크립트가 부른다.
#   ~/aionit/backup.sh              ➔ daily-YYYYMMDD-HHMM (DB · 파일 · 설정 모두)
#   ~/aionit/backup.sh pre-deploy-x ➔ 이름을 붙여서 (DB 만)
# 결과 (공유 폴더 /mnt/aionit-backup = 호스트 G:\AIONIT-backup):
#   db/       DB (pg_dump -Fc) + sha256. VM 안 /srv/data/backup/db/ 에도 7일
#   files/    파일 저장소 Garage 버킷 사본 (aionit · aionit-media, 바뀐 것만)
#   config/   설정 묶음 (data VM · app VM, 암호화)
# 보관 (docs/기술설계.md 9장): 매일 35일, 매주(일요일) 5주, 매월(1일) 6개월, 배포 전 90일. 설정 35일
# 매일 백업은 끝나면 감시(Uptime Kuma)에 결과를 알린다 (~/aionit/monitor.env 의 BACKUP_PUSH_URL, 없으면 건너뜀)
set -euo pipefail

LABEL="${1:-daily-$(date +%Y%m%d-%H%M)}"
LOCAL_DIR=/srv/data/backup/db
SHARE=/mnt/aionit-backup
SHARE_DIR=$SHARE/db
KEEP_LOCAL_DAYS=7
KEEP_SHARE_DAILY_DAYS=35
KEEP_WEEKLY_DAYS=35
KEEP_MONTHLY_DAYS=186
KEEP_PREDEPLOY_DAYS=90
WARNINGS=0

cd "$(dirname "$0")"
mkdir -p "$LOCAL_DIR"

warn() {
  echo "경고: $*" >&2
  WARNINGS=$((WARNINGS + 1))
}

# 감시(Uptime Kuma 푸시 감시)에 결과를 알린다. 매일 백업만. 알리지 않으면 감시가 25시간 뒤 "실패" 로 본다
push_monitor() {
  [[ "$LABEL" == daily-* ]] || return 0
  [ -f monitor.env ] || return 0
  # shellcheck disable=SC1091
  . ./monitor.env
  [ -n "${BACKUP_PUSH_URL:-}" ] || return 0
  local status=up msg=OK
  if [ "$WARNINGS" -gt 0 ]; then
    status=down
    msg="warnings-$WARNINGS"
  fi
  curl -fsS -m 10 "${BACKUP_PUSH_URL}?status=${status}&msg=${msg}" >/dev/null || echo "경고: 감시에 알리지 못했습니다" >&2
}

# pg_dump 사용자 지정 형식(-Fc): 압축 + pg_restore 로 골라서 복구 가능. 실패하면 반쪽 파일을 남기지 않는다.
docker compose exec -T postgres pg_dump -U aionit -d aionit -Fc > "$LOCAL_DIR/${LABEL}.dump.part"
mv "$LOCAL_DIR/${LABEL}.dump.part" "$LOCAL_DIR/${LABEL}.dump"
# sha256 파일에는 파일 이름만 적는다 (경로를 적으면 G: 사본을 검사할 때 VM 안 원본을 검사하게 된다 — M10 복구 훈련에서 찾음)
(cd "$LOCAL_DIR" && sha256sum "${LABEL}.dump" > "${LABEL}.dump.sha256")
echo "백업: $LOCAL_DIR/${LABEL}.dump ($(du -h "$LOCAL_DIR/${LABEL}.dump" | cut -f1))"
find "$LOCAL_DIR" -name '*.dump*' -mtime +"$KEEP_LOCAL_DAYS" -delete

# 공유 폴더가 없으면 VM 안에만 남긴다. 배포 전 백업은 배포를 막지 않고, 매일 백업은 실패로 알린다
if ! mountpoint -q "$SHARE"; then
  warn "공유 폴더 $SHARE 이 없어 VM 안에만 남겼습니다"
  push_monitor
  [[ "$LABEL" == daily-* ]] && exit 1
  exit 0
fi

# 호스트 G: 로 복사 + 검증
mkdir -p "$SHARE_DIR"
cp "$LOCAL_DIR/${LABEL}.dump" "$LOCAL_DIR/${LABEL}.dump.sha256" "$SHARE_DIR/"
(cd "$SHARE_DIR" && sha256sum -c --quiet "${LABEL}.dump.sha256")
echo "복사: $SHARE_DIR/${LABEL}.dump (검증 통과)"

# 매주 · 매월 사본 (매일 백업에서만). 이름만 바꾼 복사라 sha256 파일도 새 이름으로 다시 만든다
if [[ "$LABEL" == daily-* ]]; then
  keep_copy() {
    local name="$1-$(date +%Y%m%d)"
    cp "$SHARE_DIR/${LABEL}.dump" "$SHARE_DIR/${name}.dump"
    (cd "$SHARE_DIR" && sha256sum "${name}.dump" > "${name}.dump.sha256")
    echo "보관 사본: $SHARE_DIR/${name}.dump"
  }
  [ "$(date +%u)" = 7 ] && keep_copy weekly
  [ "$(date +%d)" = 01 ] && keep_copy monthly
fi
find "$SHARE_DIR" -name 'daily-*' -mtime +"$KEEP_SHARE_DAILY_DAYS" -delete
find "$SHARE_DIR" -name 'weekly-*' -mtime +"$KEEP_WEEKLY_DAYS" -delete
find "$SHARE_DIR" -name 'monthly-*' -mtime +"$KEEP_MONTHLY_DAYS" -delete
find "$SHARE_DIR" -name 'pre-*' -mtime +"$KEEP_PREDEPLOY_DAYS" -delete

# 배포 전 백업은 DB 만 (빨리 끝나야 한다)
[[ "$LABEL" == daily-* ]] || exit 0

# 파일 저장소(Garage) 백업: 버킷마다 바뀐 것만 (rclone sync, 읽기 전용 키 garage-backup.env).
#   aionit       교재 · 그림 · 첨부 · 영상 원본
#   aionit-media 영상 변환 결과 (HLS 조각 · 자막). 원본에서 다시 만들 수 있지만 복구 시간을 줄이려고 함께
# 바뀌거나 지워진 파일은 지우지 않고 files/changed/<날짜>/<버킷>/ 로 옮겨 둔다. S3 와 같은 모양이라 S3 · R2 로도 그대로 올릴 수 있다.
RCLONE_IMAGE=rclone/rclone:1.75.2
if [ -f garage-backup.env ]; then
  STAMP=$(date +%Y%m%d-%H%M)
  for bucket in aionit aionit-media; do
    mkdir -p "$SHARE/files/changed"
    if docker run --rm --network host --env-file garage-backup.env \
      -v "$SHARE/files":/backup "$RCLONE_IMAGE" \
      sync "garage:$bucket" "/backup/$bucket" --backup-dir "/backup/changed/$STAMP/$bucket" \
      --checksum --stats-one-line --stats 0 -q; then
      echo "파일 백업: $SHARE/files/$bucket ($(du -sh "$SHARE/files/$bucket" 2>/dev/null | cut -f1))"
    else
      warn "파일 백업 실패: $bucket"
    fi
  done
  find "$SHARE/files/changed" -mindepth 1 -maxdepth 1 -mtime +"$KEEP_SHARE_DAILY_DAYS" -exec rm -rf {} +
else
  warn "garage-backup.env 가 없어 파일 백업을 건너뜁니다"
fi

# 설정 백업 (암호화, 공개 인증서 backup-recipient.pem. 개인키는 VM 에 두지 않는다 — infra/README.md 백업)
#   data VM: .env · compose.yaml · garage.toml · Garage 키 파일 · 백업 키 · 감시 설정 · DB 역할(globals.sql)
#   app VM : SSH 강제 명령(config-backup.sh)으로 받아 온 묶음 (이미 암호화돼 있다)
CONFIG_DIR=$SHARE/config
mkdir -p "$CONFIG_DIR"
if [ -f backup-recipient.pem ]; then
  STAGE=$(mktemp -d)
  chmod 700 "$STAGE"
  cp -p .env compose.yaml backup.sh "$STAGE/"
  for f in garage-key.txt garage-backup.env garage-backup-key.txt monitor.env; do
    [ -f "$f" ] && cp -p "$f" "$STAGE/"
  done
  sudo -n cat /srv/data/garage/garage.toml > "$STAGE/garage.toml" 2>/dev/null || cp /srv/data/garage/garage.toml "$STAGE/"
  crontab -l > "$STAGE/crontab.txt" 2>/dev/null || true
  # DB 역할(aionit_app 등, 비밀번호 해시 포함)은 pg_dump 에 들어 있지 않다. 복구 때 restore.sh 가 먼저 넣는다
  docker compose exec -T postgres pg_dumpall -U aionit --globals-only > "$STAGE/globals.sql"
  chmod 600 "$STAGE"/* "$STAGE"/.env
  tar czf - -C "$STAGE" . | openssl cms -encrypt -binary -aes256 -outform DER backup-recipient.pem \
    > "$CONFIG_DIR/data-${LABEL#daily-}.cms"
  rm -rf "$STAGE"
  echo "설정 백업: $CONFIG_DIR/data-${LABEL#daily-}.cms"
else
  warn "backup-recipient.pem 이 없어 data VM 설정 백업을 건너뜁니다"
fi
if [ -f "$HOME/.ssh/aionit_config_pull" ]; then
  if ssh -T -i "$HOME/.ssh/aionit_config_pull" -o BatchMode=yes -o ConnectTimeout=10 \
    -o UserKnownHostsFile="$HOME/.ssh/known_hosts" user1@172.30.0.10 \
    > "$CONFIG_DIR/app-${LABEL#daily-}.cms.part"; then
    mv "$CONFIG_DIR/app-${LABEL#daily-}.cms.part" "$CONFIG_DIR/app-${LABEL#daily-}.cms"
    echo "설정 백업: $CONFIG_DIR/app-${LABEL#daily-}.cms"
  else
    rm -f "$CONFIG_DIR/app-${LABEL#daily-}.cms.part"
    warn "app VM 설정 백업 실패"
  fi
else
  # 아직 켜지 않음 (app VM 에 받는 키를 등록해야 한다, infra/README.md 백업)
  echo "알림: ~/.ssh/aionit_config_pull 이 없어 app VM 설정 백업을 건너뜁니다"
fi
find "$CONFIG_DIR" -name '*.cms' -mtime +"$KEEP_SHARE_DAILY_DAYS" -delete

push_monitor
[ "$WARNINGS" -eq 0 ]
