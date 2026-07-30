/**
 * graph/sessionA.ts — 세션 A(업로드 직후) 그래프 조립.
 * ensure_job → start_transcription → extract_acoustic. 모델 호출 없음.
 */
import type { PipelineGraphDefinition, PipelineNode } from './pipeline.js';
import { makeEnsureJobNode } from './nodes/ensureJob.js';
import { makeStartTranscriptionNode, type StartTranscriptionDeps } from './nodes/startTranscription.js';
import { makeExtractAcousticNode, type ExtractAcousticDeps } from './nodes/extractAcoustic.js';
import type { EnsureJobDeps } from './nodes/ensureJob.js';

export interface SessionADeps {
  ensureJob: EnsureJobDeps;
  startTranscription: StartTranscriptionDeps;
  extractAcoustic: ExtractAcousticDeps;
}

export function buildSessionAGraph(deps: SessionADeps): PipelineGraphDefinition {
  const nodes: PipelineNode[] = [
    { name: 'ensure_job', run: makeEnsureJobNode(deps.ensureJob) },
    { name: 'start_transcription', run: makeStartTranscriptionNode(deps.startTranscription) },
    { name: 'extract_acoustic', run: makeExtractAcousticNode(deps.extractAcoustic) },
  ];

  return {
    nodes,
    edges: [
      { from: 'ensure_job', to: 'start_transcription' },
      { from: 'start_transcription', to: 'extract_acoustic' },
    ],
    sources: ['ensure_job'],
  };
}
