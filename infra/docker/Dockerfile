# AIONIT 이미지 (web · worker). 개발 VM 에서 저장소 루트를 빌드 맥락으로 빌드한다:
#   docker build -f infra/docker/Dockerfile --target web    -t aionit-web:<태그> .
#   docker build -f infra/docker/Dockerfile --target worker -t aionit-worker:<태그> .

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
WORKDIR /repo

# 의존성 설치 (잠금 파일 그대로, 공급망 규칙 적용)
FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

# web 빌드 (Next.js standalone)
FROM deps AS web-build
RUN pnpm --filter @aionit/web build

# ---- web: 실행에 필요한 파일만 ----
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- worker: 작업 처리 + 마이그레이션 실행 (worker 와 그 의존 패키지만 설치) ----
FROM base AS worker
COPY . .
RUN pnpm install --frozen-lockfile --filter "@aionit/worker..." && chown -R node:node /repo
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@aionit/worker", "start"]
