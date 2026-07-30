/**
 * lib/domain/region.ts — 지역 계층 트리 (R4, R9)
 *
 * 평면 목록(DynamoDB Scan 결과)을 국가 > 광역 > 세부 산지 계층 트리로 구성한다.
 * 저장 단계의 무결성 검증과 별개로, 읽기 시점에도 순환 참조·고아 노드를 방어해
 * 무한루프 없이 항상 트리를 반환한다.
 */
import type { Region, RegionTreeNode } from '@waganda/schemas';

/**
 * 평면 지역 목록으로부터 계층 트리를 구성한다.
 *
 * - 순환 참조가 감지되면 해당 노드는 자신을 루트로 승격시키고 경고를 로그로 남긴다.
 * - 존재하지 않는 parentId 를 참조하는 고아 노드도 루트로 승격한다.
 * - 무한루프를 만들지 않는다 — 순환 감지는 각 노드에서 조상 체인을 방문 집합으로 추적한다.
 */
export function buildRegionTree(regions: Region[]): RegionTreeNode[] {
  const byId = new Map(regions.map((r) => [r.id, r]));

  // 각 지역이 실제로 유효한 상위 경로를 갖는지(순환이 없는지) 미리 판정한다
  const isValidParentChain = new Map<string, boolean>();

  function checkChain(id: string, visiting: Set<string>): boolean {
    if (isValidParentChain.has(id)) return isValidParentChain.get(id)!;

    const region = byId.get(id);
    if (!region) return false;

    if (!region.parentId) {
      isValidParentChain.set(id, true);
      return true;
    }

    // 순환 감지 — 이미 방문 중인 체인에 다시 등장하면 순환이다
    if (visiting.has(id)) {
      console.warn(`[buildRegionTree] 순환 참조 감지: ${id} — 루트로 승격한다`);
      isValidParentChain.set(id, false);
      return false;
    }

    const parent = byId.get(region.parentId);
    if (!parent) {
      // 고아 노드 — 부모가 존재하지 않는다
      console.warn(
        `[buildRegionTree] 고아 노드 감지: ${id} (존재하지 않는 parentId=${region.parentId}) — 루트로 승격한다`,
      );
      isValidParentChain.set(id, false);
      return false;
    }

    visiting.add(id);
    const parentValid = checkChain(region.parentId, visiting);
    visiting.delete(id);

    isValidParentChain.set(id, parentValid);
    return parentValid;
  }

  for (const region of regions) {
    checkChain(region.id, new Set());
  }

  /** 유효한 parentId (순환/고아가 아닌 경우에만 부모로 인정) */
  function effectiveParentId(region: Region): string | undefined {
    if (!region.parentId) return undefined;
    if (!byId.has(region.parentId)) return undefined; // 고아 노드 → 루트 승격
    if (!isValidParentChain.get(region.id)) return undefined; // 순환 체인의 일부 → 루트 승격
    return region.parentId;
  }

  function pathFor(region: Region): string[] {
    const path: string[] = [region.name];
    let current = region;
    const visited = new Set<string>([region.id]);
    while (true) {
      const parentId = effectiveParentId(current);
      if (!parentId) break;
      const parent = byId.get(parentId);
      if (!parent || visited.has(parent.id)) break; // 안전망 — 이론상 도달하지 않지만 무한루프를 원천 차단
      visited.add(parent.id);
      path.unshift(parent.name);
      current = parent;
    }
    return path;
  }

  const nodeById = new Map<string, RegionTreeNode>();
  for (const region of regions) {
    nodeById.set(region.id, {
      id: region.id,
      name: region.name,
      level: region.level,
      country: region.country,
      path: pathFor(region),
      children: [],
    });
  }

  const roots: RegionTreeNode[] = [];
  for (const region of regions) {
    const node = nodeById.get(region.id)!;
    const parentId = effectiveParentId(region);
    if (parentId && nodeById.has(parentId)) {
      nodeById.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * 특정 지역 ID의 경로를 ['프랑스', '부르고뉴', '샤블리'] 형태로 반환한다.
 * 순환/고아가 있으면 유효한 조상까지만 경로에 포함한다 (무한루프 방지).
 * 존재하지 않는 id 는 빈 배열을 반환한다.
 */
export function regionPath(regions: Region[], id: string): string[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const target = byId.get(id);
  if (!target) return [];

  const path: string[] = [target.name];
  const visited = new Set<string>([target.id]);
  let current = target;

  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break; // 고아 — 여기서 경로를 끊는다
    if (visited.has(parent.id)) {
      console.warn(`[regionPath] 순환 참조 감지: ${parent.id} — 경로 계산을 중단한다`);
      break; // 순환 — 무한루프 방지
    }
    visited.add(parent.id);
    path.unshift(parent.name);
    current = parent;
  }

  return path;
}

/**
 * 화면에 표시할 산지 경로를 만든다 — ['프랑스', '보르도'] 형태.
 *
 * 카탈로그 지역 참조(`regionId`)가 있으면 그 계층 경로를 쓰고,
 * 없으면 라벨 인식·검색으로 얻은 자유 텍스트(`regionName`)를 대신 쓴다.
 * 국가는 항상 맨 앞에 두고, 같은 이름이 반복되면 한 번만 남긴다
 * (예: country='Australia', regionName='Australia' → ['Australia']).
 */
export function winePlaceParts(
  wine: { country?: string; regionName?: string },
  regionPathFromCatalog: string[],
): string[] {
  const tail = regionPathFromCatalog.length > 0 ? regionPathFromCatalog : [wine.regionName];
  const parts = [wine.country, ...tail].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return [...new Set(parts)];
}
