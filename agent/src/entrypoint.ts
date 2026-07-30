/**
 * entrypoint.ts — AgentCore Runtime 규격 서버.
 * `POST /invocations`, `GET /ping` 을 8080 포트에서 서빙한다.
 *
 * `AgentInvocation` 스키마(@waganda/schemas)로 요청을 검증하고 `task` 로 분기한다:
 *   - analyze_upload      → 세션 A (ensure_job → start_transcription → extract_acoustic)
 *   - analyze_transcribed → 세션 B (load_state → ... → persist_and_publish)
 *   - analyze_label       → 라벨 인식 에이전트 동기 호출
 *
 * 예외는 500 + 한국어 사유로 응답한다. AWS 실호출은 이 파일에서 직접 하지 않고
 * `lib/clients.ts` 가 제공하는 lazy singleton 을 통해서만 접근한다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { AgentInvocation, type AgentInvocationResult } from '@waganda/schemas';
import { DynamoDbRepository } from '@app/db/repository';
import {
  getCloudFrontClient,
  getDynamoDocClient,
  getLambdaClient,
  getS3Client,
  getTranscribeClient,
} from './lib/clients.js';
import { checkAndReserveBudget, type BudgetCounters } from './lib/budget.js';
import { startTrace } from './lib/trace.js';
import { buildRuntimeSessionId } from './lib/session.js';
import { buildSessionAGraph } from './graph/sessionA.js';
import { buildSessionBGraph } from './graph/sessionB.js';
import { executePipeline } from './graph/executor.js';
import { isAlreadyBeyondQueued } from './graph/nodes/ensureJob.js';
import { createSommelierAgent } from './agents/sommelier.js';
import { createTasteProfileAgent } from './agents/tasteProfile.js';
import { createDiscoveryAgent } from './agents/discovery.js';
import { createLabelAgent } from './agents/label.js';
import { resolveSearchProvider } from '@app/search/serpapi';
import type { StatsInputTasting } from '@app/domain/types';
import { deriveHourBucket, deriveWeekday } from '@app/domain/types';

const PORT = Number(process.env['PORT'] ?? 8080);
const ENV = process.env['WAGANDA_ENV'] ?? 'dev';
const MEDIA_BUCKET = process.env['MEDIA_BUCKET'] ?? '';
const AUDIO_LAMBDA_FUNCTION_NAME = process.env['AUDIO_LAMBDA_FUNCTION_NAME'] ?? '';
const CLOUDFRONT_DISTRIBUTION_ID = process.env['CLOUDFRONT_DISTRIBUTION_ID'] ?? '';
/** 추론 프로파일 ARN — 모델 ID 대신 이 값을 호출해 비용을 Project 태그로 귀속시킨다 (design.md) */
const MODEL_INFERENCE_PROFILE_ARN = process.env['MODEL_INFERENCE_PROFILE_ARN'] ?? '';
const DAILY_RUN_LIMIT = Number(process.env['DAILY_RUN_LIMIT'] ?? 50);
const MONTHLY_BUDGET_USD = Number(process.env['MONTHLY_BUDGET_USD'] ?? 10);

/** 예산 카운터의 임시 구현 — 실서비스에서는 DynamoDB 조건부 증가로 교체한다.
 *  이 모듈 스코프 변수는 프로세스 수명 동안만 유지되며, 테스트에서는 별도 스텁을 주입한다. */
function createInMemoryBudgetCounters(): BudgetCounters {
  const daily = new Map<string, number>();
  const monthly = new Map<string, number>();
  return {
    async getDailyRunCount(dateKey) {
      return daily.get(dateKey) ?? 0;
    },
    async incrementDailyRunCount(dateKey) {
      daily.set(dateKey, (daily.get(dateKey) ?? 0) + 1);
    },
    async getMonthlyModelCostUsd(monthKey) {
      return monthly.get(monthKey) ?? 0;
    },
    async addMonthlyModelCostUsd(monthKey, delta) {
      monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + delta);
    },
  };
}

const budgetCounters = createInMemoryBudgetCounters();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function buildModel(): BedrockModel {
  if (!MODEL_INFERENCE_PROFILE_ARN) {
    throw new Error('MODEL_INFERENCE_PROFILE_ARN 환경변수가 설정되지 않았습니다.');
  }
  return new BedrockModel({ modelId: MODEL_INFERENCE_PROFILE_ARN });
}

