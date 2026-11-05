#!/usr/bin/env bash
# deploy.sh 시험 (서버에 닿지 않는다)
#   bash infra/scripts/test-deploy.sh
# ssh · git 을 가짜로 바꿔 VM 세 대를 노트북 임시 폴더로 흉내 낸다.
# 가짜 ssh 는 받은 명령을 그 VM 의 임시 홈에서 그대로 실행하고, 가짜 docker · curl 은 이미지 · 보관소 목록을 파일로 흉내 낸다.
# 경우마다 .previous_tag · APP_TAG · 지운 이미지를 보여 주고 기대값과 맞는지 확인한다.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
DEPLOY=${DEPLOY:-$REPO/infra/scripts/deploy.sh}   # 다른 판을 시험하려면 DEPLOY=경로
DEV_BR=$(sed -n 's/^DEV_BR=\([0-9.]*\).*/\1/p' "$DEPLOY")
SB=$(mktemp -d)
trap 'rm -rf "$SB"' EXIT
BIN=$SB/bin
mkdir -p "$BIN"

cat > "$BIN/ssh" <<'EOF'
#!/usr/bin/env bash
port=
while [ $# -gt 0 ]; do
  case $1 in
    -o|-L|-R) shift 2 ;;
    -p) port=$2; shift 2 ;;
    -*) shift ;;
    *) shift; break ;;
  esac
done
case $port in 22061) vm=app ;; 22062) vm=data ;; 22063) vm=dev ;; *) echo "가짜 ssh: 모르는 포트 $port" >&2; exit 255 ;; esac
export HOME=$FAKE_SB/$vm FAKE_VM=$vm
cd "$HOME"
exec bash -c "$*"
EOF

cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
img=$HOME/.images reg=$FAKE_SB/dev/.registry log=$FAKE_SB/log
touch "$img" "$reg"
add() { grep -qxF "$2" "$1" || echo "$2" >> "$1"; }
del() { grep -vxF "$2" "$1" > "$1.tmp" || true; mv "$1.tmp" "$1"; }
case $1 in
  images) cat "$img" ;;
  rmi) shift; f=; [ "${1:-}" = -f ] && { f=1; shift; }
    for i; do del "$img" "$i"; [ -z "$f" ] || echo "[$FAKE_VM] 이미지 지움 $i" >> "$log"; done ;;
  build) t=; while [ $# -gt 0 ]; do [ "$1" = -t ] && t=$2; shift; done; add "$img" "$t" ;;
  tag) add "$img" "$3" ;;
  push) add "$reg" "${3#*/}" ;;
  pull) grep -qxF "${3#*/}" "$reg" || { echo "가짜 docker: 보관소에 $3 없음" >&2; exit 1; }; add "$img" "$3" ;;
  run) case " $* " in *" --name aionit-registry "*)
      : > "$HOME/.regports"; while [ $# -gt 0 ]; do [ "$1" = -p ] && echo "${2%:5000}" >> "$HOME/.regports"; shift; done
      echo "[$FAKE_VM] 보관소 다시 만듦: $(paste -sd' ' "$HOME/.regports")" >> "$log" ;; esac ;;
  port) cat "$HOME/.regports" 2>/dev/null ;;
  rm) rm -f "$HOME/.regports" ;;
  ps) echo fake ;;
  builder) echo "[$FAKE_VM] $*" >> "$FAKE_SB/builder.log" ;;
  inspect) echo "${FAKE_HEALTH:-healthy}" ;;
  image) [ "$2" = inspect ] || exit 0; shift 2; for i; do grep -qxF "$i" "$img" || exit 1; done ;;
  compose) [ "$2" = up ] || exit 0
    t=$(grep ^APP_TAG= .env | cut -d= -f2)
    for r in aionit-web aionit-worker; do grep -qxF "$r:$t" "$img" || { echo "가짜 docker: $r:$t 이미지 없음 (pull access denied)" >&2; exit 1; }; done ;;
esac
exit 0
EOF

cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
reg=$FAKE_SB/dev/.registry log=$FAKE_SB/log url= del=
for a; do case $a in http*) url=$a ;; DELETE) del=1 ;; esac; done
case $url in
  */api/health) [ "${FAKE_HEALTH:-healthy}" = healthy ] ;;
  */v2/) exit 0 ;;
  */tags/list) repo=${url%/tags/list}; repo=${repo##*/v2/}
    tags=$(grep "^$repo:" "$reg" | cut -d: -f2 | sed 's/.*/"&"/' | paste -sd, -)
    echo "{\"name\":\"$repo\",\"tags\":[$tags]}" ;;
  */manifests/*) repo=${url%/manifests/*}; repo=${repo##*/v2/}; ref=${url##*/manifests/}
    if [ -n "$del" ]; then
      t=${ref#sha256:}; grep -vxF "$repo:$t" "$reg" > "$reg.tmp" || true; mv "$reg.tmp" "$reg"
      echo "[보관소] 지움 $repo:$t" >> "$log"
    else
      grep -qxF "$repo:$ref" "$reg" || exit 22
      printf 'Docker-Content-Digest: sha256:%s\r\n' "$ref"
    fi ;;
esac
EOF

cat > "$BIN/git" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "rev-parse --show-toplevel") echo "$FAKE_SB/repo" ;;
  "status --porcelain") ;;
  "rev-parse --short HEAD") echo "$FAKE_HEAD" ;;
  "archive --format=tar HEAD") tar -cf - -C "$FAKE_SB/repo" infra ;;
  *) echo "가짜 git: $*" >&2; exit 1 ;;
esac
EOF

# 개발 VM 빈 자리 (GB). 정리 조건 시험용
printf '#!/usr/bin/env bash
echo Avail; echo " ${FAKE_DF_GB:-40}G"
' > "$BIN/df"

