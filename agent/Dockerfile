# agent/Dockerfile — Strands(TS) 분석 에이전트, AgentCore Runtime 배포용
# design.md 검증된 런타임 제약: linux/arm64 필수, 이미지 상한 2GB, /invocations·/ping 서빙.
# HEALTHCHECK 는 정의하지 않는다 (AgentCore Runtime이 자체적으로 /ping 을 폴링하며,
# 컨테이너 내부 HEALTHCHECK 는 요구되지 않고 이미지 크기·복잡도만 늘린다).
#
# 빌드 예:
#   docker buildx build --platform linux/arm64 -t waganda-agent:latest ./agent

# ---- 의존성 설치 단계 ------------------------------------------------------
FROM --platform=linux/arm64 node:22-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY packages/schemas/package.json packages/schemas/package.json

# 워크스페이스 전체 설치 (agent가 @waganda/schemas 를 참조하므로 루트에서 설치)
RUN npm ci --workspace @waganda/agent --workspace @waganda/schemas --include-workspace-root

# ---- 빌드 단계 --------------------------------------------------------------
FROM --platform=linux/arm64 node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/agent/node_modules ./agent/node_modules
COPY packages/schemas ./packages/schemas
# agent 는 @app/domain/*, @app/db/* (tsconfig 의 "@app/*": ["../lib/*"]) 로
# lib/ 의 순수 도메인 로직·리포지토리를 재사용한다. esbuild 번들 시점에 이
# 소스가 필요하므로 반드시 함께 복사해야 한다 — 누락 시 `npm run build` 가
# 모듈 해석 실패로 죽는다.
# 또한 lib/db/repository.ts 등은 자기참조 alias `@/lib/...` 를 쓰는데, esbuild 는
# 번들 대상 소스 파일 각각의 실제 위치 기준으로 가장 가까운 tsconfig.json 을 찾아
# paths 를 해석하므로, lib/ 바로 위 계층인 루트 tsconfig.json 도 복사해야 한다.
COPY lib ./lib
COPY tsconfig.json ./tsconfig.json
COPY agent ./agent

WORKDIR /app/agent
RUN npm run build

# ---- 실행 단계 (프로덕션 의존성만) ------------------------------------------
FROM --platform=linux/arm64 node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# 비루트 사용자로 실행
RUN groupadd --system --gid 1001 agent \
  && useradd --system --uid 1001 --gid agent agent

COPY --from=builder --chown=agent:agent /app/agent/dist ./dist
COPY --from=builder --chown=agent:agent /app/agent/node_modules ./node_modules
COPY --from=builder --chown=agent:agent /app/agent/package.json ./package.json

USER agent

# AgentCore Runtime 규격: 8080 포트에서 /invocations(POST), /ping(GET) 을 서빙한다
EXPOSE 8080

CMD ["node", "dist/entrypoint.js"]
