/**
 * 로컬 전용 편집자 세션 발급 스크립트.
 *
 * 로컬에서는 Google OAuth 자격증명이 더미라 실제 로그인을 끝까지 진행할 수 없다.
 * 이 스크립트는 `.env.local` 의 `EDITOR_JWT_SECRET` 으로 앱과 **동일한 형식**의
 * 세션 JWT(HS256, `{ email }`)를 서명해 출력한다.
 *
 * 보안:
 * - `WAGANDA_ENV` 가 dev/prod 면 **실행을 거부**한다. 배포 환경용 도구가 아니다.
 * - 서명 키가 있어야만 동작한다. 운영 키는 SSM SecureString 에만 있으므로
 *   이 스크립트로 운영 세션을 만들 수는 없다.
 * - HTTP 엔드포인트가 아니라 CLI 다. 앱에 인증 우회 경로를 만들지 않는다.
 *
 * 사용:
 *   npm run dev:login                 # 허용 목록의 첫 번째 이메일로 발급
 *   npm run dev:login -- yan@x.com    # 특정 이메일로 발급
 */
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { COOKIE_NAME } from '../lib/auth/session';

/** `.env.local` 을 직접 파싱한다 (tsx 단독 실행에는 Next 의 env 로딩이 없다) */
function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const fileEnv = loadEnvLocal();
  const env = { ...fileEnv, ...process.env };

  const appEnv = env.WAGANDA_ENV ?? 'local';
  if (appEnv !== 'local' && appEnv !== 'test') {
    throw new Error(
      `이 스크립트는 로컬 전용입니다. 현재 WAGANDA_ENV=${appEnv} — dev/prod 에서는 실행할 수 없습니다.`,
    );
  }

  const secret = env.EDITOR_JWT_SECRET;
  if (!secret) {
    throw new Error('EDITOR_JWT_SECRET 이 없습니다. .env.local 을 확인하세요.');
  }

  const allowlist = (env.EDITOR_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const requested = process.argv[2]?.trim().toLowerCase();
  const email = requested ?? allowlist[0];

  if (!email) {
    throw new Error('발급할 이메일이 없습니다. EDITOR_ALLOWLIST 를 설정하거나 인자로 넘기세요.');
  }
  if (!allowlist.includes(email)) {
    // 허용 목록은 매 요청 재검증되므로, 목록에 없는 이메일로 만든 토큰은 곧바로 무효 처리된다.
    throw new Error(
      `${email} 은 EDITOR_ALLOWLIST 에 없습니다. 토큰을 만들어도 앱이 매 요청 재검증에서 거부합니다.\n` +
        `허용 목록: ${allowlist.join(', ') || '(비어 있음)'}`,
    );
  }

  const ttlSec = Number(env.EDITOR_SESSION_TTL_SEC ?? 60 * 60 * 12);
  const baseUrl = env.APP_BASE_URL ?? 'http://localhost:3000';

  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(new TextEncoder().encode(secret));

  const cookie = `${COOKIE_NAME}=${token}`;

  console.log(`\n편집자 세션 발급 완료 — ${email} (유효 ${Math.round(ttlSec / 3600)}시간)\n`);
  console.log('① 브라우저: 개발자도구 콘솔에 붙여넣기');
  console.log(`document.cookie = '${cookie}; path=/; SameSite=Lax';\n`);
  console.log('② curl: 헤더로 전달');
  console.log(`curl -X POST ${baseUrl}/api/wines \\`);
  console.log(`  -H 'content-type: application/json' \\`);
  console.log(`  -H 'origin: ${baseUrl}' \\`);
  console.log(`  -H 'cookie: ${cookie}' \\`);
  console.log(`  -d '{"name":"테스트 와인"}'\n`);
  console.log('③ 토큰만 필요할 때');
  console.log(`${token}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
