'use client';

import Link from 'next/link';
import { useCallback, useState, type ReactElement } from 'react';
import { MAX_RECORDINGS_PER_TASTING, type LabelExtraction } from '@waganda/schemas';
import { EditorOnly, EditorSessionProvider } from '@/components/auth/EditorSession';
import { WriteActionGuard, useWriteAction } from '@/components/auth/WriteActionGuard';
import { AudioRecorder } from '@/components/record/AudioRecorder';
import { validateAudioUpload } from '@/lib/upload/validate';
import { prepareLabelImage } from '@/lib/upload/image';

/**
 * app/record/page.tsx — 시음 기록 캡처 (2단계).
 *
 * 설계 의도: 와인을 마시는 중에는 폼을 채울 수 없다.
 * 그래서 입력을 **사진 한 번 + 녹음 한 번**으로 줄이고, 나머지는 AI 와 사후 편집에 맡긴다.
 *
 *   1단계 — 라벨 사진: 촬영 → 인식 → 결과를 한 줄로 확인 (초안 와인 즉시 생성)
 *   2단계 — 녹음: 버튼 하나로 시작/종료. 종료하면 **자동 저장**되고 분석이 시작된다.
 *
 * 저장 버튼과 상세 와인 폼은 이 화면에 두지 않는다.
 * 저신뢰 필드는 시음 상세 화면에서 확인·수정한다.
 */
const FORM_ID = 'record-capture';

/** 인식 결과에서 화면에 보여줄 한 줄 요약을 만든다 */
function summarizeLabel(label: LabelExtraction): string {
  const parts = [label.name?.value, label.vintage?.value ? String(label.vintage.value) : undefined];
  const place = label.regionName?.value ?? label.country?.value;
  const summary = parts.filter(Boolean).join(' ');
  return place ? `${summary} · ${place}` : summary;
}

type Step1State =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'analyzing' }
  | {
      kind: 'ready';
      wineId: string;
      tastingId: string;
      summary: string;
      attachedToExisting: boolean;
    }
  | { kind: 'manual'; message?: string; labelImageKey?: string };

type Step2State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done'; tastingId: string; analysisStarted: boolean }
  | { kind: 'error'; message: string };

