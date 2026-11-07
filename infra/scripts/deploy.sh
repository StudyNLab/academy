#!/usr/bin/env bash
# AIONIT 서버 배포: 테스트 서버(기본) · 운영 서버(--cloud). 노트북 Git Bash 에서 실행
#   infra/scripts/deploy.sh             커밋된 현재 HEAD 를 배포
#   infra/scripts/deploy.sh --rollback  직전 버전으로 되돌리기
#   infra/scripts/deploy.sh --worktree  (개발 중 시험용) 커밋하지 않은 작업 트리를 배포. 태그가 wt- 로 시작한다
#   infra/scripts/deploy.sh --force     서버에 이미 있는 버전도 처음부터 다시 배포 (되돌릴 버전은 그대로 둔다)
#   infra/scripts/deploy.sh --cloud …   테스트 서버 대신 운영 서버(클라우드 한 대, infra/cloud)에. 다른 옵션과 함께 쓴다
#                                       SSH 이름은 aionit-cloud (노트북 ~/.ssh/config, 다른 이름이면 AIONIT_CLOUD_SSH=이름)
# 흐름: 개발 VM 에서 이미지 빌드 ➔ 앱 VM 으로 옮김 ➔ DB 백업 ➔ 마이그레이션 ➔ 전환 ➔ 상태 확인 (실패 시 자동 되돌리기)
# 서버의 ~/aionit/.previous_tag 가 '되돌릴 버전'이다. 같은 버전을 다시 배포해도 바뀌지 않는다.
set -euo pipefail

MODE=deploy FORCE= TARGET=test
for arg in "$@"; do
  case $arg in
    --rollback) MODE=rollback ;;
    --worktree) MODE=worktree ;;
    --force) FORCE=1 ;;
    --cloud) TARGET=cloud ;;
    *) echo "모르는 옵션: $arg (쓸 수 있는 것: --rollback · --worktree · --force · --cloud)" >&2; exit 1 ;;
  esac
done

JUMP=user1@10.100.4.52
DEV=22063
CLOUD_SSH=${AIONIT_CLOUD_SSH:-aionit-cloud}
# 배포 대상: 테스트 서버는 VM 두 대(app · data, 호스트를 거쳐 SSH), 운영 서버는 한 대(app · data 가 같은 서버)
if [ "$TARGET" = cloud ]; then
  APP=cloud DATA=cloud CONF=infra/cloud
else
  APP=22061 DATA=22062 CONF=infra/app-vm
fi
# vm <개발 VM · 테스트 VM 의 SSH 포트, 또는 cloud> <명령>
vm() {
  local where=$1; shift
  if [ "$where" = cloud ]; then ssh -o BatchMode=yes "$CLOUD_SSH" "$@"
  else ssh -o BatchMode=yes -o ProxyJump="$JUMP" -p "$where" user1@127.0.0.1 "$@"; fi
}

# 이미지 보관소(registry): 개발 VM 에 둔다. 개발 VM 은 127.0.0.1:5055 로 올리고, 앱 VM 은 브리지 망(사내망)으로
# 개발 VM 주소:5055 에서 바로 받아 간다. 그래서 이미지 전체가 아니라 바뀐 층(layer)만 옮겨진다.
# 보관소는 자체 인증서(TLS)로 열고, 앱 VM 주소에서만 받게 막아 두었다 (infra/dev-vm/README.md 의 '이미지 보관소').
DEV_BR=10.20.30.63            # 개발 VM 브리지 주소
DEV_MIN_FREE_GB=15            # 개발 VM 빈 자리가 이보다 적으면 배포 끝에 빌드 캐시를 모두 비운다
REG_PORT=5055
REG_IMAGE=registry:2.8.3
REG=127.0.0.1:$REG_PORT        # 개발 VM 안에서 쓰는 주소
REG_BR=$DEV_BR:$REG_PORT       # 앱 VM 에서 쓰는 주소
REG_TUNNEL_PORT=15055          # 운영 서버로 옮길 때: 노트북에서 개발 VM 보관소로 잇는 포트
REG_CERTS='$HOME/aionit-registry/certs'           # 개발 VM: registry.crt · registry.key
APP_CA=/etc/docker/certs.d/$REG_BR/ca.crt         # 앱 VM: 개발 VM 의 registry.crt 사본