/** StatsInputTasting[] 을 전량 Scan 으로 구성한다 — tools/stats.ts 와 동일한 평탄화 규칙 */
async function loadCompletedTastings(repo: DynamoDbRepository): Promise<StatsInputTasting[]> {
  const { items } = await repo.scanAll<Record<string, unknown>>();
  const tastings = items.filter((i) => i['type'] === 'TASTING');
  const wines = new Map(items.filter((i) => i['type'] === 'WINE').map((w) => [String(w['id']), w]));
  const analyses = new Map(
    items.filter((i) => i['type'] === 'ANALYSIS').map((a) => [String(a['tastingId']), a]),
  );

  return tastings.map((t) => {
    const tId = String(t['id']);
    const wine = wines.get(String(t['wineId']));
    const analysis = analyses.get(tId);
    const tastedAt = String(t['tastedAt']);
    return {
      tastingId: tId,
      tastedAt,
      manualRating: t['manualRating'] as number | undefined,
      aiRating: analysis?.['aiRating'] as number | undefined,
      notes: analysis?.['notes'] as StatsInputTasting['notes'],
      grapes: (wine?.['grapes'] as string[] | undefined) ?? [],
      country: wine?.['country'] as string | undefined,
      regionId: wine?.['regionId'] as string | undefined,
      priceBand: t['priceBand'] as StatsInputTasting['priceBand'],
      vintage: wine?.['vintage'] as number | undefined,
      labelTags: (wine?.['labelTags'] as StatsInputTasting['labelTags']) ?? [],
      bottleShape: wine?.['bottleShape'] as StatsInputTasting['bottleShape'],
      closure: wine?.['closure'] as StatsInputTasting['closure'],
      weekday: deriveWeekday(tastedAt),
      hourBucket: deriveHourBucket(tastedAt),
      agreementScore: analysis?.['agreementScore'] as number | undefined,
    };
  });
}

async function handleAnalyzeUpload(
  input: Extract<AgentInvocation, { task: 'analyze_upload' }>,
): Promise<AgentInvocationResult> {
  const repo = new DynamoDbRepository(getDynamoDocClient());
  const trace = startTrace('analyze_upload', input.tastingId);
  buildRuntimeSessionId(input.tastingId, ENV); // 세션 ID 규칙 검증(길이 33자 이상)만 이 시점에 수행

  const existingJob = await repo.getJob(input.tastingId);
  if (existingJob && isAlreadyBeyondQueued(existingJob)) {
    return {
      ok: true,
      task: input.task,
      tastingId: input.tastingId,
      completedSteps: existingJob.completedSteps,
      skippedSteps: ['ensure_job'],
      traceId: trace.traceId,
    };
  }

  const graph = buildSessionAGraph({
    ensureJob: { repo, recordingId: input.recordingId },
    startTranscription: {
      repo,
      transcribeClient: getTranscribeClient(),
      mediaBucket: MEDIA_BUCKET,
      audioKey: input.audioKey,
      recordingId: input.recordingId,
    },
    extractAcoustic: {
      repo,
      lambdaClient: getLambdaClient(),
      audioLambdaFunctionName: AUDIO_LAMBDA_FUNCTION_NAME,
      recordingId: input.recordingId,
      audioKey: input.audioKey,
    },
  });

  const job = existingJob ?? { completedSteps: [] };
  const { ctx, ok } = await executePipeline(graph, input.tastingId, {
    completedSteps: job.completedSteps,
  });

  // 그래프 노드 자체는 Job.completedSteps 를 갱신하지 않는다(각 노드는 자신의
  // 도메인 레코드만 쓴다). 그래프 실행이 끝난 시점에 여기서 한 번에 병합해
  // 저장한다 — 다음 재시도가 이 값을 기준으로 스킵을 판정한다.
  const jobAfter = await repo.getJob(input.tastingId);
  if (jobAfter && ctx.newlyCompletedSteps.length > 0) {
    const merged = [...new Set([...jobAfter.completedSteps, ...ctx.newlyCompletedSteps])];
    await repo.patchJob(input.tastingId, jobAfter.rev, { completedSteps: merged });
  }

  return {
    ok,
    task: input.task,
    tastingId: input.tastingId,
    completedSteps: ctx.newlyCompletedSteps,
    skippedSteps: ctx.skippedSteps,
    error: ctx.error,
    traceId: trace.traceId,
  };
}