function RecordCapture(): ReactElement {
  const { runWriteAction } = useWriteAction({ formId: FORM_ID });

  const [step1, setStep1] = useState<Step1State>({ kind: 'idle' });
  const [step2, setStep2] = useState<Step2State>({ kind: 'idle' });
  const [manualName, setManualName] = useState('');
  const [recordingCount, setRecordingCount] = useState(0);

  /** 초안 와인 + 시음 세션을 만든다 (사진 인식 결과 또는 직접 입력한 이름 기반) */
  const createDraftAndTasting = useCallback(
    async (
      wine: { name: string; label?: LabelExtraction },
      labelImageKey?: string,
    ): Promise<
      { wineId: string; tastingId: string; attachedToExisting: boolean } | { error: string }
    > => {
      const label = wine.label;
      const wineResponse = await runWriteAction('/api/wines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: wine.name,
          vintage: label?.vintage?.value,
          wineType: label?.wineType?.value,
          country: label?.country?.value,
          // 카탈로그 엔티티로 연결할 수 없는 이름은 텍스트로라도 남긴다 (화면에 산지가 비지 않게)
          wineryName: label?.wineryName?.value,
          regionName: label?.regionName?.value,
          grapes: label?.grapes?.value,
          alcoholPercent: label?.alcoholPercent?.value,
          labelTags: label?.labelTags?.value,
          bottleShape: label?.bottleShape?.value,
          closure: label?.closure?.value,
          sourceUrls: label?.sourceUrls,
          // 라벨 모티프 + 특징을 자유 태그로 함께 저장한다 (R8 탐색 축)
          tags: [...(label?.visualTags?.value ?? []), ...(label?.characterTags?.value ?? [])],
          characterNote: label?.characterNote?.value,
          // 인식으로 채운 값은 확인 전까지 초안이다
          draft: true,
        }),
      });

      if (!wineResponse.ok) {
        if (wineResponse.status === 401) return { error: '' };
        return { error: '와인 정보를 저장하지 못했습니다.' };
      }
      const wineBody = (await wineResponse.json()) as {
        wine?: { id?: string };
        duplicateCandidates?: { wineId: string; name: string; vintage?: number }[];
      };

      /*
       * 같은 와인을 다시 마신 경우: 서버가 중복 후보를 돌려준다.
       * 새 와인을 또 만들지 않고 **기존 와인에 시음을 붙인다** (R4).
       * 어느 와인에 붙었는지는 화면의 요약 칩으로 드러낸다.
       */
      const duplicate = wineBody.duplicateCandidates?.[0];
      const wineId = wineBody.wine?.id ?? duplicate?.wineId;
      if (!wineId) return { error: '와인 정보를 저장하지 못했습니다.' };
      const attachedToExisting = wineBody.wine?.id === undefined && duplicate !== undefined;

      /*
       * 기존 와인에 붙이는 경우, 이번에 새로 알아낸 정보(도수·품종·지역 등)를 버리지 않는다.
       * 빈 필드만 채우는 경로이므로 편집자가 고친 값은 그대로 남는다.
       */
      if (attachedToExisting && label) {
        await runWriteAction(`/api/wines/${wineId}/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vintage: label.vintage?.value,
            wineType: label.wineType?.value,
            country: label.country?.value,
            wineryName: label.wineryName?.value,
            regionName: label.regionName?.value,
            grapes: label.grapes?.value,
            alcoholPercent: label.alcoholPercent?.value,
            labelTags: label.labelTags?.value,
            bottleShape: label.bottleShape?.value,
            closure: label.closure?.value,
            sourceUrls: label.sourceUrls,
            tags: [...(label.visualTags?.value ?? []), ...(label.characterTags?.value ?? [])],
            characterNote: label.characterNote?.value,
          }),
        }).catch(() => undefined);
      }

      const tastingResponse = await runWriteAction('/api/tastings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wineId,
          tastedAt: new Date().toISOString(),
          labelImageKey,
        }),
      });

      if (!tastingResponse.ok) {
        if (tastingResponse.status === 401) return { error: '' };
        return { error: '시음 기록을 만들지 못했습니다.' };
      }
      const tastingBody = (await tastingResponse.json()) as {
        tastingId?: string;
        id?: string;
      };
      const tastingId = tastingBody.tastingId ?? tastingBody.id;
      if (!tastingId) return { error: '시음 기록을 만들지 못했습니다.' };

      return { wineId, tastingId, attachedToExisting };
    },
    [runWriteAction],
  );

  /** 1단계 — 사진 선택 시: 업로드 → 인식 → 초안 와인·시음 생성 */
  const handlePhoto = useCallback(
    async (input: File) => {
      setStep1({ kind: 'uploading' });

      // 아이폰 HEIC 는 인식 모델이 읽지 못하고, 원본 해상도는 과하다 → JPEG 로 축소·변환
      const prepared = await prepareLabelImage(input);
      if (!prepared.ok) {
        setStep1({ kind: 'manual', message: prepared.reason });
        return;
      }
      const file = prepared.file;

      try {
        const presign = await runWriteAction('/api/labels/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
        });

        if (!presign.ok) {
          const body = (await presign.json().catch(() => ({}))) as { message?: string };
          setStep1({ kind: 'manual', message: body.message ?? '사진을 올리지 못했습니다.' });
          return;
        }

        const { uploadUrl, imageKey } = (await presign.json()) as {
          uploadUrl: string;
          imageKey: string;
        };

        let put: Response;
        try {
          put = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          });
        } catch {
          // 저장소에 직접 올리는 단계 — 로컬에서는 S3 가 떠 있지 않으면 여기서 막힌다
          setStep1({
            kind: 'manual',
            message: '사진 저장소에 연결하지 못했습니다. 이름만 입력해 계속할 수 있습니다.',
          });
          return;
        }
        if (!put.ok) {
          setStep1({
            kind: 'manual',
            message: `사진 업로드가 거부되었습니다. (오류 ${put.status})`,
          });
          return;
        }

        setStep1({ kind: 'analyzing' });

        const analyze = await runWriteAction('/api/labels/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageKey }),
        });

        if (!analyze.ok) {
          // 5xx 는 인식 서비스(에이전트) 쪽 문제다 — 사진을 알아보지 못한 것과 구분한다.
          const message =
            analyze.status >= 500
              ? '라벨 인식 서비스에 연결하지 못했습니다. 사진은 저장했으니 이름만 입력해 주세요.'
              : '라벨을 알아보지 못했습니다. 사진은 저장했으니 이름만 입력해 주세요.';
          setStep1({ kind: 'manual', message, labelImageKey: imageKey });
          return;
        }

        const { label } = (await analyze.json()) as { label?: LabelExtraction };
        const name = label?.name?.value;
        if (!label || !label.recognized || !name) {
          // R3: 인식 실패 시에도 첨부한 사진은 유지한다
          setStep1({
            kind: 'manual',
            message: '라벨을 알아보지 못했습니다. 사진은 저장했으니 이름만 입력해 주세요.',
            labelImageKey: imageKey,
          });
          return;
        }

        const created = await createDraftAndTasting({ name, label }, imageKey);
        if ('error' in created) {
          setStep1({
            kind: 'manual',
            message: created.error || undefined,
            labelImageKey: imageKey,
          });
          return;
        }

        setStep1({
          kind: 'ready',
          wineId: created.wineId,
          tastingId: created.tastingId,
          summary: summarizeLabel(label),
          attachedToExisting: created.attachedToExisting,
        });
      } catch {
        setStep1({
          kind: 'manual',
          message: '사진을 처리하지 못했습니다. 이름만 입력해 계속할 수 있습니다.',
        });
      }
    },
    [runWriteAction, createDraftAndTasting],
  );

  /** 1단계 폴백 — 이름만 입력해 초안 와인·시음 생성 */
  const handleManualConfirm = useCallback(async () => {
    const name = manualName.trim();
    if (!name) return;

    // 인식에 실패했더라도 이미 올라간 사진은 시음에 붙여 둔다 (R3)
    const keptImageKey = step1.kind === 'manual' ? step1.labelImageKey : undefined;

    setStep1({ kind: 'analyzing' });
    const created = await createDraftAndTasting({ name }, keptImageKey);
    if ('error' in created) {
      setStep1({
        kind: 'manual',
        message: created.error || undefined,
        labelImageKey: keptImageKey,
      });
      return;
    }
    setStep1({
      kind: 'ready',
      wineId: created.wineId,
      tastingId: created.tastingId,
      summary: name,
      attachedToExisting: created.attachedToExisting,
    });
  }, [manualName, createDraftAndTasting, step1]);

  /** 2단계 — 녹음 종료 시: 사전 서명 URL 발급 → 업로드 → 분석 시작 (자동 저장) */
  const handleRecordingComplete = useCallback(
    async (blob: Blob, meta: { durationSec: number; mimeType: string }) => {
      if (step1.kind !== 'ready') return;
      const { tastingId } = step1;

      if (recordingCount >= MAX_RECORDINGS_PER_TASTING) {
        setStep2({
          kind: 'error',
          message: `녹음은 최대 ${MAX_RECORDINGS_PER_TASTING}개까지 붙일 수 있습니다.`,
        });
        return;
      }

      const format = meta.mimeType.includes('mp4')
        ? 'm4a'
        : meta.mimeType.includes('mpeg')
          ? 'mp3'
          : meta.mimeType.includes('wav')
            ? 'wav'
            : 'webm';

      const validation = validateAudioUpload({
        format,
        sizeBytes: blob.size,
        durationSec: meta.durationSec,
      });
      if (!validation.ok) {
        setStep2({ kind: 'error', message: validation.reason ?? '녹음을 저장할 수 없습니다.' });
        return;
      }

      setStep2({ kind: 'saving' });
      try {
        const presign = await runWriteAction(`/api/tastings/${tastingId}/recordings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format, durationSec: meta.durationSec, sizeBytes: blob.size }),
        });

        if (!presign.ok) {
          const body = (await presign.json().catch(() => ({}))) as { message?: string };
          setStep2({ kind: 'error', message: body.message ?? '녹음을 저장하지 못했습니다.' });
          return;
        }

        const { uploadUrl } = (await presign.json()) as { uploadUrl: string };
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': meta.mimeType },
          body: blob,
        });
        if (!put.ok) {
          setStep2({ kind: 'error', message: '녹음 업로드에 실패했습니다. 다시 시도해 주세요.' });
          return;
        }

        setRecordingCount((count) => count + 1);

        /*
         * 업로드가 끝나면 분석을 시작한다.
         * 배포 환경에서는 AgentCore 파이프라인이, 로컬에서는 로컬 파이프라인이 돈다.
         * 실패해도 녹음은 저장돼 있으므로 화면을 막지 않는다(상세에서 재분석 가능).
         */
        const analyzeResponse = await runWriteAction(`/api/tastings/${tastingId}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch(() => undefined);

        setStep2({
          kind: 'done',
          tastingId,
          analysisStarted: analyzeResponse?.ok === true,
        });
      } catch {
        setStep2({ kind: 'error', message: '네트워크 오류로 녹음을 저장하지 못했습니다.' });
      }
    },
    [step1, recordingCount, runWriteAction],
  );

  const wineReady = step1.kind === 'ready';

  return (
    <main className="mx-auto max-w-md space-y-8 p-4">
      <h1 className="font-display text-2xl text-cream-100">시음 기록</h1>

      {/* ── 1단계: 라벨 사진 ─────────────────────────────── */}
      <section aria-labelledby="step-wine" className="space-y-3">
        <h2 id="step-wine" className="text-muted text-sm">
          1 · 무슨 와인이에요?
        </h2>

        {step1.kind === 'idle' && (
          <>
            <label className="flex h-28 cursor-pointer items-center justify-center rounded-xl border border-dashed border-gold-500/40 text-center text-cream-200 hover:bg-ink-800">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="라벨 사진 촬영"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePhoto(file);
                }}
              />
              <span>라벨 사진 찍기</span>
            </label>
            <button
              type="button"
              className="text-muted text-xs underline"
              onClick={() => setStep1({ kind: 'manual' })}
            >
              사진 없이 이름만 입력
            </button>
          </>
        )}

        {(step1.kind === 'uploading' || step1.kind === 'analyzing') && (
          <p role="status" className="text-cream-200 text-sm">
            {step1.kind === 'uploading' ? '사진 올리는 중…' : '라벨 읽는 중…'}
          </p>
        )}

        {step1.kind === 'manual' && (
          <div className="space-y-2">
            {step1.message && (
              <p role="alert" className="text-sm text-burgundy-300">
                {step1.message}
              </p>
            )}
            <label htmlFor="manual-wine-name" className="text-muted block text-sm">
              와인 이름
            </label>
            <div className="flex gap-2">
              <input
                id="manual-wine-name"
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="예: Château Margaux 2015"
                className="flex-1 rounded border border-gold-500/30 bg-ink-900 px-3 py-2 text-sm text-cream-100"
              />
              <button
                type="button"
                onClick={() => void handleManualConfirm()}
                disabled={manualName.trim().length === 0}
                className="rounded border border-gold-500/40 px-3 py-2 text-sm text-gold-300 disabled:opacity-40"
              >
                확인
              </button>
            </div>
          </div>
        )}

        {wineReady && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gold-500/30 px-3 py-1 text-sm text-cream-100">
              {step1.summary}
            </span>
            {step1.attachedToExisting && (
              <span className="text-muted text-xs">기존에 기록한 와인에 이어 붙입니다</span>
            )}
            <button
              type="button"
              className="text-muted text-xs underline"
              onClick={() => {
                setManualName('');
                setStep1({ kind: 'manual' });
              }}
            >
              다름
            </button>
          </div>
        )}
      </section>

      {/* ── 2단계: 녹음 ──────────────────────────────────── */}
      <section aria-labelledby="step-record" className="space-y-3">
        <h2 id="step-record" className="text-muted text-sm">
          2 · 마시면서 이야기하세요
        </h2>

        {!wineReady ? (
          <p className="text-muted text-sm">와인을 먼저 확인하면 녹음할 수 있습니다.</p>
        ) : (
          <>
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
            {recordingCount > 0 && (
              <p className="text-muted text-xs">
                녹음 {recordingCount} / {MAX_RECORDINGS_PER_TASTING} · 이어서 더 담을 수 있습니다
              </p>
            )}
          </>
        )}

        {step2.kind === 'saving' && (
          <p role="status" className="text-cream-200 text-sm">
            저장 중…
          </p>
        )}
        {step2.kind === 'error' && (
          <p role="alert" className="text-sm text-burgundy-300">
            {step2.message}
          </p>
        )}
        {step2.kind === 'done' && (
          <div className="space-y-2">
            <p role="status" className="text-cream-200 text-sm">
              {step2.analysisStarted
                ? '저장했습니다. 분석이 끝나면 기록에 반영됩니다.'
                : '저장했습니다. 분석은 기록 화면에서 다시 시작할 수 있습니다.'}
            </p>
            <Link
              href={`/tastings/${step2.tastingId}`}
              className="inline-block rounded border border-gold-500/40 px-3 py-2 text-sm text-gold-300"
            >
              기록 보기
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * 페이지 진입점.
 *
 * `/record` 는 쓰기 화면이므로 **로그인한 편집자에게만** 캡처 UI 를 보여준다 (R1).
 */
export default function RecordPage(): ReactElement {
  return (
    <EditorSessionProvider>
      <EditorOnly fallback={<RecordLoginPrompt />}>
        <WriteActionGuard formId={FORM_ID}>
          <RecordCapture />
        </WriteActionGuard>
      </EditorOnly>
    </EditorSessionProvider>
  );
}

/** 비로그인 방문자에게 보여줄 안내 */
function RecordLoginPrompt(): ReactElement {
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="font-display text-2xl text-cream-100">시음 기록</h1>
      <p className="text-cream-200 text-sm">
        기록 작성은 편집자만 가능합니다. 로그인하면 라벨 사진과 녹음을 남길 수 있습니다.
      </p>
      <div className="flex gap-2">
        <a
          href="/api/auth/google/start?returnTo=%2Frecord"
          className="rounded border border-gold-500/40 px-3 py-2 text-sm text-gold-300 hover:bg-gold-500/10"
        >
          로그인
        </a>
        <Link
          href="/"
          className="rounded border border-gold-500/20 px-3 py-2 text-sm text-cream-200 hover:bg-ink-800"
        >
          기록 둘러보기
        </Link>
      </div>
    </main>
  );
}