# 단계마다 걸린 시간을 찍는다
START=$SECONDS STEP_AT=
step() {
  [ -n "$STEP_AT" ] && echo "   ($((SECONDS - STEP_AT))초)"
  STEP_AT=$SECONDS
  [ -n "${1:-}" ] && echo "== $*"
  return 0
}

cd "$(git rev-parse --show-toplevel)"

current_tag() { vm $APP "grep ^APP_TAG= ~/aionit/.env | cut -d= -f2"; }
previous_tag() { vm $APP "cat ~/aionit/.previous_tag 2>/dev/null || true"; }
# 비어 있으면 파일을 지운다 (되돌릴 버전 없음)
set_previous_tag() {
  if [ -n "$1" ]; then vm $APP "echo $1 > ~/aionit/.previous_tag"; else vm $APP "rm -f ~/aionit/.previous_tag"; fi
}
has_images() { vm $APP "docker image inspect aionit-web:$1 aionit-worker:$1 >/dev/null 2>&1"; }

switch_to() {
  local tag=$1
  vm $APP "cd ~/aionit && sed -i 's/^APP_TAG=.*/APP_TAG=$tag/' .env && docker compose up -d --remove-orphans --quiet-pull"
}

# Caddy 를 거쳐 확인한다. 사이트 주소는 .env 의 SITE_HOST (운영 서버 도메인), 없으면 localhost (테스트 서버)
healthy() {
  vm $APP 'h=$(grep ^SITE_HOST= ~/aionit/.env | cut -d= -f2); h=${h:-localhost}
  for i in $(seq 1 45); do
    s=$(docker inspect -f "{{.State.Health.Status}}" aionit-app-web-1 2>/dev/null || true)
    [ "$s" = healthy ] && curl -fsk --resolve "$h:443:127.0.0.1" "https://$h/api/health" >/dev/null && exit 0
    sleep 2
  done; exit 1'
}

[ "$TARGET" = cloud ] && echo "== 대상: 운영 서버 ($CLOUD_SSH)"

