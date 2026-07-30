/**
 * 시음 기록 추가 진입점 테스트.
 *
 * 정책: 열람은 누구나, 기록은 로그인한 편집자만.
 * - 비로그인: 로그인해야 기록할 수 있다는 안내와 로그인 링크
 * - 로그인: `/record` 로 가는 기록 추가 버튼
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { RecordEntryPoint } from '@/components/record/RecordEntryPoint';
import { renderAsEditor, renderAsVisitor } from '../helpers/renderWithSession';

describe('RecordEntryPoint — 비로그인', () => {
  it('로그인해야 기록할 수 있다고 안내한다', () => {
    renderAsVisitor(<RecordEntryPoint />);
    expect(screen.getByRole('note')).toHaveTextContent(/로그인한 편집자만 추가할 수 있습니다/);
  });

  it('로그인 링크가 기록 화면으로 복귀하도록 returnTo 를 붙인다', () => {
    renderAsVisitor(<RecordEntryPoint />);
    expect(screen.getByRole('link', { name: '로그인하고 기록하기' })).toHaveAttribute(
      'href',
      '/api/auth/google/start?returnTo=%2Frecord',
    );
  });

  it('기록 추가 버튼은 노출하지 않는다', () => {
    renderAsVisitor(<RecordEntryPoint />);
    expect(screen.queryByRole('link', { name: /시음 기록 추가/ })).not.toBeInTheDocument();
  });
});

describe('RecordEntryPoint — 로그인한 편집자', () => {
  it('기록 추가 버튼이 /record 로 연결된다', () => {
    renderAsEditor(<RecordEntryPoint />);
    expect(screen.getByRole('link', { name: /시음 기록 추가/ })).toHaveAttribute('href', '/record');
  });

  it('로그인 안내는 노출하지 않는다', () => {
    renderAsEditor(<RecordEntryPoint />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
