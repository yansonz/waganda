import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DuplicateCandidate } from '@waganda/schemas';
import { DuplicateCandidateDialog } from '@/components/wine/DuplicateCandidateDialog';

/**
 * components/wine/DuplicateCandidateDialog.tsx 테스트 (6.6 UI 부분).
 * 중복 후보 선택 동작, role=dialog, ESC 닫기, 키보드 트랩을 검증한다.
 */

const candidates: DuplicateCandidate[] = [
  {
    wineId: 'wine-1',
    name: '샤토 마고',
    vintage: 2015,
    wineryName: '샤토 마고',
    matchedOn: ['name', 'vintage'],
    tastingCount: 2,
  },
];

describe('<DuplicateCandidateDialog>', () => {
  it('닫혀 있으면 아무것도 렌더링하지 않는다', () => {
    render(
      <DuplicateCandidateDialog
        open={false}
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('role=dialog, aria-modal=true 로 렌더링된다', () => {
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('"기존 와인에 시음 추가"를 클릭하면 onSelectExisting 이 wineId 와 함께 호출된다', async () => {
    const onSelectExisting = vi.fn();
    const user = userEvent.setup();
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={onSelectExisting}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '이 와인에 시음 추가' }));
    expect(onSelectExisting).toHaveBeenCalledWith('wine-1');
  });

  it('"새 와인으로 등록"을 클릭하면 onCreateNew 가 호출된다', async () => {
    const onCreateNew = vi.fn();
    const user = userEvent.setup();
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={onCreateNew}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '새 와인으로 등록' }));
    expect(onCreateNew).toHaveBeenCalled();
  });

  it('ESC 키를 누르면 onClose 가 호출된다', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('배경을 클릭하면 onClose 가 호출된다', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={onClose}
      />,
    );

    // 배경(오버레이)은 dialog 바깥의 최상위 div — dialog 내부 클릭은 전파되지 않는다.
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('Tab 키가 다이얼로그 내부 포커스 가능 요소 사이에서 순환한다(키보드 트랩)', async () => {
    const user = userEvent.setup();
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('열리면 첫 포커스 가능 요소로 포커스가 이동한다', () => {
    render(
      <DuplicateCandidateDialog
        open
        candidates={candidates}
        onSelectExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(document.activeElement).toBe(buttons[0]);
  });
});
