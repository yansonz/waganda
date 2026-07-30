/**
 * lib/views/labels.ts — 열거형 값의 한국어 표시 라벨.
 *
 * 와인 종류·병형·마감은 여러 화면(와인 상세 헤더, 와인 정보 카드)에서 같은 말로 보여야 한다.
 * 화면별로 사전을 복사하면 표기가 갈라지므로 한곳에 둔다.
 */
export const WINE_TYPE_LABEL: Record<string, string> = {
  red: '레드',
  white: '화이트',
  rose: '로제',
  sparkling: '스파클링',
  dessert: '디저트',
  fortified: '주정강화',
};

export const BOTTLE_SHAPE_LABEL: Record<string, string> = {
  bordeaux: '보르도형',
  burgundy: '부르고뉴형',
  alsace: '알자스형',
  champagne: '샴페인형',
  other: '기타',
};

export const CLOSURE_LABEL: Record<string, string> = {
  cork: '코르크',
  screwcap: '스크류캡',
  crown: '크라운',
  other: '기타',
};