async function handleAnalyzeTranscribed(
  input: Extract<AgentInvocation, { task: 'analyze_transcribed' }>,
): Promise<AgentInvocationResult> {
  const repo = new DynamoDbRepository(getDynamoDocClient());
  const trace = startTrace('analyze_transcribed', input.tastingId);
  buildRuntimeSessionId(input.tastingId, ENV);

  const existingJob = await repo.getJob(input.tastingId);
  if (existingJob?.status === 'completed') {
    // 세션 B 중복 호출 — 이미 완료된 작업이면 결과를 재생성하지 않는다 (결과 중복 방지)
    return {
      ok: true,
      task: input.task,
      tastingId: input.tastingId,
      completedSteps: existingJob.completedSteps,
      skippedSteps: ['load_state', 'map_speakers', 'sommelier_analysis', 'persist_and_publish'],
      traceId: trace.traceId,
    };
  }

  const model = buildModel();
  const recordingId = input.recordingId ?? existingJob?.recordingId;
  if (!recordingId) {
    throw new Error('recordingId 를 확인할 수 없습니다 (요청과 작업 레코드 모두 결측).');
  }

  const sommelierAgent = createSommelierAgent({ model, repo });
  const tasteProfileAgent = createTasteProfileAgent({ model, repo });
  const discoveryAgent = createDiscoveryAgent({ model, repo });

  const graph = buildSessionBGraph({
    loadState: {
      repo,
      transcribeClient: getTranscribeClient(),
      s3Client: getS3Client(),
      mediaBucket: MEDIA_BUCKET,
      recordingId,
      transcribeStatus: input.transcribeStatus,
    },
    mapSpeakers: { repo, recordingId },
    sommelierAnalysis: {
      repo,
      agent: sommelierAgent,
      modelId: MODEL_INFERENCE_PROFILE_ARN,
      trace,
      recordingId,
    },
    refreshProfile: {
      repo,
      agent: tasteProfileAgent,
      modelId: MODEL_INFERENCE_PROFILE_ARN,
      loadCompletedTastings: () => loadCompletedTastings(repo),
    },
    runDiscovery: {
      repo,
      agent: discoveryAgent,
      modelId: MODEL_INFERENCE_PROFILE_ARN,
      completedTastingCount: async () => (await loadCompletedTastings(repo)).length,
      lastDiscoveryRunCount: async () => {
        const { items } = await repo.listByType<{ n: number }>('DISCOVERY', 'desc');
        return items.length > 0 ? Math.max(...items.map((d) => d.n)) : 0;
      },
    },
    persistAndPublish: {
      repo,
      cloudFrontClient: getCloudFrontClient(),
      cloudFrontDistributionId: CLOUDFRONT_DISTRIBUTION_ID,
      modelId: MODEL_INFERENCE_PROFILE_ARN,
      traceId: trace.traceId,
    },
  });

  const completedSteps = existingJob?.completedSteps ?? [];
  const { ctx, ok } = await executePipeline(graph, input.tastingId, { completedSteps });

  const jobAfter = await repo.getJob(input.tastingId);
  if (jobAfter && ctx.newlyCompletedSteps.length > 0) {
    const merged = [...new Set([...jobAfter.completedSteps, ...ctx.newlyCompletedSteps])];
    await repo.patchJob(input.tastingId, jobAfter.rev, { completedSteps: merged });
  }

  return {
    ok,
    task: input.task,
    tastingId: input.tastingId,
    completedSteps: ctx.newlyCompletedSteps,
    skippedSteps: ctx.skippedSteps,
    error: ctx.error,
    traceId: trace.traceId,
  };
}

async function handleAnalyzeLabel(
  input: Extract<AgentInvocation, { task: 'analyze_label' }>,
): Promise<AgentInvocationResult> {
  const repo = new DynamoDbRepository(getDynamoDocClient());
  const trace = startTrace('analyze_label');
  const model = buildModel();
  // 라벨 보강용 웹 검색 — 키가 없으면 undefined 이고 도구는 빈 결과를 돌려준다
  // (환경변수 SERPAPI_KEY → SSM `/waganda/<env>/search/serpapi-key` 순서로 해석한다)
  const agent = createLabelAgent({
    model,
    repo,
    webSearchProvider: await resolveSearchProvider(),
  });

  const agentResult = await agent.invoke(
    `<label_image_key_untrusted>${input.imageKey}</label_image_key_untrusted>${input.hint ? `\n<hint_untrusted>${input.hint}</hint_untrusted>` : ''}`,
  );

  const label = agentResult.structuredOutput;

  return {
    ok: true,
    task: input.task,
    label: label as AgentInvocationResult['label'],
    completedSteps: [],
    skippedSteps: [],
    traceId: trace.traceId,
  };
}

async function handleInvocation(rawBody: string): Promise<AgentInvocationResult> {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new Error('요청 본문이 올바른 JSON 형식이 아닙니다.');
  }

  const validation = AgentInvocation.safeParse(parsedBody);
  if (!validation.success) {
    const reason = validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`요청 스키마 검증에 실패했습니다: ${reason}`);
  }

  const decision = await checkAndReserveBudget({
    counters: budgetCounters,
    dailyRunLimit: DAILY_RUN_LIMIT,
    monthlyBudgetUsd: MONTHLY_BUDGET_USD,
  });
  if (decision.verdict === 'blocked') {
    throw new Error(decision.reason ?? '예산 상한으로 실행이 차단되었습니다.');
  }

  const input = validation.data;
  switch (input.task) {
    case 'analyze_upload':
      return handleAnalyzeUpload(input);
    case 'analyze_transcribed':
      return handleAnalyzeTranscribed(input);
    case 'analyze_label':
      return handleAnalyzeLabel(input);
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    sendJson(res, 200, { status: 'healthy' });
    return;
  }

  if (req.method === 'POST' && req.url === '/invocations') {
    readBody(req)
      .then(async (body) => {
        try {
          const result = await handleInvocation(body);
          sendJson(res, 200, result);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { ok: false, error: reason });
        }
      })
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { ok: false, error: reason });
      });
    return;
  }

  sendJson(res, 404, { error: '지원하지 않는 경로입니다.' });
});

/** 테스트에서 재사용할 수 있도록 export 한다 (실제 서버 기동 없이 handleInvocation 만 검증) */
export { handleInvocation, server };

if (process.env['NODE_ENV'] !== 'test') {
  server.listen(PORT, () => {
     
    console.log(`waganda agent listening on :${PORT}`);
  });
}
