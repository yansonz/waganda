'use client';

import type { ReactElement } from 'react';
import { EditorOnly } from '@/components/auth/EditorSession';
import { EditActionButton } from '@/components/common/EditActionButton';

/**
 * components/tasting/TastingEditControls.tsx — 시음 상세 편집·삭제 컨트롤 (14.7, R1/R9).
 *
 * 세션 유무와 무관하게 항상 렌더링하고, 클릭 시 401 이면 로그인 흐름으로 전환한다.
 * 삭제 성공 시 목록으로 돌려보낸다.
 */
interface TastingEditControlsProps {
  tastingId: string;
  wineName: string;
  rev: number;
}

export function TastingEditControls({
  tastingId,
  wineName,
  rev,
}: TastingEditControlsProps): ReactElement {
  return (
    <EditorOnly>
      <div className="flex gap-2">
        <EditActionButton
          formId={`tasting-delete-${tastingId}`}
          endpoint={`/api/tastings/${tastingId}`}
          method="DELETE"
          ariaLabel={`${wineName} 시음 기록 삭제`}
          onSuccess={() => {
            // replace 로 이동한다 — 뒤로 가기로 삭제된 페이지에 돌아가면 404 가 뜬다
            window.location.replace('/');
          }}
        >
          삭제
        </EditActionButton>
        <EditActionButton
          formId={`tasting-edit-${tastingId}`}
          endpoint={`/api/tastings/${tastingId}`}
          method="PATCH"
          ariaLabel={`${wineName} 시음 기록 수정`}
          body={{ rev }}
        >
          수정
        </EditActionButton>
      </div>
    </EditorOnly>
  );
}
