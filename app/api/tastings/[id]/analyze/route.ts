import { NextResponse, type NextRequest } from 'next/server';
import { AnalyzeResponse, CURRENT_SCHEMA_VERSION, type Job } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse } from '@/lib/api/errors';
import { DynamoDbRepository, requireFound } from '@/lib/db/repository';
import { getRuntimeConfig } from '@/lib/config';
import { invokeAgentRuntime } from '@/lib/agent/client';

/**
 * POST /api/tastings/[id]/analyze — 재분석 트리거 (10.7).
 *
 * 편집자 가드 필수 — 이 엔드포인트는 AgentCore 호출(Bedrock 비용)을 유발하므로
 * 공개 접근을 허용하면 비용 사고로 직결된다 (design.md 'API 계약').
 *
 * 작업(Job) 레코드가 없으면 새로 만들어 큐에 올리고, 있으면 재분석을 위해
 * 상태를 초기화한다. 실제 파이프라인 실행은 AgentCore Runtime(세션 A)에 위임한다.
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const segments = request.nextUrl.pathname.split('/');
  const tastingId = segments.at(-2)!;

  const repo = new DynamoDbRepository();

  try {
    requireFound(await repo.getTasting(tastingId), '분석할 시음 세션을 찾을 수 없습니다.');

    /*
     * 실행 수단을 먼저 확인한다 — 돌릴 수 없는 작업을 큐에 남기면
     * 화면에 "분석 중" 으로 영원히 표시된다.
     */
    const config = getRuntimeConfig();
    const canRunLocally = process.env.WAGANDA_LOCAL_PIPELINE === '1';
    if (!config.agentRuntimeArn && !canRunLocally) {
      return NextResponse.json(
        {
          error: 'ANALYSIS_PIPELINE_UNAVAILABLE',
          message:
            '분석 파이프라인이 설정되지 않았습니다. (WAGANDA_AGENT_RUNTIME_ARN 미설정, 로컬에서는 WAGANDA_LOCAL_PIPELINE=1 사용)',
        },
        { status: 503 },
      );
    }

    const existingJob = await repo.getJob(tastingId);
    const now = new Date().toISOString();

    let job: Job;
    if (existingJob) {
      job = await repo.patchJob(tastingId, existingJob.rev, {
        status: 'queued',
        completedSteps: [],
        attempts: existingJob.attempts + 1,
        lastError: undefined,
      });
    } else {
      job = {
        type: 'JOB',
        tastingId,
        status: 'queued',
        completedSteps: [],
        attempts: 1,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };
      await repo.putJob(job);
    }

    await triggerAnalysis(tastingId);

    const response = AnalyzeResponse.parse({
      jobStatus: job.status,
      tastingId,
      completedSteps: job.completedSteps,
    });

    return NextResponse.json(response);
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});

/**
 * 분석 실행을 시작한다.
 *
 * - 배포 환경: AgentCore Runtime(세션 A)에 위임한다.
 * - 로컬(`WAGANDA_LOCAL_PIPELINE=1`): 같은 프로세스에서 파이프라인을 **백그라운드로** 실행한다.
 *   Transcribe 대기까지 1분 가까이 걸리므로 HTTP 응답을 붙잡지 않는다.
 *   진행 상태는 Job 레코드에 남고 상세 화면이 폴링해 보여준다.
 */
async function triggerAnalysis(tastingId: string): Promise<void> {
  const config = getRuntimeConfig();

  if (config.agentRuntimeArn) {
    await invokeAgentRuntime(tastingId, {
      task: 'analyze_transcribed',
      tastingId,
      transcribeStatus: 'COMPLETED',
    });
    return;
  }

  // 백그라운드 실행 — 실패는 Job 레코드와 로그에 남는다
  void (async () => {
    try {
      const { runLocalAnalysis } = await import('@/lib/analysis/localPipeline');
      const result = await runLocalAnalysis(tastingId, {
        log: (message) => console.log(`[analyze:${tastingId.slice(0, 8)}] ${message}`),
      });
      console.log(
        `[analyze:${tastingId.slice(0, 8)}] 완료 — 평점 ${result.aiRating ?? '-'}, 화자 매핑 ${result.mappingConfidence}`,
      );
    } catch (error) {
      console.error(
        `[analyze:${tastingId.slice(0, 8)}] 실패 — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
}
