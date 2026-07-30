/**
 * graph/nodes/sommelierAnalysis.ts — 소믈리에 에이전트(ReAct) 실행 노드.
 *
 * 이 노드만 모델을 호출한다 (Strands `Agent` 사용). 출력은
 * `lib/validate.ts` 의 `validateWithRetry` 로 검증하며, 최대 2회 재생성 후
 * 실패하면 이 노드가 예외를 던져 executor 가 그래프를 중단시킨다 — 원본
 * 오디오·트랜스크립트는 이미 저장되어 있으므로 별도 보존 조치가 필요 없다
 * (design.md '출력 스키마 검증').
 */
import type { Agent } from '@strands-agents/sdk';
import { SommelierOutput, type Analysis, type Recording } from '@waganda/schemas';
import type { Repository } from '@app/db/repository';
import { validateWithRetry } from '../../lib/validate.js';
import { SOMMELIER_PROMPT_VERSION } from '../../prompts/sommelier.js';
import type { PipelineContext } from '../pipeline.js';
import type { PipelineTrace } from '../../lib/trace.js';
import { withStepTrace } from '../../lib/trace.js';

export interface SommelierAnalysisDeps {
  repo: Repository;
  agent: Agent;
  modelId: string;
  trace: PipelineTrace;
  recordingId: string;
}

/** 소믈리에 에이전트를 호출할 입력 프롬프트를 구성한다. 사용자 데이터는 구분된 블록으로 전달한다 */
function buildUserPrompt(recording: Recording, tastingId: string): string {
  const transcriptText = recording.transcript?.fullText ?? '(무음 또는 트랜스크립트 없음)';
  const speakerInfo = recording.speakers
    ? `화자 매핑 신뢰도: ${recording.speakers.mappingConfidence}`
    : '화자분리 정보 없음';

  return [
    `<tasting_id>${tastingId}</tasting_id>`,
    '<transcript_untrusted_user_data>',
    transcriptText,
    '</transcript_untrusted_user_data>',
    `<speaker_mapping>${speakerInfo}</speaker_mapping>`,
    recording.acoustic
      ? `<acoustic_summary>발화속도=${recording.acoustic.speechRate}, 침묵구간수=${recording.acoustic.silences.length}, 웃음후보=${recording.acoustic.laughterCandidates.length}</acoustic_summary>`
      : '<acoustic_summary>음향 특징 없음</acoustic_summary>',
    '위 데이터를 근거로 시음 분석 결과를 요청된 JSON 스키마로 생성하라.',
  ].join('\n');
}

export function makeSommelierAnalysisNode(deps: SommelierAnalysisDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    // map_speakers 가 patchRecording 으로 speakers 를 갱신했으므로, ctx.data 의
    // 캐시본이 아니라 저장소에서 최신 recording(화자 매핑 결과 포함)을 다시 읽는다.
    const recording = await deps.repo.getRecording(ctx.tastingId, deps.recordingId);
    if (!recording) {
      throw new Error('sommelierAnalysis 노드 진입 전에 loadState 가 실행되어야 합니다.');
    }

    const result = await withStepTrace(deps.trace, 'sommelier_analysis', async () => {
      const validation = await validateWithRetry({
        schema: SommelierOutput,
        generate: async (attempt, lastError) => {
          const prompt = buildUserPrompt(recording, ctx.tastingId);
          const withRetryNote =
            attempt === 0
              ? prompt
              : `${prompt}\n\n(이전 시도가 스키마를 위반했습니다: ${lastError ?? '알 수 없는 오류'}. 반드시 스키마를 정확히 지켜 재생성하라.)`;
          const agentResult = await deps.agent.invoke(withRetryNote);
          return agentResult.structuredOutput ?? agentResult.lastMessage;
        },
      });

      if (!validation.ok || !validation.data) {
        throw new Error(
          `소믈리에 출력이 스키마를 반복 위반했습니다 (${validation.attempts}회 시도): ${validation.lastError ?? ''}`,
        );
      }

      return {
        result: validation.data,
        meta: { promptVersion: SOMMELIER_PROMPT_VERSION, modelId: deps.modelId },
      };
    });

    ctx.data['sommelierOutput'] = result;
  };
}

/** sommelierOutput 을 저장용 `Analysis` 레코드로 변환한다 (persistAndPublish 가 사용) */
export function toAnalysisRecord(
  tastingId: string,
  output: SommelierOutput,
  promptVersion: string,
  modelId: string,
  traceId: string,
): Analysis {
  const now = new Date().toISOString();
  return {
    type: 'ANALYSIS',
    tastingId,
    summary: output.summary,
    highlights: output.highlights,
    aiRating: output.aiRating,
    notes: output.notes,
    evidence: output.evidence,
    speakerContrast: output.speakerContrast,
    comparisonToPast: output.comparisonToPast,
    reactions: output.reactions,
    emotionTimeline: output.emotionTimeline,
    promptVersion,
    modelId,
    traceId,
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };
}
