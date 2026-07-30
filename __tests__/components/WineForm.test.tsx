import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldConfidenceMap } from '@waganda/schemas';
import { WineForm } from '@/components/wine/WineForm';

/**
 * components/wine/WineForm.tsx 테스트 (6.6 UI 부분).
 * 이름만 필수, 저신뢰 필드 강조 조건부 렌더링을 검증한다.
 */

describe('<WineForm>', () => {
  it('이름 없이 제출하면 거부되고 한국어 에러가 표시된다', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<WineForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('와인 이름은 필수 입력입니다.');
  });

  it('이름만 입력해도 나머지 필드 없이 제출할 수 있다(R4: 이름만 필수)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<WineForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('와인 이름 (필수)'), '샤토 마고');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: '샤토 마고', grapes: [] }),
    );
  });

  it('품종은 쉼표로 구분해 배열로 변환된다', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<WineForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('와인 이름 (필수)'), '테스트 와인');
    await user.type(screen.getByLabelText('품종 (쉼표로 구분)'), '카베르네 소비뇽, 메를로');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: ['카베르네 소비뇽', '메를로'] }),
    );
  });

  it('저신뢰(low) 필드는 배지와 강조 테두리로 표시된다(색상 외 수단 병행)', () => {
    const fieldConfidence: FieldConfidenceMap = { vintage: 'low', country: 'high' };
    render(<WineForm onSubmit={vi.fn()} fieldConfidence={fieldConfidence} />);

    const vintageField = screen.getByTestId('field-vintage');
    expect(vintageField).toHaveAttribute('data-low-confidence', 'true');
    expect(vintageField).toHaveTextContent('확인 필요');

    const countryField = screen.getByTestId('field-country');
    expect(countryField).toHaveAttribute('data-low-confidence', 'false');
    expect(countryField).not.toHaveTextContent('확인 필요');
  });

  it('신뢰도 정보가 없으면 강조 표시가 나타나지 않는다', () => {
    render(<WineForm onSubmit={vi.fn()} />);
    expect(screen.queryByText('확인 필요 (인식 신뢰도 낮음)')).not.toBeInTheDocument();
  });

  it('초기값(라벨 인식 결과)을 폼에 반영한다', () => {
    render(
      <WineForm
        onSubmit={vi.fn()}
        initialValue={{ name: '피노 누아', vintage: 2020, country: '프랑스' }}
      />,
    );

    expect(screen.getByLabelText('와인 이름 (필수)')).toHaveValue('피노 누아');
    expect(screen.getByLabelText('빈티지')).toHaveValue(2020);
    expect(screen.getByLabelText('국가')).toHaveValue('프랑스');
  });
});
