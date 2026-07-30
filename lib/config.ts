import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * 설정과 시크릿의 단일 주입 지점.
 *
 * - 시크릿은 소스코드에 두지 않는다. SSM Parameter Store SecureString 이 원본이다.
 * - Lambda 환경변수로 직접 주입된 값이 있으면 그것을 쓰고, 없으면 SSM 에서 읽어 캐시한다.
 * - 필수 값이 없으면 **즉시 실패**한다. 기본값으로 조용히 넘어가지 않는다 (R1, R10).
 */

export type AppEnv = 'dev' | 'prod' | 'test' | 'local';

export interface RuntimeConfig {
  env: AppEnv;
  region: string;
  tableName: string;
  mediaBucket: string;
  appBaseUrl: string;
  cloudFrontDistributionId?: string;
  agentRuntimeArn?: string;
  audioLambdaName?: string;
  /** 일간 에이전트 실행 상한 (R10) */
  dailyAgentRunLimit: number;
  /** 월 모델 비용 상한(USD) (R10) */
  monthlyModelBudgetUsd: number;
}

export interface AuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  jwtSecret: string;
  /** 편집자 허용 목록 (소문자 정규화) */
  allowlist: string[];
  /** 세션 유효 기간(초) */
  sessionTtlSec: number;
}

/** 필수 환경변수 읽기 — 없으면 즉시 실패 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `설정 누락: 환경변수 ${name} 가 필요합니다. SSM Parameter Store 또는 배포 설정을 확인하세요.`,
    );
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function numberEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`설정 오류: ${name} 는 숫자여야 합니다 (현재: ${raw})`);
  }
  return parsed;
}

export function getRuntimeConfig(): RuntimeConfig {
  const env = (optionalEnv('WAGANDA_ENV') ?? 'local') as AppEnv;
  return {
    env,
    region: optionalEnv('AWS_REGION') ?? optionalEnv('AWS_DEFAULT_REGION') ?? 'ap-northeast-2',
    tableName: requireEnv('WAGANDA_TABLE_NAME'),
    mediaBucket: requireEnv('WAGANDA_MEDIA_BUCKET'),
    appBaseUrl: requireEnv('APP_BASE_URL'),
    cloudFrontDistributionId: optionalEnv('WAGANDA_CF_DISTRIBUTION_ID'),
    agentRuntimeArn: optionalEnv('WAGANDA_AGENT_RUNTIME_ARN'),
    audioLambdaName: optionalEnv('WAGANDA_AUDIO_LAMBDA'),
    dailyAgentRunLimit: numberEnv('WAGANDA_DAILY_AGENT_RUN_LIMIT', 30),
    monthlyModelBudgetUsd: numberEnv('WAGANDA_MONTHLY_MODEL_BUDGET_USD', 10),
  };
}

/* ── SSM 조회 (환경변수 미주입 시 폴백) ─────────────────────────── */

let ssmClient: SSMClient | undefined;
let ssmCache: Record<string, string> | undefined;

/** 테스트에서 캐시를 비우기 위한 훅 */
export function resetConfigCache(): void {
  ssmCache = undefined;
  ssmClient = undefined;
}

function ssmParameterPrefix(): string {
  const env = optionalEnv('WAGANDA_ENV') ?? 'local';
  return optionalEnv('WAGANDA_SSM_PREFIX') ?? `/waganda/${env}`;
}

const SSM_KEYS = {
  googleClientId: 'google/client-id',
  googleClientSecret: 'google/client-secret',
  jwtSecret: 'auth/jwt-secret',
  allowlist: 'auth/editor-allowlist',
} as const;

async function loadFromSsm(): Promise<Record<string, string>> {
  if (ssmCache) return ssmCache;
  const prefix = ssmParameterPrefix();
  const names = Object.values(SSM_KEYS).map((suffix) => `${prefix}/${suffix}`);
  ssmClient ??= new SSMClient({ region: getRuntimeConfig().region });
  const result = await ssmClient.send(
    new GetParametersCommand({ Names: names, WithDecryption: true }),
  );
  const resolved: Record<string, string> = {};
  for (const param of result.Parameters ?? []) {
    if (param.Name && param.Value) {
      resolved[param.Name.slice(prefix.length + 1)] = param.Value;
    }
  }
  const missing = Object.values(SSM_KEYS).filter((suffix) => !resolved[suffix]);
  if (missing.length > 0) {
    throw new Error(
      `설정 누락: SSM 파라미터가 없습니다 — ${missing.map((m) => `${prefix}/${m}`).join(', ')}`,
    );
  }
  ssmCache = resolved;
  return resolved;
}

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * 인증 설정 조회. 환경변수가 모두 있으면 SSM 을 건드리지 않는다(로컬·테스트 경로).
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  const fromEnv = {
    googleClientId: optionalEnv('GOOGLE_CLIENT_ID'),
    googleClientSecret: optionalEnv('GOOGLE_CLIENT_SECRET'),
    jwtSecret: optionalEnv('EDITOR_JWT_SECRET'),
    allowlist: optionalEnv('EDITOR_ALLOWLIST'),
  };

  if (
    fromEnv.googleClientId &&
    fromEnv.googleClientSecret &&
    fromEnv.jwtSecret &&
    fromEnv.allowlist
  ) {
    return {
      googleClientId: fromEnv.googleClientId,
      googleClientSecret: fromEnv.googleClientSecret,
      jwtSecret: fromEnv.jwtSecret,
      allowlist: parseAllowlist(fromEnv.allowlist),
      sessionTtlSec: numberEnv('EDITOR_SESSION_TTL_SEC', 60 * 60 * 12),
    };
  }

  const ssm = await loadFromSsm();
  return {
    googleClientId: ssm[SSM_KEYS.googleClientId],
    googleClientSecret: ssm[SSM_KEYS.googleClientSecret],
    jwtSecret: ssm[SSM_KEYS.jwtSecret],
    allowlist: parseAllowlist(ssm[SSM_KEYS.allowlist]),
    sessionTtlSec: numberEnv('EDITOR_SESSION_TTL_SEC', 60 * 60 * 12),
  };
}

/** OAuth 리다이렉트 URI */
export function googleRedirectUri(baseUrl?: string): string {
  const base = baseUrl ?? requireEnv('APP_BASE_URL');
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`;
}

/**
 * 메타데이터(robots.txt·sitemap·OG)용 베이스 URL.
 *
 * 빌드 시점(정적 생성)에도 평가되므로 **필수 설정을 요구하지 않는다.**
 * 런타임 로직에서는 `getRuntimeConfig().appBaseUrl` 을 쓰고, 이 함수는 표기용으로만 쓴다.
 */
export function getPublicBaseUrl(): string {
  return (optionalEnv('APP_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
}
