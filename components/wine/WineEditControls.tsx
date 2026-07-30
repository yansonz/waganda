'use client';

import type { ReactElement } from 'react';
import { EditorOnly } from '@/components/auth/EditorSession';
import { EditActionButton } from '@/components/common/EditActionButton';

/**
 * components/wine/WineEditControls.tsx — 와인 상세 편집·삭제 컨트롤 (14.7, R1/R9).
 */
interface WineEditControlsProps {
  wineId: string;
  wineName: string;
  rev: number;
}

export function WineEditControls({ wineId, wineName, rev }: WineEditControlsProps): ReactElement {
  return (
    <EditorOnly>
      <div className="flex gap-2">
        <EditActionButton
          formId={`wine-delete-${wineId}`}
          endpoint={`/api/wines/${wineId}`}
          method="DELETE"
          ariaLabel={`${wineName} 삭제`}
          onSuccess={() => {
            // replace 로 이동한다 — 뒤로 가기로 삭제된 페이지에 돌아가면 404 가 뜬다
            window.location.replace('/wines');
          }}
        >
          삭제
        </EditActionButton>
        <EditActionButton
          formId={`wine-edit-${wineId}`}
          endpoint={`/api/wines/${wineId}`}
          method="PATCH"
          ariaLabel={`${wineName} 수정`}
          body={{ rev }}
        >
          수정
        </EditActionButton>
      </div>
    </EditorOnly>
  );
}
