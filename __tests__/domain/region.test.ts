/**
 * lib/domain/region.ts 테스트 — 계층 트리 구성, 순환 참조/고아 노드 방어
 */
import { describe, expect, it } from 'vitest';
import type { Region } from '@waganda/schemas';
import { buildRegionTree, regionPath } from '@/lib/domain/region';

function makeRegion(overrides: Partial<Region> & { id: string; name: string }): Region {
  return {
    type: 'REGION',
    nameNormalized: overrides.name.toLowerCase(),
    level: 'country',
    schemaVersion: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    rev: 0,
    ...overrides,
  };
}

describe('buildRegionTree', () => {
  it('빈 목록이면 빈 트리', () => {
    expect(buildRegionTree([])).toEqual([]);
  });

  it('정상적인 3단계 계층 구조를 구성한다', () => {
    const regions = [
      makeRegion({ id: 'fr', name: '프랑스', level: 'country' }),
      makeRegion({ id: 'burgundy', name: '부르고뉴', level: 'region', parentId: 'fr' }),
      makeRegion({ id: 'chablis', name: '샤블리', level: 'subregion', parentId: 'burgundy' }),
    ];
    const tree = buildRegionTree(regions);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('프랑스');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('부르고뉴');
    expect(tree[0].children[0].children[0].name).toBe('샤블리');
    expect(tree[0].children[0].children[0].path).toEqual(['프랑스', '부르고뉴', '샤블리']);
  });

  it('고아 노드(존재하지 않는 parentId)는 루트로 승격된다', () => {
    const regions = [
      makeRegion({ id: 'orphan', name: '고아지역', level: 'region', parentId: 'nonexistent' }),
    ];
    const tree = buildRegionTree(regions);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('orphan');
    expect(tree[0].path).toEqual(['고아지역']);
  });

  it('순환 참조가 있으면 무한루프 없이 루트로 승격된다', () => {
    // a -> b -> a 순환
    const regions = [
      makeRegion({ id: 'a', name: 'A', level: 'region', parentId: 'b' }),
      makeRegion({ id: 'b', name: 'B', level: 'region', parentId: 'a' }),
    ];

    // 무한루프 없이 즉시 반환되어야 한다
    const tree = buildRegionTree(regions);

    // 순환에 포함된 노드들은 모두 루트로 승격된다 (트리 최상위에 나타남)
    const allNodeIds = new Set<string>();
    function collect(nodes: typeof tree) {
      for (const n of nodes) {
        allNodeIds.add(n.id);
        collect(n.children);
      }
    }
    collect(tree);
    expect(allNodeIds).toEqual(new Set(['a', 'b']));
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('자기 자신을 부모로 참조하는 노드는 순환으로 감지되어 루트로 승격된다', () => {
    const regions = [makeRegion({ id: 'self', name: 'Self', level: 'region', parentId: 'self' })];
    const tree = buildRegionTree(regions);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('self');
  });

  it('단일 그룹(지역 1개)도 정상 처리된다', () => {
    const regions = [makeRegion({ id: 'only', name: '단독지역', level: 'country' })];
    const tree = buildRegionTree(regions);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toEqual(['단독지역']);
  });
});

describe('regionPath', () => {
  const regions = [
    makeRegion({ id: 'fr', name: '프랑스', level: 'country' }),
    makeRegion({ id: 'burgundy', name: '부르고뉴', level: 'region', parentId: 'fr' }),
    makeRegion({ id: 'chablis', name: '샤블리', level: 'subregion', parentId: 'burgundy' }),
  ];

  it('세부 산지 id 로 전체 경로를 반환한다', () => {
    expect(regionPath(regions, 'chablis')).toEqual(['프랑스', '부르고뉴', '샤블리']);
  });

  it('국가 id 는 경로가 자기 자신 하나뿐이다', () => {
    expect(regionPath(regions, 'fr')).toEqual(['프랑스']);
  });

  it('존재하지 않는 id 는 빈 배열', () => {
    expect(regionPath(regions, 'nonexistent')).toEqual([]);
  });

  it('순환 참조가 있으면 무한루프 없이 유효한 조상까지만 경로를 반환한다', () => {
    const cyclic = [
      makeRegion({ id: 'a', name: 'A', level: 'region', parentId: 'b' }),
      makeRegion({ id: 'b', name: 'B', level: 'region', parentId: 'a' }),
    ];
    const path = regionPath(cyclic, 'a');
    // 무한루프 없이 반환되며, 순환이 감지된 지점에서 경로가 끊긴다.
    // a -> b(부모로 편입) -> a(순환 감지, 중단) 이므로 ['B', 'A'] 형태가 된다.
    expect(path.length).toBeLessThanOrEqual(2);
    expect(path).toContain('A');
  });
});
