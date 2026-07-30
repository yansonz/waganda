/**
 * graph/nodes/extractAcoustic.ts — 오디오 Lambda 호출 및 음향 특징 저장 (세션 A).
 *
 * 이미 `Recording.acoustic` 이 있으면 Lambda 를 재호출하지 않고 건너뛴다
 * (design.md '화자 매핑' — "오디오 Lambda를 재호출하지 않는다"는 세션 B 의
 * 전제이며, 세션 A 안에서도 재시도 시 중복 호출을 막기 위해 동일하게 적용한다).
 */
import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { Acoustic } from '@waganda/schemas';
import type { Repository } from '@app/db/repository';
import type { PipelineContext } from '../pipeline.js';

export interface ExtractAcousticDeps {
  repo: Repository;
  lambdaClient: LambdaClient;
  /** 오디오 특징 추출 Lambda 함수명/ARN */
  audioLambdaFunctionName: string;
  recordingId: string;
  audioKey: string;
}

/** 오디오 Lambda 를 호출해 음향 특징을 추출하고 Recording 에 저장한다. 이미 있으면 건너뜀 */
export function makeExtractAcousticNode(deps: ExtractAcousticDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    const existing = await deps.repo.getRecording(ctx.tastingId, deps.recordingId);
    if (existing?.acoustic) {
      ctx.data['acoustic'] = existing.acoustic;
      return;
    }

    const response = await deps.lambdaClient.send(
      new InvokeCommand({
        FunctionName: deps.audioLambdaFunctionName,
        Payload: new TextEncoder().encode(JSON.stringify({ audioKey: deps.audioKey })),
      }),
    );

    if (!response.Payload) {
      throw new Error('오디오 분석 Lambda 응답이 비어 있습니다.');
    }

    const raw = JSON.parse(new TextDecoder().decode(response.Payload));
    const acoustic = Acoustic.parse(raw);

    if (existing) {
      await deps.repo.patchRecording(ctx.tastingId, deps.recordingId, existing.rev, { acoustic });
    }

    ctx.data['acoustic'] = acoustic;
  };
}
