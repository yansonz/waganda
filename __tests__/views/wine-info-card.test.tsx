/**
 * 와인 정보 카드 테스트.
 *
 * 라벨 인식·웹 검색으로 모은 정보를 시음 상세에서 정보성으로 보여준다.
 * 빈 항목을 늘어놓지 않고, 자동으로 채운 값임을 알 수 있어야 한다.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CURRENT_SCHEMA_VERSION, type Wine, type Winery } from '@waganda/schemas';
import { WineInfoCard } from '@/components/wine/WineInfoCard';

const now = '2026-07-30T00:00:00.000Z';
const meta = { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: now, updatedAt: now, rev: 0 };

function makeWine(overrides: Partial<Wine> = {}): Wine {
  return {
    id: 'wine-1',
    type: 'WINE',
    name: '19 Crimes Shiraz',
    nameNormalized: '19 crimes shiraz',
    grapes: [],
    labelTags: [],
    tags: [],
    sourceUrls: [],
    draft: false,
    ...meta,
    ...overrides,
  } as Wine;
}

const winery: Winery = {
  id: 'winery-1',
  type: 'WINERY',
  name: 'Treasury Wine Estates',
  nameNormalized: 'treasury wine estates',
  ...meta,
};

describe('WineInfoCard', () => {
  it('품종·산지·도수·종류를 보여준다', () => {
    render(
      <WineInfoCard
        wine={makeWine({
          wineType: 'red',
          grapes: ['Shiraz', 'Cabernet Sauvignon'],
          country: '호주',
          alcoholPercent: 13.5,
        })}
        regionPath={['South Eastern Australia']}
      />,
    );

    expect(screen.getByText('레드')).toBeInTheDocument();
    expect(screen.getByText('Shiraz, Cabernet Sauvignon')).toBeInTheDocument();
    expect(screen.getByText('호주 > South Eastern Australia')).toBeInTheDocument();
    expect(screen.getByText('13.5%')).toBeInTheDocument();
  });

  it('한 줄 특징과 태그를 보여준다', () => {
    render(
      <WineInfoCard
        wine={makeWine({
          characterNote: '잘 익은 검은 과실과 바닐라 오크가 두드러진다',
          tags: ['범죄자 초상', '과실향 강함'],
        })}
        regionPath={[]}
      />,
    );

    expect(screen.getByText(/바닐라 오크/)).toBeInTheDocument();
    expect(screen.getByText('범죄자 초상')).toBeInTheDocument();
    expect(screen.getByText('과실향 강함')).toBeInTheDocument();
  });

  it('와이너리와 병·마감을 보여준다', () => {
    render(
      <WineInfoCard
        wine={makeWine({ bottleShape: 'bordeaux', closure: 'cork' })}
        winery={winery}
        regionPath={[]}
      />,
    );

    expect(screen.getByText('Treasury Wine Estates')).toBeInTheDocument();
    expect(screen.getByText('보르도형 · 코르크')).toBeInTheDocument();
  });

  it('값이 없는 항목은 줄을 그리지 않는다', () => {
    render(<WineInfoCard wine={makeWine({ characterNote: '특징만 있다' })} regionPath={[]} />);

    expect(screen.queryByText('품종')).not.toBeInTheDocument();
    expect(screen.queryByText('도수')).not.toBeInTheDocument();
    expect(screen.getByText('특징만 있다')).toBeInTheDocument();
  });

  it('보여줄 정보가 하나도 없으면 카드를 그리지 않는다', () => {
    const { container } = render(<WineInfoCard wine={makeWine()} regionPath={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('초안이면 확인 필요 배지를 표시한다', () => {
    render(<WineInfoCard wine={makeWine({ draft: true, grapes: ['Shiraz'] })} regionPath={[]} />);
    expect(screen.getByText('확인 필요')).toBeInTheDocument();
  });

  it('저신뢰 필드는 색이 아닌 표시로도 구분한다 (접근성)', () => {
    render(
      <WineInfoCard
        wine={makeWine({
          grapes: ['Shiraz'],
          fieldConfidence: { grapes: 'low' },
        })}
        regionPath={[]}
      />,
    );

    expect(screen.getByText('(추정)')).toBeInTheDocument();
  });

  it('출처는 도메인만 링크로 보여준다', () => {
    render(
      <WineInfoCard
        wine={makeWine({
          grapes: ['Shiraz'],
          sourceUrls: ['https://www.wine-searcher.com/merchant/81565', 'https://19crimes.com/'],
        })}
        regionPath={[]}
      />,
    );

    const link = screen.getByRole('link', { name: 'wine-searcher.com' });
    expect(link).toHaveAttribute('href', 'https://www.wine-searcher.com/merchant/81565');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: '19crimes.com' })).toBeInTheDocument();
  });

  it('정보 출처를 안내한다', () => {
    render(<WineInfoCard wine={makeWine({ grapes: ['Shiraz'] })} regionPath={[]} />);
    expect(screen.getByText(/라벨 사진과 웹 검색으로 모은 정보/)).toBeInTheDocument();
  });
});
