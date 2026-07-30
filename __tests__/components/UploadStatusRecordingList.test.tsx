import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_RECORDINGS_PER_TASTING } from '@waganda/schemas';
import { RecordingList } from '@/components/record/RecordingList';
import { UploadStatus, UploadStatusList } from '@/components/record/UploadStatus';
import type { UploadItemMeta } from '@/lib/upload/resume';

/**
 * components/record/{RecordingList,UploadStatus}.tsx 테스트.
 * 세션당 최대 3개 상한 안내, 업로드 실패 후 재시도 UI 동작을 검증한다 (7.7).
 */

describe('<RecordingList>', () => {
  it('녹음이 없으면 안내 문구를 표시한다', () => {
    render(<RecordingList items={[]} />);
    expect(screen.getByText('아직 첨부된 녹음이 없습니다.')).toBeInTheDocument();
  });

  it('등록된 녹음 개수를 상한과 함께 표시한다', () => {
    render(<RecordingList items={[{ id: '1', label: '녹음 1', durationSec: 30 }]} />);
    expect(screen.getByText(`1 / ${MAX_RECORDINGS_PER_TASTING}`)).toBeInTheDocument();
  });

  it('상한(3개)에 도달하면 4번째 녹음 첨부 거부 안내를 표시한다', () => {
    render(
      <RecordingList
        items={[
          { id: '1', label: '녹음 1', durationSec: 10 },
          { id: '2', label: '녹음 2', durationSec: 20 },
          { id: '3', label: '녹음 3', durationSec: 30 },
        ]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      `세션당 녹음은 최대 ${MAX_RECORDINGS_PER_TASTING}개까지`,
    );
  });

  it('삭제 버튼을 누르면 onRemove 가 호출된다', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <RecordingList items={[{ id: '1', label: '녹음 1', durationSec: 30 }]} onRemove={onRemove} />,
    );

    await user.click(screen.getByRole('button', { name: '녹음 1 삭제' }));
    expect(onRemove).toHaveBeenCalledWith('1');
  });
});

function makeMeta(overrides: Partial<UploadItemMeta> = {}): UploadItemMeta {
  return {
    recordingId: 'rec-1',
    uploadUrl: 'https://example.com',
    format: 'webm',
    sizeBytes: 100,
    durationSec: 10,
    status: 'pending',
    attempts: 0,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('<UploadStatus>', () => {
  it('실패 상태에서는 재시도 버튼과 한국어 사유를 표시한다', () => {
    const onRetry = vi.fn();
    render(
      <UploadStatus
        item={makeMeta({ status: 'failed', lastError: '네트워크 오류로 업로드에 실패했습니다.' })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('네트워크 오류');
    expect(screen.getByRole('button', { name: '업로드 재시도' })).toBeInTheDocument();
  });

  it('재시도 버튼을 클릭하면 onRetry 가 recordingId 와 함께 호출된다', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<UploadStatus item={makeMeta({ status: 'failed' })} onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: '업로드 재시도' }));
    expect(onRetry).toHaveBeenCalledWith('rec-1');
  });

  it('재시도 중에는 버튼이 비활성화된다', () => {
    render(<UploadStatus item={makeMeta({ status: 'failed' })} onRetry={vi.fn()} isRetrying />);
    expect(screen.getByRole('button', { name: '업로드 재시도' })).toBeDisabled();
  });

  it('성공 상태에는 재시도 버튼이 없다', () => {
    render(<UploadStatus item={makeMeta({ status: 'succeeded' })} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '업로드 재시도' })).not.toBeInTheDocument();
  });
});

describe('<UploadStatusList>', () => {
  it('항목이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<UploadStatusList items={[]} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('여러 항목을 목록으로 렌더링한다', () => {
    render(
      <UploadStatusList
        items={[makeMeta({ recordingId: 'a' }), makeMeta({ recordingId: 'b', status: 'failed' })]}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('upload-status-a')).toBeInTheDocument();
    expect(screen.getByTestId('upload-status-b')).toBeInTheDocument();
  });
});
