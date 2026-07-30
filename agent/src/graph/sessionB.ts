/**
 * graph/sessionB.ts — 세션 B(Transcribe 완료 후) 그래프 조립.
 * load_state → map_speakers → sommelier_analysis → (조건부) refresh_taste_profile
 * → (조건부) run_discovery → persist_and_publish.
 */
import type { PipelineGraphDefinition, PipelineNode } from './pipeline.js';
import { makeLoadStateNode, type LoadStateDeps } from './nodes/loadState.js';
import { makeMapSpeakersNode, type MapSpeakersDeps } from './nodes/mapSpeakers.js';
import { makeSommelierAnalysisNode, type SommelierAnalysisDeps } from './nodes/sommelierAnalysis.js';
import {
  makeRefreshProfileNode,
  makeRefreshProfileShouldRun,
  type RefreshProfileDeps,
} from './nodes/refreshProfile.js';
import {
  makeRunDiscoveryNode,
  makeRunDiscoveryShouldRun,
  type RunDiscoveryDeps,
} from './nodes/runDiscovery.js';
import { makePersistAndPublishNode, type PersistAndPublishDeps } from './nodes/persistAndPublish.js';

export interface SessionBDeps {
  loadState: LoadStateDeps;
  mapSpeakers: MapSpeakersDeps;
  sommelierAnalysis: SommelierAnalysisDeps;
  refreshProfile: RefreshProfileDeps;
  runDiscovery: RunDiscoveryDeps;
  persistAndPublish: PersistAndPublishDeps;
}

export function buildSessionBGraph(deps: SessionBDeps): PipelineGraphDefinition {
  const nodes: PipelineNode[] = [
    { name: 'load_state', run: makeLoadStateNode(deps.loadState) },
    { name: 'map_speakers', run: makeMapSpeakersNode(deps.mapSpeakers) },
    { name: 'sommelier_analysis', run: makeSommelierAnalysisNode(deps.sommelierAnalysis) },
    {
      name: 'refresh_taste_profile',
      shouldRun: makeRefreshProfileShouldRun(deps.refreshProfile),
      run: makeRefreshProfileNode(deps.refreshProfile),
    },
    {
      name: 'run_discovery',
      shouldRun: makeRunDiscoveryShouldRun(deps.runDiscovery),
      run: makeRunDiscoveryNode(deps.runDiscovery),
    },
    { name: 'persist_and_publish', run: makePersistAndPublishNode(deps.persistAndPublish) },
  ];

  return {
    nodes,
    edges: [
      { from: 'load_state', to: 'map_speakers' },
      { from: 'map_speakers', to: 'sommelier_analysis' },
      { from: 'sommelier_analysis', to: 'refresh_taste_profile' },
      { from: 'refresh_taste_profile', to: 'run_discovery' },
      { from: 'run_discovery', to: 'persist_and_publish' },
    ],
    sources: ['load_state'],
  };
}
