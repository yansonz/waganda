'use client';

/**
 * components/wine/WineForm.tsx — 와인 정보 입력 폼 (6.4).
 *
 * requirements.md R4: "와인 등록 시 이름을 제외한 모든 필드를 선택 입력으로 허용한다".
 * requirements.md R3: "신뢰도가 low 인 필드가 있으면 해당 입력 필드를 강조 표시하여
 * 사용자 확인을 유도한다" — 색상만이 아니라 배지·아이콘·텍스트도 함께 제공한다.
 */
import { useId, useState } from 'react';
import type {
  BottleShape,
  Closure,
  FieldConfidenceMap,
  WineInput,
  WineType,
} from '@waganda/schemas';

export interface WineFormValue {
  name: string;
  vintage?: number;
  wineType?: WineType;
  country?: string;
  grapes: string[];
  alcoholPercent?: number;
  bottleShape?: BottleShape;
  closure?: Closure;
  notes?: string;
}

export interface WineFormProps {
  /** 초기값 (라벨 인식 결과 등으로 미리 채울 때 사용) */
  initialValue?: Partial<WineFormValue>;
  /** 필드별 신뢰도 — 'low' 인 필드는 강조 표시한다 (R3) */
  fieldConfidence?: FieldConfidenceMap;
  onSubmit: (value: WineInput) => void;
  submitLabel?: string;
}

const WINE_TYPE_OPTIONS: { value: WineType; label: string }[] = [
  { value: 'red', label: '레드' },
  { value: 'white', label: '화이트' },
  { value: 'rose', label: '로제' },
  { value: 'sparkling', label: '스파클링' },
  { value: 'dessert', label: '디저트' },
  { value: 'fortified', label: '주정강화' },
];

const BOTTLE_SHAPE_OPTIONS: { value: BottleShape; label: string }[] = [
  { value: 'bordeaux', label: '보르도형' },
  { value: 'burgundy', label: '부르고뉴형' },
  { value: 'alsace', label: '알자스형' },
  { value: 'champagne', label: '샴페인형' },
  { value: 'other', label: '기타' },
];

const CLOSURE_OPTIONS: { value: Closure; label: string }[] = [
  { value: 'cork', label: '코르크' },
  { value: 'screwcap', label: '스크류캡' },
  { value: 'crown', label: '크라운캡' },
  { value: 'other', label: '기타' },
];

/**
 * 저신뢰 필드 강조 배지. 색상(gold) 뿐 아니라 아이콘(⚠)과 텍스트("확인 필요")를
 * 함께 제공해 색각 이상 사용자도 정보를 인지할 수 있게 한다.
 */
function LowConfidenceBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-500/20 px-2 py-0.5 text-xs font-medium text-gold-400">
      <span aria-hidden="true">⚠</span>
      확인 필요 (인식 신뢰도 낮음)
    </span>
  );
}

function isLowConfidence(fieldConfidence: FieldConfidenceMap | undefined, field: string): boolean {
  return fieldConfidence?.[field] === 'low';
}

