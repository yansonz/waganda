/**
 * graph/nodes/mapSpeakers.ts — 화자 실명 매핑 (R5).
 *
 * 순수 계산은 `@app/domain/speaker` 의 `mapSpeakers` 가 담당한다. 이 노드는
 * Recording 에서 F0 트랙과 화자 구간을 꺼내 그 함수를 호출하고 결과를 저장할
 * 뿐이다. 화자분리 자체가 실패(구간이 1종류뿐이거나 비어있음)하면 도메인
 * 함수가 `mappingConfidence: 'none'` 을 반환하므로, 이 노드는 그 결과를
 * 그대로 저장한다 — 화자 의존 서술을 생성하지 않는 책임은 소믈리에 에이전트
 * (프롬프트)에 있다.
 */
import type { Repository } from '@app/db/repository';
import { mapSpeakers as mapSpeakersPure } from '@app/domain/speaker';
import type { PipelineContext } from '../pipeline.js';

export interface MapSpeakersDeps {
  repo: Repository;
  recordingId: string;
}

export function makeMapSpeakersNode(deps: MapSpeakersDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    // loadState 가 patchRecording 으로 rev 를 이미 올렸을 수 있으므로, ctx.data 의
    // 캐시된 객체(rev 가 오래되었을 수 있음)를 쓰지 않고 항상 저장소에서 최신 rev 를 다시 읽는다.
    const recording = await deps.repo.getRecording(ctx.tastingId, deps.recordingId);
    if (!recording) {
      throw new Error(`녹음 레코드를 찾을 수 없습니다: recordingId=${deps.recordingId}`);
    }

    const f0Track = recording.acoustic?.f0Track ?? [];
    const segments = recording.transcript?.segments
      .filter((s) => s.speaker !== undefined)
      .map((s) => ({ speaker: s.speaker!, start: s.start, end: s.end })) ?? [];

    const speakers = mapSpeakersPure(f0Track, segments);

    await deps.repo.patchRecording(ctx.tastingId, deps.recordingId, recording.rev, { speakers });

    ctx.data['speakers'] = speakers;
  };
}
