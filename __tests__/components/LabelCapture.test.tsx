import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LabelExtraction } from '@waganda/schemas';
import { LabelCapture } from '@/components/label/LabelCapture';

/**
 * components/label/LabelCapture.tsx 테스트.
 * 라벨 인식 실패 → 수동 입력 폼 전환 + 사진 유지(R3)를 핵심으로 검증한다.
 *
 * jsdom 에는 URL.createObjectURL/revokeObjectURL 이 없으므로 vi.stubGlobal 로 주입한다
 * (vitest.setup.ts 는 수정하지 않는다).
 */

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
});

function makeFile(): File {
  return new File(['fake-image-bytes'], 'label.jpg', { type: 'image/jpeg' });
}

describe('<LabelCapture>', () => {
  it('인식에 성공하면 신뢰도와 함께 필드를 표시한다', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ imageKey: 'labels/1.jpg' });
    const label: LabelExtraction = {
      name: { value: '샤토 마고', confidence: 'high' },
      vintage: { value: 2015, confidence: 'low' },
      recognized: true,
      sourceUrls: [],
    };
    const analyzeLabel = vi.fn().mockResolvedValue({ label });
    const onExtracted = vi.fn();

    const user = userEvent.setup();
    render(
      <LabelCapture
        uploadImage={uploadImage}
        analyzeLabel={analyzeLabel}
        onExtracted={onExtracted}
      />,
    );

    const input = screen.getByLabelText('라벨 사진 촬영 또는 선택');
    await user.upload(input, makeFile());

    await waitFor(() => {
      expect(screen.getByTestId('label-capture-state')).toHaveTextContent('인식 완료');
    });

    expect(screen.getByText(/와인명: 샤토 마고/)).toBeInTheDocument();
    expect(screen.getByText('높은 신뢰도')).toBeInTheDocument();
    expect(screen.getByText('⚠ 확인 필요')).toBeInTheDocument();
    expect(onExtracted).toHaveBeenCalledWith(label);
    expect(screen.getByTestId('label-photo-preview')).toBeInTheDocument();
  });

  it('인식이 실패(recognized: false)하면 사진은 유지된 채 수동 입력 모드로 전환된다', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ imageKey: 'labels/2.jpg' });
    const label: LabelExtraction = {
      recognized: false,
      failureReason: '라벨 글자를 읽을 수 없습니다.',
      sourceUrls: [],
    };
    const analyzeLabel = vi.fn().mockResolvedValue({ label });
    const onManualFallback = vi.fn();

    const user = userEvent.setup();
    render(
      <LabelCapture
        uploadImage={uploadImage}
        analyzeLabel={analyzeLabel}
        onManualFallback={onManualFallback}
      />,
    );

    await user.upload(screen.getByLabelText('라벨 사진 촬영 또는 선택'), makeFile());

    await waitFor(() => {
      expect(screen.getByTestId('label-capture-state')).toHaveTextContent('수동 입력 모드');
    });

    // 사진은 그대로 첨부되어 있어야 한다 (R3).
    expect(screen.getByTestId('label-photo-preview')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('라벨 글자를 읽을 수 없습니다.');
    expect(onManualFallback).toHaveBeenCalledWith('라벨 글자를 읽을 수 없습니다.');
  });

  it('네트워크 오류가 발생해도 사진은 유지되고 수동 입력으로 전환된다', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ imageKey: 'labels/3.jpg' });
    const analyzeLabel = vi.fn().mockRejectedValue(new Error('network error'));

    const user = userEvent.setup();
    render(<LabelCapture uploadImage={uploadImage} analyzeLabel={analyzeLabel} />);

    await user.upload(screen.getByLabelText('라벨 사진 촬영 또는 선택'), makeFile());

    await waitFor(() => {
      expect(screen.getByTestId('label-capture-state')).toHaveTextContent('수동 입력 모드');
    });

    expect(screen.getByTestId('label-photo-preview')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/[가-힣]/);
  });

  it('API 응답에 error 필드가 있으면 수동 입력으로 전환한다', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ imageKey: 'labels/4.jpg' });
    const analyzeLabel = vi.fn().mockResolvedValue({ error: '인증되지 않은 요청입니다.' });

    const user = userEvent.setup();
    render(<LabelCapture uploadImage={uploadImage} analyzeLabel={analyzeLabel} />);

    await user.upload(screen.getByLabelText('라벨 사진 촬영 또는 선택'), makeFile());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('인증되지 않은 요청입니다.');
    });
  });
});
