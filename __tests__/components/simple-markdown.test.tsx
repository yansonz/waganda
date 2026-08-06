import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimpleMarkdown } from '@/components/common/SimpleMarkdown';

/**
 * __tests__/components/simple-markdown.test.tsx — LLM 이 낸 마크다운 부분집합을
 * 실제 마크업으로 렌더링하는지 검증한다(별표가 그대로 노출되지 않아야 한다).
 */
describe('<SimpleMarkdown>', () => {
  it('인라인 볼드를 <strong> 으로 렌더링하고 별표를 남기지 않는다', () => {
    const { container } = render(<SimpleMarkdown text="산도는 **중간(3.3)** 을 선호합니다." />);

    const strong = screen.getByText('중간(3.3)');
    expect(strong.tagName).toBe('STRONG');
    expect(container.textContent).not.toContain('**');
  });

  it('- 로 시작하는 줄을 불릿 목록으로 렌더링한다', () => {
    const { container } = render(
      <SimpleMarkdown text={'시사점:\n- 가벼운 스타일에 개방적\n- 뚜렷한 향미 선호'} />,
    );

    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('가벼운 스타일에 개방적');
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.textContent).not.toContain('- ');
  });

  it('빈 줄로 분리된 문단을 각각 <p> 로 렌더링한다', () => {
    const { container } = render(<SimpleMarkdown text={'첫 문단\n\n둘째 문단'} />);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
  });
});
