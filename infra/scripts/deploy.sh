#!/usr/bin/env bash
# AIONIT 테스트 서버 배포 (노트북 Git Bash 에서 실행)
#   infra/scripts/deploy.sh             커밋된 현재 HEAD 를 배포
#   infra/scripts/deploy.sh --rollback  직전 버전으로 되돌리기
#   infra/scripts/deploy.sh --worktree  (개발 중 시험용) 커밋하지 않은 작업 트리를 배포. 태그가 wt- 로 시작한다
# 흐름: 개발 VM 에서 이미지 빌드 ➔ 앱 VM 으로 옮김 ➔ DB 백업 ➔ 마이그레이션 ➔ 전환 ➔ 상태 확인 (실패 시 자동 되돌리기)
set -euo pipefail

JUMP=user1@10.100.4.52
DEV=22063 APP=22061 DATA=22062
vm() { local port=$1; shift; ssh -o BatchMode=yes -o ProxyJump="$JUMP" -p "$port" user1@127.0.0.1 "$@"; }

cd "$(git rev-parse --show-toplevel)"

current_tag() { vm $APP "grep ^APP_TAG= ~/aionit/.env | cut -d= -f2"; }

switch_to() {
  local tag=$1
  vm $APP "cd ~/aionit && sed -i 's/^APP_TAG=.*/APP_TAG=$tag/' .env && docker compose up -d --remove-orphans --quiet-pull"
}

healthy() {
  vm $APP 'for i in $(seq 1 45); do
    s=$(docker inspect -f "{{.State.Health.Status}}" aionit-app-web-1 2>/dev/null || true)
    [ "$s" = healthy ] && curl -fsk https://localhost/api/health >/dev/null && exit 0
    sleep 2
  done; exit 1'
}

if [ "${1:-}" = "--rollback" ]; then
  prev=$(vm $APP "cat ~/aionit/.previous_tag 2>/dev/null || true")
  [ -n "$prev" ] || { echo "되돌릴 이전 버전이 없습니다" >&2; exit 1; }
  now=$(current_tag)
  echo "== 되돌리기: $now ➔ $prev"
  vm $APP "echo $now > ~/aionit/.previous_tag"
  switch_to "$prev"
  healthy && echo "완료: $prev 로 되돌렸습니다" || { echo "되돌린 버전도 상태 확인 실패" >&2; exit 1; }
  exit 0
fi

if [ "${1:-}" = "--worktree" ]; then
  TAG="wt-$(git rev-parse --short HEAD)-$(date +%m%d%H%M)"
  pack() { git ls-files -co --exclude-standard -z | tar --null -T - -cf -; }
else
  [ -z "$(git status --porcelain)" ] || { echo "커밋하지 않은 변경이 있습니다. 커밋한 코드만 배포합니다 (시험용: --worktree)." >&2; exit 1; }
  TAG=$(git rev-parse --short HEAD)
  pack() { git archive --format=tar HEAD; }
fi
PREV=$(current_tag)
echo "== 배포 $PREV ➔ $TAG"

echo "== 1/6 빌드 맥락 보내기"
pack | vm $DEV "rm -rf ~/build/aionit && mkdir -p ~/build/aionit && tar -xf - -C ~/build/aionit"

echo "== 2/6 이미지 빌드 (개발 VM)"
vm $DEV "cd ~/build/aionit && docker build -q -f infra/docker/Dockerfile --target web -t aionit-web:$TAG . >/dev/null \
  && docker build -q -f infra/docker/Dockerfile --target worker -t aionit-worker:$TAG . >/dev/null"

echo "== 3/6 이미지 옮기기 (개발 VM ➔ 앱 VM)"
vm $DEV "docker save aionit-web:$TAG aionit-worker:$TAG | gzip -1" | vm $APP "gunzip | docker load -q"

echo "== 4/6 서버 설정 반영"
vm $APP "cat > ~/aionit/compose.yaml" < infra/app-vm/compose.yaml
# Caddyfile 이 바뀌었으면 Caddy 를 다시 띄운다 (compose 는 붙인 파일만 바뀐 것을 모른다)
vm $APP "cat > ~/aionit/Caddyfile.new" < infra/app-vm/Caddyfile
vm $APP 'cd ~/aionit && if cmp -s Caddyfile Caddyfile.new; then rm Caddyfile.new; else
  tag=$(grep ^CADDY_TAG= .env | cut -d= -f2)
  docker run --rm -v "$PWD/Caddyfile.new:/etc/caddy/Caddyfile:ro" "caddy:$tag" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || { echo "Caddyfile 검사 실패: 바꾸지 않습니다" >&2; rm Caddyfile.new; exit 1; }
  mv Caddyfile.new Caddyfile && docker compose restart caddy >/dev/null 2>&1 || true
  echo "Caddy 설정 바뀜: 다시 띄움"; fi'
# 데이터 서버의 compose.yaml 은 배포 때 바꾸지 않는다 (DB 재시작은 따로, 신중하게). 백업 스크립트만 맞춘다.
vm $DATA "cat > ~/aionit/backup.sh && chmod +x ~/aionit/backup.sh" < infra/data-vm/backup.sh

echo "== 5/6 배포 전 DB 백업 + 마이그레이션"
vm $DATA "~/aionit/backup.sh pre-deploy-$TAG"
vm $APP "cd ~/aionit && APP_TAG=$TAG docker compose run --rm --no-deps worker pnpm --filter @aionit/db migrate"

echo "== 6/6 전환 + 상태 확인"
vm $APP "echo $PREV > ~/aionit/.previous_tag"
switch_to "$TAG"
if healthy; then
  echo "완료: $TAG 배포됨"
else
  echo "상태 확인 실패 ➔ $PREV 로 되돌립니다" >&2
  [ "$PREV" != none ] && switch_to "$PREV"
  exit 1
fi

# 오래된 이미지 정리 (현재 · 직전만 남김)
vm $APP "docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^aionit-(web|worker):' | grep -vE ':($TAG|$PREV)$' | xargs -r docker rmi -f >/dev/null"
vm $DEV "docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^aionit-(web|worker):' | grep -vE ':($TAG|$PREV)$' | xargs -r docker rmi -f >/dev/null; docker builder prune -f --filter until=168h >/dev/null"
