import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState, type ReactElement } from 'react';
import {
  WriteActionGuard,
  useWriteAction,
  saveDraft,
  loadDraft,
  clearDraft,
} from '@/components/auth/WriteActionGuard';

/**
 * components/auth/WriteActionGuard.tsx UI 동작 테스트.
 * 폼 초안 보존·복원, 401 감지 시 로그인 이동, 접근성(role/aria) 을 검증한다.
 */

const ORIGINAL_LOCATION = window.location;

function stubLocation(): { hrefSetter: ReturnType<typeof vi.fn> } {
  const hrefSetter = vi.fn();
  // window.location.href = ... 대입을 가로채기 위해 location 객체를 재정의한다.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...ORIGINAL_LOCATION,
      pathname: '/record',
      get href() {
        return ORIGINAL_LOCATION.href;
      },
      set href(value: string) {
        hrefSetter(value);
      },
    },
  });
  return { hrefSetter };
}

function restoreLocation(): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
}

interface DraftShape {
  wineName: string;
}

/** useWriteAction 을 사용하는 테스트용 폼 컴포넌트 */
function TestForm({ formId, endpoint }: { formId: string; endpoint: string }): ReactElement {
  const { runWriteAction, restoredDraft, consumeRestoredDraft } = useWriteAction({ formId });
  const [wineName, setWineName] = useState('');

  useEffect(() => {
    if (restoredDraft) {
      setWineName((restoredDraft as DraftShape).wineName);
      consumeRestoredDraft();
    }
  }, [restoredDraft, consumeRestoredDraft]);

  async function handleSubmit(): Promise<void> {
    await runWriteAction(endpoint, { method: 'POST' }, { wineName });
  }

  return (
    <div>
      <label htmlFor="wine-name-input">와인 이름</label>
      <input id="wine-name-input" value={wineName} onChange={(e) => setWineName(e.target.value)} />
      <button type="button" onClick={handleSubmit}>
        저장
      </button>
    </div>
  );
}

describe('useWriteAction', () => {
  beforeEach(() => {
    sessionStorage.clear();
    stubLocation();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreLocation();
  });

  it('401 UNAUTHORIZED 응답을 받으면 폼 초안을 저장하고 loginUrl 로 이동한다', async () => {
    const loginUrl = '/api/auth/google/start?returnTo=%2Frecord';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'UNAUTHORIZED', loginUrl }), { status: 401 }),
      ),
    );
    const { hrefSetter } = stubLocation();

    const user = userEvent.setup();
    render(<TestForm formId="tasting-form" endpoint="/api/tastings" />);

    await user.type(screen.getByLabelText('와인 이름'), '샤토 마고');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith(loginUrl);
    });

    const draft = loadDraft<DraftShape>('tasting-form');
    expect(draft?.wineName).toBe('샤토 마고');
  });

  it('200 응답이면 초안을 저장하지 않고 이동하지도 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const { hrefSetter } = stubLocation();

    const user = userEvent.setup();
    render(<TestForm formId="tasting-form-2" endpoint="/api/tastings" />);

    await user.type(screen.getByLabelText('와인 이름'), '피노 누아');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(hrefSetter).not.toHaveBeenCalled();
    });
    expect(loadDraft('tasting-form-2')).toBeNull();
  });

  it('저장된 초안이 있으면 컴포넌트 마운트 시 복원한다', async () => {
    saveDraft('tasting-form-restore', { wineName: '리슬링' });

    render(<TestForm formId="tasting-form-restore" endpoint="/api/tastings" />);

    await waitFor(() => {
      expect(screen.getByLabelText('와인 이름')).toHaveValue('리슬링');
    });

    // 복원 후 초안은 소비되어 제거된다
    await waitFor(() => {
      expect(loadDraft('tasting-form-restore')).toBeNull();
    });
  });

  it('초안 키는 경로 + 폼id 조합으로 서로 다른 폼과 충돌하지 않는다', () => {
    saveDraft('form-a', { wineName: 'A' });
    saveDraft('form-b', { wineName: 'B' });

    expect(loadDraft<DraftShape>('form-a')?.wineName).toBe('A');
    expect(loadDraft<DraftShape>('form-b')?.wineName).toBe('B');

    clearDraft('form-a');
    expect(loadDraft('form-a')).toBeNull();
    expect(loadDraft<DraftShape>('form-b')?.wineName).toBe('B');
  });
});

describe('<WriteActionGuard>', () => {
  it('children 을 정상적으로 렌더링한다', () => {
    render(
      <WriteActionGuard formId="test-form">
        <p>폼 내용</p>
      </WriteActionGuard>,
    );
    expect(screen.getByText('폼 내용')).toBeInTheDocument();
  });

  it('리다이렉트 안내는 role=status, aria-live=polite 로 접근성을 제공한다', async () => {
    // beforeunload 를 강제 발생시켜 안내 문구가 렌더링되는지 확인한다.
    render(
      <WriteActionGuard formId="test-form" redirectingLabel="로그인 화면으로 이동 중">
        <p>폼 내용</p>
      </WriteActionGuard>,
    );

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('로그인 화면으로 이동 중');
  });
});
