# 루트 Dockerfile — Next.js 15 standalone 출력, ARM64 전용 (AgentCore/Lambda 컨테이너와 아키텍처 통일)
# design.md: Next.js Lambda(컨테이너) + Function URL + OAC 구성.
# next.config.ts 의 `output: 'standalone'` 을 전제로 한다.
#
# 빌드 예:
#   docker buildx build --platform linux/arm64 -t waganda-web:latest .

# ---- 의존성 설치 단계 ----------------------------------------------------
FROM --platform=linux/arm64 node:22-slim AS deps
WORKDIR /app

# 워크스페이스 매니페스트만 먼저 복사해 npm ci 캐시를 최대한 재사용한다
COPY package.json package-lock.json ./
COPY packages/schemas/package.json packages/schemas/package.json
COPY agent/package.json agent/package.json
COPY infrastructure/package.json infrastructure/package.json

RUN npm ci

# ---- 빌드 단계 ------------------------------------------------------------
FROM --platform=linux/arm64 node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js standalone 빌드 (app 워크스페이스가 사용하는 @waganda/schemas 포함)
RUN npm run build

# ---- 실행 단계 (standalone 산출물만 포함, 최소 크기) -----------------------
FROM --platform=linux/arm64 node:22-slim AS runner
WORKDIR /app

# AWS Lambda Web Adapter — Lambda 런타임 API 와 HTTP 서버를 잇는 확장.
# 이것이 없으면 `node server.js` 는 3000 포트에 뜨기만 하고 런타임 API 에 응답하지 않아
# init/invoke 가 모두 타임아웃한다(실제로 502 를 겪었다).
# Lambda 외부(로컬·ECS)에서는 확장이 실행되지 않으므로 일반 웹 서버로 그대로 동작한다.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1 /lambda-adapter /opt/extensions/lambda-adapter

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# 어댑터가 프록시할 포트를 Next.js 포트와 맞춘다(기본값은 8080).
ENV AWS_LWA_PORT=3000
# 준비 확인은 TCP 로 한다. HTTP GET / 로 확인하면 루트 페이지가 DynamoDB 를 읽는 동안
# 200 이 아닐 수 있어 콜드 스타트가 불필요하게 실패한다.
ENV AWS_LWA_READINESS_CHECK_PROTOCOL=tcp

# 비루트 사용자로 실행 (컨테이너 권한 최소화)
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# standalone 출력물: 실행에 필요한 node_modules 서브셋 + 서버 코드만 포함되어 이미지가 가벼움
# `npm run build` 는 NEXT_DIST_DIR=.next-prod 로 산출물을 dev(.next)와 분리한다.
# standalone 서버는 자기 기준 경로에서 static 을 찾으므로 같은 이름(.next-prod)으로 복사한다.
COPY --from=builder --chown=nextjs:nodejs /app/.next-prod/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next-prod/static ./.next-prod/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
