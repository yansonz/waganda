import type { ReactElement, ReactNode } from 'react';

/**
 * components/common/SimpleMarkdown.tsx — LLM 이 낸 최소 마크다운을 렌더링한다.
 *
 * 취향 프로파일 서술·구매 가이드 등 모델 출력에는 `**볼드**` 와 `- 목록` 이 섞여 나오는데,
 * 순수 텍스트로 그리면 마크다운 기호가 그대로 노출된다. 프로젝트에 마크다운 의존성을 두지
 * 않으므로, 실제로 모델이 쓰는 부분집합(문단 / 불릿 목록 / 인라인 볼드)만 안전하게 변환한다.
 * 임의 HTML 은 렌더링하지 않는다(dangerouslySetInnerHTML 미사용).
 */
interface SimpleMarkdownProps {
  text: string;
  /** 최상위 컨테이너에 적용할 클래스 (문단 간 간격 등) */
  className?: string;
}

/** 한 줄 안의 `**볼드**` 를 <strong> 으로 바꾼다. */
function renderInline(text: string): ReactNode[] {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((segment, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(segment);
    if (bold) {
      return (
        <strong key={index} className="text-cream-100 font-semibold">
          {bold[1]}
        </strong>
      );
    }
    return <span key={index}>{segment}</span>;
  });
}

export function SimpleMarkdown({ text, className }: SimpleMarkdownProps): ReactElement {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (): void => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-0.5 pl-5">
        {items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flushList();
      continue;
    }
    const listItem = /^[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      listItems.push(listItem[1]);
      continue;
    }
    flushList();
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
  }
  flushList();

  return <div className={className}>{blocks}</div>;
}
