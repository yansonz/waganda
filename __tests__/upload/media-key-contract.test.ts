// @vitest-environment node
/**
 * 미디어 키 프리픽스 계약 테스트.
 *
 * 앱은 이 프리픽스로 S3 에 객체를 올리고, 인프라는 같은 값으로 S3 이벤트 알림 필터를 건다.
 * 두 값이 어긋나면 **업로드 이벤트가 아예 발생하지 않아** 분석이 `queued` 에서 영구히 멈춘다.
 * 실제로 알림 필터가 `audio/` 로 걸려 있어 트리거 Lambda 가 한 번도 실행되지 않았고,
 * 그때 인프라 테스트는 `audio/` 를 단정하고 있어 결함을 통과시켰다.
 *
 * 워크스페이스가 달라(인프라는 NodeNext 해석) 인프라가 `@waganda/schemas` 를 직접
 * 임포트할 수 없으므로, 여기서 인프라 소스를 읽어 값이 일치하는지 확인한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA_KEY_PREFIX } from '@waganda/schemas';
import { buildAudioKey, buildLabelImageKey } from '@/lib/upload/presign';

const PIPELINE_STACK = join(process.cwd(), 'infrastructure/lib/pipeline-stack.ts');

describe('미디어 키 프리픽스 계약', () => {
  it('앱이 만드는 키가 계약 프리픽스로 시작한다', () => {
    const audioKey = buildAudioKey('01JQTEST0000000000000000000', 'rec-1', 'm4a');
    expect(audioKey.startsWith(MEDIA_KEY_PREFIX.recordings)).toBe(true);

    const labelKey = buildLabelImageKey('img-1', 'jpg');
    expect(labelKey.startsWith(MEDIA_KEY_PREFIX.labels)).toBe(true);
  });

  it('인프라의 S3 이벤트 알림 필터가 녹음 프리픽스와 일치한다', () => {
    const source = readFileSync(PIPELINE_STACK, 'utf8');

    // `addEventNotification(..., { prefix: '<값>' })` 의 값을 뽑는다.
    const match = source.match(/prefix:\s*'([^']+)'/);
    expect(match, '인프라에서 이벤트 알림 프리픽스를 찾지 못했다').not.toBeNull();

    const infraPrefix = match![1];
    expect(
      infraPrefix,
      `인프라 알림 필터(${infraPrefix})가 앱 키 규약(${MEDIA_KEY_PREFIX.recordings})과 다르다. ` +
        '어긋나면 업로드 이벤트가 발생하지 않아 분석이 queued 에서 멈춘다.',
    ).toBe(MEDIA_KEY_PREFIX.recordings);
  });

  it('라벨 프리픽스는 이벤트 알림 대상이 아니다', () => {
    // 라벨은 업로드 직후 동기 인식하므로 알림이 필요 없다.
    // 실수로 라벨 프리픽스를 알림에 걸면 인식이 두 번 돌아 모델 비용이 두 배가 된다.
    const source = readFileSync(PIPELINE_STACK, 'utf8');
    const prefixes = [...source.matchAll(/prefix:\s*'([^']+)'/g)].map((m) => m[1]);

    expect(prefixes).not.toContain(MEDIA_KEY_PREFIX.labels);
  });
});
