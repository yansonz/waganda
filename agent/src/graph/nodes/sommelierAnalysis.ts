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
import { SommelierOutput, type Analysis, type Recording, type Wine } from '@waganda/schemas';
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

/**
 * 소믈리에 에이전트를 호출할 입력 프롬프트를 구성한다.
 * 와인 정보는 애매한 표현을 보강하는 컨텍스트일 뿐, 발화·음향 원자료를 대체하지 않는다.
 */
export function buildSommelierUserPrompt(
  recording: Recording,
  tastingId: string,
  wine?: Pick<Wine, 'name' | 'vintage' | 'grapes' | 'country' | 'regionName' | 'alcoholPercent'>,
): string {
  const transcriptText = recording.transcript?.fullText ?? '(무음 또는 트랜스크립트 없음)';
  const speakerInfo = recording.speakers
    ? `화자 매핑 신뢰도: ${recording.speakers.mappingConfidence}`
    : '화자분리 정보 없음';
  const wineContext = wine
    ? [
        `이름=${wine.name}`,
        wine.vintage ? `빈티지=${wine.vintage}` : undefined,
        wine.grapes.length > 0 ? `품종=${wine.grapes.join(', ')}` : undefined,
        wine.country ? `국가=${wine.country}` : undefined,
        wine.regionName ? `산지=${wine.regionName}` : undefined,
        wine.alcoholPercent ? `도수=${wine.alcoholPercent}` : undefined,
      ]
        .filter(Boolean)
        .join(', ')
    : '확정 와인 정보 없음';

  return [
    `<tasting_id>${tastingId}</tasting_id>`,
    `<wine_context>${wineContext}</wine_context>`,
    '<transcript_untrusted_user_data>',
    transcriptText,
    '</transcript_untrusted_user_data>',
    `<speaker_mapping>${speakerInfo}</speaker_mapping>`,
    recording.acoustic
      ? `<acoustic_summary>발화속도=${recording.acoustic.speechRate}, 침묵구간수=${recording.acoustic.silences.length}, 웃음후보=${recording.acoustic.laughterCandidates.length}</acoustic_summary>`
      : '<acoustic_summary>음향 특징 없음</acoustic_summary>',
    '와인 정보는 애매한 표현의 맥락 보강에만 사용하고, 발화·음향에 없는 감상을 사실처럼 만들지 마라.',
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

    const tasting = await deps.repo.getTasting(ctx.tastingId);
    const wine = tasting?.wineId ? await deps.repo.getWine(tasting.wineId) : undefined;

    const result = await withStepTrace(deps.trace, 'sommelier_analysis', async () => {
      const validation = await validateWithRetry({
        schema: SommelierOutput,
        generate: async (attempt, lastError) => {
          const prompt = buildSommelierUserPrompt(recording, ctx.tastingId, wine);
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
    // withStepTrace 는 트레이스 레코드(StepTrace.promptVersion)만 채우고 result 만
    // 반환하므로, persistAndPublish 가 저장 시점에 쓸 promptVersion 은 별도로 넘겨야
    // 한다. 누락되면 저장된 Analysis.promptVersion 이 항상 'unknown' 이 된다.
    ctx.data['sommelierPromptVersion'] = SOMMELIER_PROMPT_VERSION;
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