if [ "$MODE" = rollback ]; then
  prev=$(previous_tag)
  now=$(current_tag)
  [ -n "$prev" ] && [ "$prev" != none ] || { echo "되돌릴 이전 버전이 없습니다. 서버는 그대로($now)입니다." >&2; exit 1; }
  [ "$prev" != "$now" ] || { echo "되돌릴 버전($prev)이 지금 버전과 같아 되돌릴 곳이 없습니다. 서버는 그대로입니다." >&2; exit 1; }
  # 이미지가 없으면 compose 가 Docker Hub 에서 찾다가 실패하고 .env 만 바뀐 채 남는다. 바꾸기 전에 멈춘다.
  has_images "$prev" || { echo "이전 버전 $prev 의 이미지(aionit-web · aionit-worker)가 앱 VM 에 없어 되돌릴 수 없습니다. 서버는 그대로($now)입니다.
그 버전이 꼭 필요하면 그 커밋을 받아(git checkout $prev) 다시 배포하세요." >&2; exit 1; }
  echo "== 되돌리기: $now ➔ $prev"
  set_previous_tag "$now"
  switch_to "$prev"
  healthy && echo "완료: $prev 로 되돌렸습니다" || { echo "되돌린 버전도 상태 확인 실패 (다시 --rollback 하면 $now 로 돌아갑니다)" >&2; exit 1; }
  exit 0
fi

if [ "$MODE" = worktree ]; then
  TAG="wt-$(git rev-parse --short HEAD)-$(date +%m%d%H%M)"
  pack() { git ls-files -co --exclude-standard -z | tar --null -T - -cf -; }
else
  [ -z "$(git status --porcelain)" ] || { echo "커밋하지 않은 변경이 있습니다. 커밋한 코드만 배포합니다 (시험용: --worktree)." >&2; exit 1; }
  TAG=$(git rev-parse --short HEAD)
  pack() { git archive --format=tar HEAD; }
fi
PREV=$(current_tag)        # 지금 서버에서 도는 버전
OLD_PREV=$(previous_tag)   # 지금 서버의 되돌릴 버전
if [ "$TAG" = "$PREV" ]; then
  # 같은 커밋이면 compose · Caddyfile · 마이그레이션도 지난번 배포와 같다. 다시 할 일이 없다.
  [ -n "$FORCE" ] || { echo "이미 배포된 버전입니다 ($TAG). 바꿀 것이 없어 멈춥니다.
서버 파일을 손으로 고쳤거나 컨테이너를 처음부터 다시 올려야 하면: deploy.sh --force"; exit 0; }
  # 되돌릴 버전을 자기 자신으로 덮어쓰지 않고, 그 버전의 이미지도 남긴다
  NEXT_PREV=$OLD_PREV
  echo "== 같은 버전 다시 배포 $TAG (--force). 되돌릴 버전은 그대로: ${NEXT_PREV:-없음}"
else
  NEXT_PREV=$PREV
  echo "== 배포 $PREV ➔ $TAG"
fi
KEEP_PREV=${NEXT_PREV:-none}   # 정리 때 남길 이전 버전

step "1/6 빌드 맥락 보내기"
pack | vm $DEV "rm -rf ~/build/aionit && mkdir -p ~/build/aionit && tar -xf - -C ~/build/aionit"

step "2/6 이미지 빌드 (개발 VM)"
# 패키지 내려받기가 멈추는 일이 있어(2026-11-05, 17분 멈춤) 이미지마다 20분을 넘기면 끊는다
# --provenance=false: 빌드 기록(attestation)을 붙이면 이미지가 묶음(index)이 되는데, 보관소 정리(garbage-collect)가 묶음 안의 층을 지워 버린다 (registry 2.x)
vm $DEV "cd ~/build/aionit && timeout 20m docker build -q --provenance=false -f infra/docker/Dockerfile --target web -t aionit-web:$TAG . >/dev/null \
  && timeout 20m docker build -q --provenance=false -f infra/docker/Dockerfile --target worker -t aionit-worker:$TAG . >/dev/null" \
  || { echo "이미지 빌드 실패 (또는 20분 넘김). 서버는 그대로입니다." >&2; exit 1; }

step "3/6 이미지 옮기기 (개발 VM 보관소 ➔ 앱 서버, 바뀐 층만)"
# 보관소가 두 주소(127.0.0.1 · 브리지)에 열려 있지 않으면 다시 만든다. 올려 둔 이미지는 aionit-registry 볼륨에 남는다.
vm $DEV "docker port aionit-registry 5000/tcp 2>/dev/null | grep -qx '$REG_BR' || { docker rm -f aionit-registry >/dev/null 2>&1; \
  docker run -d --restart=always --name aionit-registry -p $REG:5000 -p $REG_BR:5000 \
  -v aionit-registry:/var/lib/registry -v $REG_CERTS:/certs:ro \
  -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/registry.crt -e REGISTRY_HTTP_TLS_KEY=/certs/registry.key \
  -e REGISTRY_STORAGE_DELETE_ENABLED=true $REG_IMAGE >/dev/null; }"
vm $DEV "for i in \$(seq 1 15); do curl -fs --cacert $REG_CERTS/registry.crt https://$REG/v2/ >/dev/null && exit 0; sleep 1; done; exit 1"
vm $DEV "for img in aionit-web aionit-worker; do docker tag \$img:$TAG $REG/\$img:$TAG && docker push -q $REG/\$img:$TAG >/dev/null \
  && docker rmi $REG/\$img:$TAG >/dev/null || exit 1; done"
if [ "$TARGET" = cloud ]; then
  # 운영 서버는 사내 브리지 망에 닿지 않는다. 배포하는 동안만 노트북이 SSH 두 개로 이어 준다:
  #   운영 서버 127.0.0.1:5055 ➔ (ssh -R) 노트북 127.0.0.1:15055 ➔ (ssh -L) 개발 VM 보관소 127.0.0.1:5055
  # 운영 서버의 Docker 는 127.0.0.0/8 보관소를 인증서 확인 없이 받는다 (Docker 기본값). 길 전체가 SSH 로 암호화돼 있다
  ssh -o BatchMode=yes -o ProxyJump="$JUMP" -o ExitOnForwardFailure=yes -N \
    -L "127.0.0.1:$REG_TUNNEL_PORT:127.0.0.1:$REG_PORT" -p "$DEV" user1@127.0.0.1 &
  TUNNEL_PID=$!
  trap 'kill $TUNNEL_PID 2>/dev/null || true' EXIT
  tunnel_up() { curl -fsk "https://127.0.0.1:$REG_TUNNEL_PORT/v2/" >/dev/null; }
  for i in $(seq 1 15); do tunnel_up && break; sleep 1; done
  tunnel_up || { echo "노트북 ➔ 개발 VM 보관소 터널(127.0.0.1:$REG_TUNNEL_PORT)이 열리지 않습니다. 서버는 그대로입니다." >&2; exit 1; }
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -R "127.0.0.1:$REG_PORT:127.0.0.1:$REG_TUNNEL_PORT" "$CLOUD_SSH" \
    "for img in aionit-web aionit-worker; do docker pull -q $REG/\$img:$TAG >/dev/null && docker tag $REG/\$img:$TAG \$img:$TAG \
      && docker rmi $REG/\$img:$TAG >/dev/null || exit 1; done" \
    || { echo "운영 서버가 이미지를 받지 못했습니다. 서버는 그대로입니다." >&2; exit 1; }
  kill $TUNNEL_PID 2>/dev/null || true
  trap - EXIT
else
  vm $APP "for i in \$(seq 1 10); do curl -fs --cacert $APP_CA https://$REG_BR/v2/ >/dev/null && exit 0; sleep 1; done
    echo '앱 VM 에서 보관소($REG_BR)에 닿지 않습니다. 브리지 랜카드 · 개발 VM 방화벽(aionit-registry-allow) · 인증서($APP_CA)를 확인하세요. 서버는 그대로입니다.' >&2; exit 1"
  vm $APP "for img in aionit-web aionit-worker; do docker pull -q $REG_BR/\$img:$TAG >/dev/null && docker tag $REG_BR/\$img:$TAG \$img:$TAG \
    && docker rmi $REG_BR/\$img:$TAG >/dev/null || exit 1; done"
fi

step "4/6 서버 설정 반영"
vm $APP "cat > ~/aionit/compose.yaml" < $CONF/compose.yaml
# Caddyfile 이 바뀌었으면 Caddy 를 다시 띄운다 (compose 는 붙인 파일만 바뀐 것을 모른다)
# 검사 때 Caddyfile 의 {$…} 자리(운영 서버: SITE_HOST · ACME_EMAIL · ADMIN_ALLOW_IPS)를 .env 에서 넘긴다. 테스트 서버는 자리가 없다
vm $APP "cat > ~/aionit/Caddyfile.new" < $CONF/Caddyfile
vm $APP 'cd ~/aionit && if cmp -s Caddyfile Caddyfile.new; then rm Caddyfile.new; else
  tag=$(grep ^CADDY_TAG= .env | cut -d= -f2)
  (umask 077; grep -E "^(SITE_HOST|ACME_EMAIL|ADMIN_ALLOW_IPS)=" .env > .caddy-check.env || true)
  docker run --rm --env-file .caddy-check.env -v "$PWD/Caddyfile.new:/etc/caddy/Caddyfile:ro" "caddy:$tag" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || { echo "Caddyfile 검사 실패: 바꾸지 않습니다" >&2; rm -f Caddyfile.new .caddy-check.env; exit 1; }
  rm -f .caddy-check.env
  mv Caddyfile.new Caddyfile && docker compose restart caddy >/dev/null 2>&1 || true
  echo "Caddy 설정 바뀜: 다시 띄움"; fi'
# 테스트 서버: data VM 의 compose.yaml 은 배포 때 바꾸지 않는다 (DB 재시작은 따로, 신중하게). 백업 스크립트만 맞춘다.
# 운영 서버: DB 도 위 compose.yaml 에 들어 있다. 백업 스크립트와 그 설정 · app 설정 묶기 스크립트를 맞춘다.
vm $DATA "cat > ~/aionit/backup.sh && chmod +x ~/aionit/backup.sh" < infra/data-vm/backup.sh
if [ "$TARGET" = cloud ]; then
  vm $APP "cat > ~/aionit/backup.conf" < infra/cloud/backup.conf
  vm $APP "cat > ~/aionit/config-backup.sh && chmod 700 ~/aionit/config-backup.sh" < infra/app-vm/config-backup.sh
fi

step "5/6 배포 전 DB 백업 + 마이그레이션"
vm $DATA "~/aionit/backup.sh pre-deploy-$TAG"
# 마이그레이션은 DB 소유자 계정으로 (M10 앱 계정 분리). 앱 VM ~/aionit/.env.migrate 의 MIGRATION_DATABASE_URL 을 이번
# 실행에만 넘긴다 (web · worker 의 .env 에는 소유자 비밀번호를 두지 않는다). 파일이 없으면 지금처럼 DATABASE_URL 로 한다.
vm $APP "cd ~/aionit && if [ -f .env.migrate ]; then set -a; . ./.env.migrate; set +a; fi; APP_TAG=$TAG docker compose run --rm --no-deps -e MIGRATION_DATABASE_URL worker pnpm --filter @aionit/db migrate"

step "6/6 전환 + 상태 확인"
[ "$NEXT_PREV" = "$OLD_PREV" ] || set_previous_tag "$NEXT_PREV"
switch_to "$TAG"
if healthy; then
  step
  echo "완료: $TAG 배포됨 (모두 $((SECONDS - START))초)"
elif [ "$TAG" = "$PREV" ]; then
  echo "상태 확인 실패. 같은 버전을 다시 올린 것이라 다른 버전으로 자동으로 바꾸지 않습니다.
이전 버전(${NEXT_PREV:-없음})으로 가려면: deploy.sh --rollback" >&2
  exit 1
else
  echo "상태 확인 실패 ➔ $PREV 로 되돌립니다" >&2
  [ "$PREV" != none ] && switch_to "$PREV"
  [ "$NEXT_PREV" = "$OLD_PREV" ] || set_previous_tag "$OLD_PREV"
  exit 1
fi

# 오래된 이미지 정리 (현재 · 되돌릴 버전만 남김). 정리에 실패해도 배포는 끝난 것이다.
vm $APP "docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^aionit-(web|worker):' | grep -vE ':($TAG|$KEEP_PREV)$' | xargs -r docker rmi -f >/dev/null" || true
vm $DEV "docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^aionit-(web|worker):' | grep -vE ':($TAG|$KEEP_PREV)$' | xargs -r docker rmi -f >/dev/null
  docker image prune -f >/dev/null
  # 빌드 캐시는 크기 · 기간으로 조금씩 정리하지 않는다. 그러면 바닥 층(corepack · 패키지 설치 · ffmpeg)부터 지워져
  # 다음 빌드가 처음부터 돈다 (2026-11-05: --max-used-space 15gb 로 빌드 46초 ➔ 150초). 빈 자리가 모자랄 때만 모두 비운다.
  [ \$(df --output=avail -BG / | tail -1 | tr -dc 0-9) -ge $DEV_MIN_FREE_GB ] || { docker builder prune -af >/dev/null
    echo '개발 VM 빈 자리가 ${DEV_MIN_FREE_GB}GB 밑이라 빌드 캐시를 모두 비웠습니다. 다음 배포의 빌드는 처음부터 해서 느립니다.' >&2; }" || true
# 보관소: 현재 · 되돌릴 버전 태그만 남기고 지운 뒤 빈 층을 치운다. 같은 내용(digest)을 가리키는 태그는 건드리지 않는다.
vm $DEV "reg=https://$REG ca=\"--cacert $REG_CERTS/registry.crt\"
  acc='-H Accept:application/vnd.oci.image.index.v1+json -H Accept:application/vnd.oci.image.manifest.v1+json -H Accept:application/vnd.docker.distribution.manifest.v2+json -H Accept:application/vnd.docker.distribution.manifest.list.v2+json'
  digest() { curl -fsI \$ca \$acc \$reg/v2/\$1/manifests/\$2 | tr -d '\r' | awk -F': ' 'tolower(\$1)==\"docker-content-digest\"{print \$2}'; }
  for repo in aionit-web aionit-worker; do
    keep=\"\$(digest \$repo $TAG) \$(digest \$repo $KEEP_PREV 2>/dev/null || true)\"
    for t in \$(curl -fs \$ca \$reg/v2/\$repo/tags/list | tr -d '\"[]{}' | sed 's/.*tags://' | tr , ' '); do
      [ \"\$t\" = $TAG ] || [ \"\$t\" = $KEEP_PREV ] && continue
      d=\$(digest \$repo \$t) || continue
      case \" \$keep \" in *\" \$d \"*) continue ;; esac
      curl -fs \$ca -X DELETE \$reg/v2/\$repo/manifests/\$d >/dev/null || true
    done
  done
  docker exec aionit-registry registry garbage-collect --delete-untagged /etc/docker/registry/config.yml >/dev/null 2>&1
  # 정리 뒤에는 다시 띄운다. 보관소가 기억해 둔 '있는 층' 목록이 남아 있으면 지운 층을 있다고 답해 올리기를 건너뛴다
  docker restart aionit-registry >/dev/null" || true
