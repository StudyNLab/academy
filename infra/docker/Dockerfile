# AIONIT 이미지 (web · worker). 개발 VM 에서 저장소 루트를 빌드 맥락으로 빌드한다:
#   docker build -f infra/docker/Dockerfile --target web    -t aionit-web:<태그> .
#   docker build -f infra/docker/Dockerfile --target worker -t aionit-worker:<태그> .
# 빌드를 빠르게 (docs/개발기록/M0.md 배포 시간 줄이기):
#   - 패키지 목록(package.json · 잠금 파일)만 먼저 넣고 설치한다. 코드만 바뀌면 설치 단계는 저장된 결과를 그대로 쓴다.
#   - 내려받은 패키지(pnpm store) 와 Next.js 빌드 결과(.next/cache) 는 개발 VM 의 빌드 캐시에 남겨 다음 빌드에 쓴다.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
# pnpm 은 이미지 안(/corepack)에 넣어 둔다. 실행 계정(node)도 같은 곳을 보므로 실행할 때마다 내려받지 않는다.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/corepack
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate && chown -R node:node /corepack
WORKDIR /repo

# 패키지 목록만. 워크스페이스에 패키지를 더하면 여기에도 한 줄 더한다.
FROM scratch AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /
COPY apps/web/package.json /apps/web/
COPY apps/worker/package.json /apps/worker/
COPY packages/config/package.json /packages/config/
COPY packages/content/package.json /packages/content/
COPY packages/core/package.json /packages/core/
COPY packages/db/package.json /packages/db/
COPY packages/mail/package.json /packages/mail/
COPY packages/payments/package.json /packages/payments/
COPY packages/storage/package.json /packages/storage/
COPY packages/ui/package.json /packages/ui/

# 의존성 설치 (잠금 파일 그대로, 공급망 규칙 적용) ➔ 그다음에 코드
FROM base AS deps
COPY --from=manifests / ./
RUN --mount=type=cache,id=aionit-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .

# web 빌드 (Next.js standalone)
FROM deps AS web-build
RUN --mount=type=cache,id=aionit-next,target=/repo/apps/web/.next/cache \
    pnpm --filter @aionit/web build

# ---- web: 실행에 필요한 파일만 ----
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# public (사진 · 아이콘) 은 standalone 에 들어가지 않으므로 따로 복사한다
COPY --from=web-build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- worker: 작업 처리 + 마이그레이션 실행 (worker 와 그 의존 패키지만 설치) ----
# 영상 변환용 ffmpeg 는 Debian 공식 저장소에서 (docs/기술설계.md 5.2)
FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=manifests / ./
RUN --mount=type=cache,id=aionit-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --filter "@aionit/worker..." --store-dir /pnpm/store && chown -R node:node /repo
COPY --chown=node:node . .
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@aionit/worker", "start"]
