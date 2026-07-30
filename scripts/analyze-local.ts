/**
 * scripts/analyze-local.ts — 로컬 분석 파이프라인 CLI.
 *
 * 실제 파이프라인은 `lib/analysis/localPipeline.ts` 에 있고,
 * 녹음 저장 직후 자동 실행 경로(`POST /api/tastings/[id]/analyze`)와 같은 코드를 쓴다.
 *
 * 사용:
 *   npm run analyze:local -- <tastingId>
 *   npm run analyze:local -- <tastingId> --skip-transcribe   # 트랜스크립션 생략(비용 없음)
 *
 * 주의: 실제 AWS(Transcribe·Bedrock)를 호출하므로 소액 과금이 발생한다.
 */
import { readFileSync } from 'node:fs';

/** `.env.local` 을 직접 읽는다 (tsx 단독 실행에는 Next 의 env 로딩이 없다) */
function loadEnvLocal(): void {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1).trim();
    }
  } catch {
    // 없으면 그대로 진행 (환경변수로 주입한 경우)
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const tastingId = args.find((arg) => !arg.startsWith('--'));
  const skipTranscribe = args.includes('--skip-transcribe');

  if (!tastingId) {
    throw new Error('사용법: npm run analyze:local -- <tastingId> [--skip-transcribe]');
  }

  // env 로딩 후에 불러온다 (모듈이 초기화 시점에 설정을 읽는다)
  const { runLocalAnalysis } = await import('../lib/analysis/localPipeline');

  const result = await runLocalAnalysis(tastingId, { skipTranscribe });

  console.log('');
  console.log(`요약: ${result.summary.slice(0, 140)}${result.summary.length > 140 ? '…' : ''}`);
  console.log(`화자 매핑: ${result.mappingConfidence}`);
  console.log('');
  console.log(`확인: http://localhost:3000/tastings/${result.tastingId}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