/** 필드 래퍼 — 저신뢰 시 테두리 강조 + 배지를 함께 렌더링한다. */
function FieldWrapper({
  label,
  fieldKey,
  fieldConfidence,
  htmlFor,
  children,
}: {
  label: string;
  fieldKey: string;
  fieldConfidence?: FieldConfidenceMap;
  htmlFor: string;
  children: React.ReactNode;
}) {
  const low = isLowConfidence(fieldConfidence, fieldKey);
  return (
    <div
      className={`space-y-1 rounded-md p-2 ${low ? 'border-2 border-gold-500 bg-gold-500/5' : ''}`}
      data-testid={`field-${fieldKey}`}
      data-low-confidence={low}
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-cream-100">
          {label}
        </label>
        {low && <LowConfidenceBadge />}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-cream-100 focus:border-gold-500';

/** 와인 정보 입력 폼. 이름만 필수이고 나머지는 전부 선택이다. */
export function WineForm({
  initialValue,
  fieldConfidence,
  onSubmit,
  submitLabel = '저장',
}: WineFormProps) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [vintage, setVintage] = useState<string>(initialValue?.vintage?.toString() ?? '');
  const [wineType, setWineType] = useState<WineType | ''>(initialValue?.wineType ?? '');
  const [country, setCountry] = useState(initialValue?.country ?? '');
  const [grapesText, setGrapesText] = useState((initialValue?.grapes ?? []).join(', '));
  const [alcoholPercent, setAlcoholPercent] = useState<string>(
    initialValue?.alcoholPercent?.toString() ?? '',
  );
  const [bottleShape, setBottleShape] = useState<BottleShape | ''>(initialValue?.bottleShape ?? '');
  const [closure, setClosure] = useState<Closure | ''>(initialValue?.closure ?? '');
  const [notes, setNotes] = useState(initialValue?.notes ?? '');
  const [nameError, setNameError] = useState<string | null>(null);

  const ids = {
    name: useId(),
    vintage: useId(),
    wineType: useId(),
    country: useId(),
    grapes: useId(),
    alcoholPercent: useId(),
    bottleShape: useId(),
    closure: useId(),
    notes: useId(),
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setNameError('와인 이름은 필수 입력입니다.');
      return;
    }
    setNameError(null);

    const value: WineInput = {
      name: trimmedName,
      vintage: vintage.trim() ? Number(vintage) : undefined,
      wineType: wineType || undefined,
      country: country.trim() || undefined,
      grapes: grapesText
        .split(',')
        .map((g) => g.trim())
        .filter((g) => g.length > 0),
      alcoholPercent: alcoholPercent.trim() ? Number(alcoholPercent) : undefined,
      bottleShape: bottleShape || undefined,
      closure: closure || undefined,
      notes: notes.trim() || undefined,
    };

    onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="와인 정보 입력 폼">
      <FieldWrapper
        label="와인 이름 (필수)"
        fieldKey="name"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.name}
      >
        <input
          id={ids.name}
          type="text"
          aria-required="true"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${ids.name}-error` : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        {nameError && (
          <p id={`${ids.name}-error`} role="alert" className="text-sm text-burgundy-300">
            {nameError}
          </p>
        )}
      </FieldWrapper>

      <FieldWrapper
        label="빈티지"
        fieldKey="vintage"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.vintage}
      >
        <input
          id={ids.vintage}
          type="number"
          inputMode="numeric"
          min={1900}
          max={2100}
          value={vintage}
          onChange={(e) => setVintage(e.target.value)}
          className={inputClass}
        />
      </FieldWrapper>

      <FieldWrapper
        label="와인 종류"
        fieldKey="wineType"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.wineType}
      >
        <select
          id={ids.wineType}
          value={wineType}
          onChange={(e) => setWineType(e.target.value as WineType | '')}
          className={inputClass}
        >
          <option value="">선택 안 함</option>
          {WINE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldWrapper>

      <FieldWrapper
        label="국가"
        fieldKey="country"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.country}
      >
        <input
          id={ids.country}
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={inputClass}
        />
      </FieldWrapper>

      <FieldWrapper
        label="품종 (쉼표로 구분)"
        fieldKey="grapes"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.grapes}
      >
        <input
          id={ids.grapes}
          type="text"
          value={grapesText}
          onChange={(e) => setGrapesText(e.target.value)}
          placeholder="예: 카베르네 소비뇽, 메를로"
          className={inputClass}
        />
      </FieldWrapper>

      <FieldWrapper
        label="알코올 도수(%)"
        fieldKey="alcoholPercent"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.alcoholPercent}
      >
        <input
          id={ids.alcoholPercent}
          type="number"
          inputMode="decimal"
          min={0}
          max={30}
          step={0.1}
          value={alcoholPercent}
          onChange={(e) => setAlcoholPercent(e.target.value)}
          className={inputClass}
        />
      </FieldWrapper>

      <FieldWrapper
        label="병 형태"
        fieldKey="bottleShape"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.bottleShape}
      >
        <select
          id={ids.bottleShape}
          value={bottleShape}
          onChange={(e) => setBottleShape(e.target.value as BottleShape | '')}
          className={inputClass}
        >
          <option value="">선택 안 함</option>
          {BOTTLE_SHAPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldWrapper>

      <FieldWrapper
        label="마감 방식"
        fieldKey="closure"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.closure}
      >
        <select
          id={ids.closure}
          value={closure}
          onChange={(e) => setClosure(e.target.value as Closure | '')}
          className={inputClass}
        >
          <option value="">선택 안 함</option>
          {CLOSURE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldWrapper>

      <FieldWrapper
        label="메모"
        fieldKey="notes"
        fieldConfidence={fieldConfidence}
        htmlFor={ids.notes}
      >
        <textarea
          id={ids.notes}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </FieldWrapper>

      <button
        type="submit"
        className="w-full rounded-md bg-burgundy-700 px-4 py-2 text-sm font-medium text-cream-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}
