#!/usr/bin/env bash
# 운영 서버(클라우드) 백업을 사무실로 받아 온다. 사무실 테스트 서버 Academy-data VM 에서 cron 으로 매일 04:10
# (운영 서버 백업 03:30 뒤, 호스트의 F: 복사 04:30 앞).
#   받는 곳: /mnt/aionit-backup/cloud/ (= 호스트 G:\AIONIT-backup\cloud\) ➔ 호스트 예약 작업 AIONIT-NAS-copy 가 그대로 F: 로 복사
#   받는 것: 운영 서버 /srv/backup 의 db/ · files/ · config/ (이미 암호화된 설정 묶음 그대로)
# 운영 서버 쪽에는 이 키를 읽기 전용으로만 등록한다 (infra/cloud/README.md '백업 받아 오기'):
#   command="rrsync -ro /srv/backup",restrict ssh-ed25519 AAAA… aionit-office backup pull
# 설정: ~/aionit/cloud-backup.env 의 CLOUD_BACKUP_HOST (운영 서버 주소) · CLOUD_BACKUP_USER (기본 user1)
# 사무실 사본은 지우지 않고 쌓는다 (운영 서버에서 지워져도 남게). 200일 지난 파일만 지운다 (F: 와 같은 기준)
set -euo pipefail

cd "$(dirname "$0")"
KEY=$HOME/.ssh/aionit_cloud_backup
DEST=/mnt/aionit-backup/cloud
KEEP_DAYS=200
LOG=$HOME/aionit/pull-backup.log

exec >> "$LOG" 2>&1
echo "== $(date '+%F %T') 운영 서버 백업 받기"

[ -f cloud-backup.env ] || { echo "cloud-backup.env 가 없습니다"; exit 1; }
# shellcheck disable=SC1091
. ./cloud-backup.env
: "${CLOUD_BACKUP_HOST:?cloud-backup.env 에 CLOUD_BACKUP_HOST}"
mountpoint -q /mnt/aionit-backup || { echo "공유 폴더 /mnt/aionit-backup 이 없어 받지 않습니다"; exit 1; }
mkdir -p "$DEST"

# rrsync 가 /srv/backup 아래만 읽게 막으므로 원격 경로는 그 안의 상대 경로다
rsync -rt --partial --timeout=600 \
  -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o UserKnownHostsFile=$HOME/.ssh/known_hosts" \
  "${CLOUD_BACKUP_USER:-user1}@$CLOUD_BACKUP_HOST:./" "$DEST/"

# 지난번 검증 뒤에 새로 받은 DB 백업만 검증 (sha256 파일에는 파일 이름만 있다)
marker=$DEST/.last-verified bad=0
for f in "$DEST"/db/*.dump.sha256; do
  [ -e "$f" ] || continue
  if [ -e "$marker" ] && [ ! "$f" -nt "$marker" ]; then continue; fi
  (cd "$DEST/db" && sha256sum -c --quiet "$(basename "$f")") || { echo "검증 실패: $f"; bad=1; }
done
if [ "$bad" = 0 ]; then touch "$marker"; fi

find "$DEST" -type f -mtime +"$KEEP_DAYS" -delete
echo "끝: $(du -sh "$DEST" | cut -f1)"
[ "$bad" = 0 ]