# 상태 확인 대기(sleep 2 × 45)를 기다리지 않는다
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
chmod +x "$BIN"/*

export FAKE_SB=$SB PATH="$BIN:$PATH"
# 가짜가 먼저 잡히지 않으면 진짜 서버에 닿을 수 있다. 그때는 아무것도 하지 않고 멈춘다.
[ "$(command -v ssh)" = "$BIN/ssh" ] && [ "$(command -v git)" = "$BIN/git" ] \
  || { echo "가짜 ssh · git 이 먼저 잡히지 않아 멈춥니다" >&2; exit 1; }

# setup <지금 태그> <.previous_tag(없으면 '')> <앱·개발 VM · 보관소에 있는 태그들...>
setup() {
  local now=$1 prev=$2 t; shift 2
  rm -rf "$SB/app" "$SB/data" "$SB/dev" "$SB/repo" "$SB/log" "$SB/builder.log"
  mkdir -p "$SB/app/aionit" "$SB/data/aionit" "$SB/dev" "$SB/repo/infra/app-vm" "$SB/repo/infra/data-vm"
  cp "$REPO/infra/app-vm/compose.yaml" "$REPO/infra/app-vm/Caddyfile" "$SB/repo/infra/app-vm/"
  printf '#!/usr/bin/env bash\necho "가짜 백업 $1"\n' > "$SB/repo/infra/data-vm/backup.sh"
  printf 'CADDY_TAG=2\nAPP_TAG=%s\n' "$now" > "$SB/app/aionit/.env"
  [ -z "$prev" ] || echo "$prev" > "$SB/app/aionit/.previous_tag"
  touch "$SB/log" "$SB/builder.log" "$SB/app/.images" "$SB/dev/.images" "$SB/dev/.registry"
  printf '127.0.0.1:5055\n%s:5055\n' "$DEV_BR" > "$SB/dev/.regports"   # 보관소가 두 주소에 열려 있는 보통 상태
  for t; do
    for r in aionit-web aionit-worker; do
      echo "$r:$t" >> "$SB/app/.images"; echo "$r:$t" >> "$SB/dev/.images"; echo "$r:$t" >> "$SB/dev/.registry"
    done
  done
}

FAILS=0
check() {   # check <이름> <실제> <기대>
  if [ "$2" = "$3" ]; then echo "   ✔ $1: $2"; else echo "   ✘ $1: '$2' (기대 '$3')"; FAILS=$((FAILS + 1)); fi
}
prev_now() { cat "$SB/app/aionit/.previous_tag" 2>/dev/null || echo 없음; }
tag_now() { grep ^APP_TAG= "$SB/app/aionit/.env" | cut -d= -f2; }
tags_in() { sed 's/.*://' "$1" | sort -u | paste -sd' ' -; }

# run <배포할 커밋> [옵션...]: 결과 코드를 RC 에, 출력을 OUT 에
run() {
  local head=$1; shift
  RC=0; OUT=$(FAKE_HEAD=$head bash "$DEPLOY" "$@" 2>&1) || RC=$?
  echo "$OUT" | grep -vE '^   \(|^== [0-9]/6' | sed 's/^/   | /'
}
report() {
  echo "   지운 것:"; if [ -s "$SB/log" ]; then sed 's/^/     /' "$SB/log"; else echo "     (없음)"; fi
}

echo "■ 1. 새 태그 배포: 0ace235 에서 d1d1e46 으로 (되돌릴 버전 0888742)"
setup 0ace235 0888742 0888742 0ace235
run d1d1e46
report
check "결과 코드" "$RC" 0
check ".previous_tag" "$(prev_now)" 0ace235
check "APP_TAG" "$(tag_now)" d1d1e46
check "앱 VM 이미지" "$(tags_in "$SB/app/.images")" "0ace235 d1d1e46"
check "개발 VM 이미지" "$(tags_in "$SB/dev/.images")" "0ace235 d1d1e46"
check "보관소" "$(tags_in "$SB/dev/.registry")" "0ace235 d1d1e46"
check "빌드 캐시 정리 (빈 자리 넉넉 ➔ 안 함)" "$(grep -c prune "$SB/builder.log")" 0

echo; echo "■ 2. 같은 태그 다시 배포 (2026-11-05 상황): 서버 d1d1e46, 되돌릴 버전 0ace235"
setup d1d1e46 0ace235 0ace235 d1d1e46
run d1d1e46
report
check "결과 코드" "$RC" 0
check "건너뜀 안내" "$(echo "$OUT" | grep -c '이미 배포된 버전입니다')" 1
check ".previous_tag" "$(prev_now)" 0ace235
check "앱 VM 이미지" "$(tags_in "$SB/app/.images")" "0ace235 d1d1e46"

echo; echo "■ 3. 같은 태그 --force: 서버 d1d1e46, 되돌릴 버전 0ace235"
setup d1d1e46 0ace235 0ace235 d1d1e46
run d1d1e46 --force
report
check "결과 코드" "$RC" 0
check ".previous_tag" "$(prev_now)" 0ace235
check "APP_TAG" "$(tag_now)" d1d1e46
check "앱 VM 이미지" "$(tags_in "$SB/app/.images")" "0ace235 d1d1e46"
check "개발 VM 이미지" "$(tags_in "$SB/dev/.images")" "0ace235 d1d1e46"
check "보관소" "$(tags_in "$SB/dev/.registry")" "0ace235 d1d1e46"

echo; echo "■ 4. 이전 태그 없음 ➔ 새 태그: 서버 0ace235, .previous_tag 없음"
setup 0ace235 '' 0ace235
run d1d1e46
report
check "결과 코드" "$RC" 0
check ".previous_tag" "$(prev_now)" 0ace235
check "앱 VM 이미지" "$(tags_in "$SB/app/.images")" "0ace235 d1d1e46"

echo; echo "■ 5. 이전 태그 없음 ➔ 같은 태그 --force: 서버 d1d1e46, .previous_tag 없음, 남은 옛 이미지 0ace235"
setup d1d1e46 '' 0ace235 d1d1e46
run d1d1e46 --force
report
check "결과 코드" "$RC" 0
check ".previous_tag" "$(prev_now)" 없음
check "앱 VM 이미지" "$(tags_in "$SB/app/.images")" "d1d1e46"

echo; echo "■ 6. 새 태그 상태 확인 실패: 서버 0ace235, 되돌릴 버전 0888742 ➔ d1d1e46 실패"
setup 0ace235 0888742 0888742 0ace235
FAKE_HEALTH=unhealthy run d1d1e46
report
check "결과 코드" "$RC" 1
check "APP_TAG (자동 되돌림)" "$(tag_now)" 0ace235
check ".previous_tag (원래대로)" "$(prev_now)" 0888742
check "앱 VM 이미지 (정리 안 함)" "$(tags_in "$SB/app/.images")" "0888742 0ace235 d1d1e46"

echo; echo "■ 7. --rollback 정상: 서버 d1d1e46, 되돌릴 버전 0ace235"
setup d1d1e46 0ace235 0ace235 d1d1e46
run x --rollback
check "결과 코드" "$RC" 0
check "APP_TAG" "$(tag_now)" 0ace235
check ".previous_tag" "$(prev_now)" d1d1e46

echo; echo "■ 8. --rollback, 이전 버전 이미지 없음: 서버 d1d1e46, 되돌릴 버전 0ace235 (이미지 지워짐)"
setup d1d1e46 0ace235 d1d1e46
run x --rollback
check "결과 코드" "$RC" 1
check "오류 안내" "$(echo "$OUT" | grep -c '이미지(aionit-web · aionit-worker)가 앱 VM 에 없어')" 1
check "APP_TAG (그대로)" "$(tag_now)" d1d1e46
check ".previous_tag (그대로)" "$(prev_now)" 0ace235

echo; echo "■ 9. --rollback, 되돌릴 버전이 지금 버전과 같음 (지금 서버 상태): 둘 다 d1d1e46"
setup d1d1e46 d1d1e46 d1d1e46
run x --rollback
check "결과 코드" "$RC" 1
check "APP_TAG (그대로)" "$(tag_now)" d1d1e46

echo; echo "■ 10. --rollback, .previous_tag 없음"
setup d1d1e46 '' d1d1e46
run x --rollback
check "결과 코드" "$RC" 1
check "APP_TAG (그대로)" "$(tag_now)" d1d1e46

echo; echo "■ 11. 모르는 옵션 (--rolback 오타)"
setup d1d1e46 0ace235 0ace235 d1d1e46
run x --rolback
check "결과 코드" "$RC" 1
check "APP_TAG (그대로)" "$(tag_now)" d1d1e46

echo; echo "■ 12. 보관소가 개발 VM 127.0.0.1 에만 열려 있음 (터널 방식 때 만든 것) ➔ 브리지 주소까지 열어 다시 만듦"
setup 0ace235 0888742 0888742 0ace235
echo 127.0.0.1:5055 > "$SB/dev/.regports"
run d1d1e46
report
check "결과 코드" "$RC" 0
check "보관소 주소" "$(sort "$SB/dev/.regports" | paste -sd' ' -)" "$DEV_BR:5055 127.0.0.1:5055"
check "APP_TAG" "$(tag_now)" d1d1e46
check "보관소 (올려 둔 이미지 그대로)" "$(tags_in "$SB/dev/.registry")" "0ace235 d1d1e46"

echo; echo "■ 13. 개발 VM 빈 자리 8GB (기준 15GB 밑) ➔ 배포 끝에 빌드 캐시를 모두 비우고 알림"
setup 0ace235 0888742 0888742 0ace235
FAKE_DF_GB=8 run d1d1e46
check "결과 코드" "$RC" 0
check "APP_TAG" "$(tag_now)" d1d1e46
check "빌드 캐시 모두 비움" "$(cat "$SB/builder.log")" "[dev] builder prune -af"
check "알림" "$(echo "$OUT" | grep -c '빌드 캐시를 모두 비웠습니다')" 1

echo
if [ "$FAILS" -eq 0 ]; then echo "모두 통과"; else echo "실패 $FAILS 개"; exit 1; fi
