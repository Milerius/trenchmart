'use client';

import { CATEGORIES } from '@trenchmart/shared/categories';
import {
  categoryForKind,
  kindMeta,
  specRows,
  type ListingKind,
  type ListingSpecs,
} from '@trenchmart/shared/listing-kinds';
import { defaultUpdatePrice } from '@trenchmart/shared/versioning';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ContentTabs,
  GalleryEditor,
  imageProblem,
  MAX_IMAGES,
  mediaPath,
  type GalleryItem,
} from '@/components/content-editor';
import { CheckIcon, EditIcon, FileIcon } from '@/components/icons';
import { ListingCard, type Listing } from '@/components/listings';
import { Button, Label, Money, Panel, Square, Tag } from '@/components/ui';
import {
  BotSpecs,
  FilterSpecs,
  IndicatorSpecs,
  kindTag,
  OtherSpecs,
  ScriptSpecs,
  Section,
  Stepper,
  TelegramSpecs,
  TerminalPicker,
  TypeStep,
  WalletSpecs,
} from '@/components/wizard';
import { ApiError, api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { templateFor } from '@/lib/listing-templates';
import { solExact, solText } from '@/lib/money';
import { payVerificationFee, type UnsignedTx } from '@/lib/studio';
import { useWallet } from '@/lib/wallet';
import { toWebp, uploadCopies } from '@/lib/webp';
import {
  bytesLabel,
  draftKey,
  isDraftId,
  isPristine,
  emptyDraft,
  lamportsOf,
  listingRequest,
  medianLamports,
  placeholdersLeft,
  readDraft,
  savedDrafts,
  readUserscriptHeader,
  sha256Hex,
  STEP_COUNT,
  STEPS,
  stepProblem,
  uncoveredTerminals,
  withKind,
  type Draft,
  type ScriptHeader,
} from '@/lib/wizard';

type Requirements = {
  xLinked: boolean;
  bondActive: string;
  verificationFee: string;
  feeWaived: boolean;
  bondByCategory?: Record<string, string>;
  /** What creating a listing in each category checks (live listings and tier included). */
  bondRequiredByCategory?: Record<string, string>;
};

type FileInfo = { file: File; sha: string; header: ScriptHeader | null };

const INPUT =
  'mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm placeholder:text-faint';

const HEAD_SUB: Record<number, string> = {
  1: 'Start with what you’re selling. We tailor the next steps, the template and the review to it.',
  3: 'Name it, say what it does in one line, and write the guide buyers follow.',
  4: 'A cover and screenshots. Buyers decide on these; the review checks every image.',
  5: 'Set what buyers pay once, and what they pay to keep getting updates.',
  6: 'Drop the file buyers download. Automated review runs on it when you submit.',
  7: 'Check everything once. Submitting starts automated review right away.',
};

export default function NewListingPage() {
  const wallet = useWallet();
  const router = useRouter();
  const config = usePublicConfig();
  const centsPerSol = useSolUsd();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [resumable, setResumable] = useState<{ id: string; draft: Draft } | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [reached, setReached] = useState(1);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [imageMessage, setImageMessage] = useState('');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [attested, setAttested] = useState(false);
  const [req, setReq] = useState<Requirements | null>(null);
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [peerPrices, setPeerPrices] = useState<string[] | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const walletAddress = wallet.session?.wallet;

  // "New listing" always starts clean on step 1. Only `?draft=<id>` resumes a saved draft
  // (text only; images and the file stay on the page), and only that draft.
  useEffect(() => {
    if (!walletAddress) return;
    const drafts = savedDrafts(window.localStorage, walletAddress);
    const wanted = new URLSearchParams(window.location.search).get('draft');
    const saved = isDraftId(wanted)
      ? readDraft(window.localStorage.getItem(draftKey(walletAddress, wanted)))
      : null;
    if (saved && isDraftId(wanted)) {
      setDraftId(wanted);
      setDraft(saved);
      setReached(saved.step);
      setResumable(null);
    } else {
      setDraftId(crypto.randomUUID());
      setDraft(emptyDraft());
      setReached(1);
      setResumable(drafts[0] ?? null);
    }
    setRestored(true);
  }, [walletAddress]);

  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (!walletAddress || !restored || !draftId || isPristine(draft)) return;
    const save = () => {
      const now = new Date();
      window.localStorage.setItem(
        draftKey(walletAddress, draftId),
        JSON.stringify({ ...latest.current, savedAt: now.toISOString() }),
      );
      setSavedAt(now);
      // A reload of this tab resumes this draft (and only this one).
      if (new URLSearchParams(window.location.search).get('draft') !== draftId)
        window.history.replaceState(null, '', `?draft=${draftId}`);
    };
    const id = setTimeout(save, 300);
    // Leaving or reloading inside the debounce still keeps the last keystrokes.
    window.addEventListener('pagehide', save);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pagehide', save);
    };
  }, [draft, walletAddress, restored, draftId]);

  useEffect(() => {
    if (!wallet.session) return;
    void api<Requirements>('/studio/requirements')
      .then(setReq)
      .catch(() => setReq(null));
    void api<{ code: string; count: number }[]>('/categories')
      .then((rows) => setLiveCounts(Object.fromEntries(rows.map((r) => [r.code, r.count]))))
      .catch(() => undefined);
  }, [wallet.session]);

  const category = draft.kind ? categoryForKind(draft.kind) : null;
  useEffect(() => {
    if (!category) return;
    setPeerPrices(null);
    void api<{ price: string }[]>(`/listings?category=${category}&limit=48`)
      .then((rows) => setPeerPrices(rows.map((r) => r.price)))
      .catch(() => setPeerPrices([]));
  }, [category]);

  const meta = kindMeta(draft.kind);
  const step = draft.step;
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setSpecs = <K extends ListingKind>(kind: K, patch: Partial<ListingSpecs[K]>) =>
    setDraft((d) => ({ ...d, specs: { ...d.specs, [kind]: { ...d.specs[kind], ...patch } } }));

  const updateBps = config?.updatePriceDefaultBps ?? 1000;
  const priceLamports = lamportsOf(draft.price);
  const suggestedUpdate =
    priceLamports !== null ? solExact(defaultUpdatePrice(priceLamports, updateBps)) : '';
  const updateField = draft.updatePrice ?? suggestedUpdate;
  const updateLamports = draft.updatesOn ? lamportsOf(updateField || '0') : 0n;
  const median = useMemo(() => (peerPrices ? medianLamports(peerPrices) : null), [peerPrices]);
  const fee = req ? (req.feeWaived ? 0n : BigInt(req.verificationFee)) : null;
  const categoryBond =
    req && category
      ? BigInt(req.bondRequiredByCategory?.[category] ?? req.bondByCategory?.[category] ?? '0')
      : 0n;
  const bondShort = req ? BigInt(req.bondActive) < categoryBond : false;
  const freeDays = config?.updateFreeDays ?? 30;

  function go(next: number) {
    setProblem('');
    update({ step: next });
    setReached((r) => Math.max(r, next));
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function forward() {
    const p = stepProblem(draft, step, { file: fileInfo?.file });
    if (p) {
      setProblem(p);
      return;
    }
    go(Math.min(STEP_COUNT, step + 1));
  }

  function addImages(files: File[]) {
    setImageMessage('');
    const room = MAX_IMAGES - images.length;
    const picked: GalleryItem[] = [];
    for (const file of files.slice(0, room)) {
      const p = imageProblem(file);
      if (p) {
        setImageMessage(p);
        continue;
      }
      picked.push({ id: crypto.randomUUID(), url: URL.createObjectURL(file), alt: '', file });
    }
    if (files.length > room) setImageMessage(`Up to ${MAX_IMAGES} images.`);
    setImages((list) => [...list, ...picked]);
    setCover((value) => value ?? picked[0]?.id ?? null);
  }

  async function pickFile(file: File | undefined) {
    if (!file) return setFileInfo(null);
    const sha = await sha256Hex(file);
    const header =
      draft.kind === 'script' || /\.user\.js$/i.test(file.name)
        ? readUserscriptHeader(await file.text())
        : null;
    setFileInfo({ file, sha, header });
  }

  async function saveContent(listingId: string) {
    const ids = new Map<string, string>();
    const gallery: { imageId: string; alt: string }[] = [];
    for (const [index, image] of images.entries()) {
      if (!image.file) continue;
      setBusy(`Uploading image ${index + 1} of ${images.length}…`);
      const upload = await toWebp(image.file);
      const saved = await api<{ id: string }>(`/studio/listings/${listingId}/images`, {
        method: 'POST',
        headers: { 'content-type': upload.type },
        body: upload,
      });
      ids.set(image.id, saved.id);
      gallery.push({ imageId: saved.id, alt: image.alt });
      await uploadCopies(api, listingId, saved.id, upload);
    }
    const swap = (value: string) =>
      [...ids].reduce(
        (out, [temp, real]) => out.split(mediaPath(temp)).join(mediaPath(real)),
        value,
      );
    const page = {
      readme: swap(draft.text.readme),
      howto: swap(draft.text.howto),
      requirements: swap(draft.text.requirements),
    };
    if (!gallery.length && !page.readme.trim() && !page.howto.trim() && !page.requirements.trim())
      return;
    setBusy('Saving listing page…');
    await api(`/studio/listings/${listingId}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        ...page,
        coverImageId: (cover && ids.get(cover)) ?? gallery[0]?.imageId ?? null,
        gallery,
      }),
    });
    setBusy('Reviewing listing page…');
    await api(`/studio/listings/${listingId}/content/review`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async function submit() {
    setMessage('');
    for (let s = 1; s <= 6; s += 1) {
      const p = stepProblem(draft, s, { file: fileInfo?.file });
      if (p) {
        setMessage(`${STEPS[s - 1]!.title}: ${p}`);
        return;
      }
    }
    const file = fileInfo!.file;
    setBusy('Creating listing…');
    const created = await api<{ id: string }>('/studio/listings', {
      method: 'POST',
      body: JSON.stringify(listingRequest(draft, updateField)),
    });
    await saveContent(created.id);
    setBusy('Uploading file…');
    let version: { versionId: string; uploadUrl: string; feeTx: UnsignedTx | null };
    try {
      version = await api(`/studio/listings/${created.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          semver: '1.0.0',
          changelog: 'initial',
          fileName: file.name,
          fileSize: file.size,
        }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SUPPLEMENT_REQUIRED') {
        if (draftId) window.localStorage.removeItem(draftKey(walletAddress!, draftId));
        router.push(`/studio/listings/${created.id}/versions/new`);
        return;
      }
      throw err;
    }
    if (version.feeTx) {
      setBusy('Paying verification fee…');
      await payVerificationFee({
        api,
        versionId: version.versionId,
        feeTx: version.feeTx,
        signAndSend: wallet.signAndSend,
      });
      setBusy('Uploading file…');
    }
    const target = new URL(version.uploadUrl, window.location.origin);
    const put = await fetch(`${target.pathname}${target.search}`, {
      method: 'PUT',
      body: file,
      credentials: 'include',
    });
    if (!put.ok) throw new Error('upload failed');
    if (draftId) window.localStorage.removeItem(draftKey(walletAddress!, draftId));
    router.push(`/studio/listings/${created.id}/versions/${version.versionId}`);
  }

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">New listing</h1>
        <p className="mt-3 text-ink-2">Connect a wallet first.</p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }

  const specificsLabel = meta?.specificsLabel ?? 'Specifics';
  const previewListing: Listing = {
    slug: 'preview',
    title: draft.title || 'Your listing title',
    summary: draft.summary || 'Your one-line summary shows here.',
    category: category ?? 'userscript',
    terminals: draft.terminals,
    price: (priceLamports ?? 0n).toString(),
    handle: wallet.session.handle ?? undefined,
    cover: cover ? { url: images.find((i) => i.id === cover)?.url ?? '', alt: '' } : null,
    imageCount: images.length,
  };
  const preview = (
    <div className="space-y-3" data-testid="card-preview">
      <Label>Your card in the market · live preview</Label>
      <div inert>
        <ListingCard listing={previewListing} pricing={{ centsPerSol, config }} />
      </div>
    </div>
  );
  const rows = draft.kind ? specRows(draft.kind, draft.specs[draft.kind], draft.terminals) : [];
  const specCard = rows.length ? (
    <div className="rounded-panel border border-line bg-surface p-5">
      <Label>Spec buyers see</Label>
      <dl className="m-0 mt-3 space-y-2 text-[13px]">
        {rows.map(([a, b]) => (
          <div key={a} className="flex justify-between gap-3">
            <dt className="text-ink-2">{a}</dt>
            <dd className="m-0 text-right font-mono text-ink">{b}</dd>
          </div>
        ))}
      </dl>
    </div>
  ) : null;
  const left = placeholdersLeft(draft.text);
  const scriptUncovered =
    draft.kind === 'script' && fileInfo?.header
      ? uncoveredTerminals(
          draft.terminals.filter((t) => t !== 'Any'),
          fileInfo.header.matches,
        )
      : [];

  const actions = (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-line-strong bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-panel sm:border sm:border-line sm:bg-surface sm:px-5">
      {problem ? (
        <p role="alert" className="m-0 mb-2 text-sm text-danger" data-testid="step-problem">
          {problem}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        {step > 1 ? (
          <Button variant="secondary" onClick={() => go(step - 1)} aria-label="Back">
            ← <span className="hidden sm:inline">Back</span>
          </Button>
        ) : (
          <span className="hidden text-sm text-muted sm:inline">
            You can change the type until you submit.
          </span>
        )}
        <span className="hidden font-mono text-xs text-muted sm:inline">
          Step {step} of {STEP_COUNT}
        </span>
        {step < STEP_COUNT ? (
          <Button
            size="lg"
            className="flex-1 sm:flex-none"
            onClick={forward}
            data-testid="continue"
          >
            Continue: {(step === 1 ? specificsLabel : STEPS[step]!.title).toLowerCase()} →
          </Button>
        ) : null}
      </div>
    </div>
  );

  let body: ReactNode = null;
  let aside: ReactNode = (
    <>
      {preview}
      {specCard}
    </>
  );
  if (step === 1) {
    body = (
      <>
        {resumable ? (
          <p
            className="m-0 mb-4 rounded-ctl border border-line bg-surface px-4 py-3 text-[13px] text-ink-2"
            data-testid="resume-draft"
          >
            You have a saved draft
            {resumable.draft.title ? ` “${resumable.draft.title}”` : ''}
            {resumable.draft.kind ? ` (${kindMeta(resumable.draft.kind)?.label})` : ''}, step{' '}
            {resumable.draft.step} of {STEP_COUNT}.{' '}
            <a href={`?draft=${resumable.id}`} className="text-accent">
              Resume it →
            </a>
          </p>
        ) : null}
        <TypeStep
          kind={draft.kind}
          liveCounts={liveCounts}
          onPick={(kind) => setDraft((d) => withKind(d, kind))}
        />
      </>
    );
    aside = null;
  } else if (step === 2 && draft.kind) {
    const k = draft.kind;
    const terminalTitle =
      meta?.terminals === 'import'
        ? 'Imports into'
        : meta?.terminals === 'paste'
          ? 'Which terminals is it for?'
          : 'Which terminals does it run on?';
    body = (
      <>
        {meta?.terminals ? (
          <TerminalPicker
            title={terminalTitle}
            sub={
              meta.terminals === 'run' ? (
                <>
                  Buyers filter by terminal. The review checks your{' '}
                  <span className="font-mono text-ink-2">@match</span> lines against what you pick.
                </>
              ) : (
                'Buyers filter by terminal.'
              )
            }
            value={draft.terminals}
            onChange={(terminals) => update({ terminals })}
          />
        ) : null}
        {k === 'script' ? (
          <ScriptSpecs specs={draft.specs.script} set={(p) => setSpecs('script', p)} />
        ) : null}
        {k === 'bot' ? <BotSpecs specs={draft.specs.bot} set={(p) => setSpecs('bot', p)} /> : null}
        {k === 'wallet' ? (
          <WalletSpecs specs={draft.specs.wallet} set={(p) => setSpecs('wallet', p)} />
        ) : null}
        {k === 'filter' ? (
          <FilterSpecs specs={draft.specs.filter} set={(p) => setSpecs('filter', p)} />
        ) : null}
        {k === 'indicator' ? (
          <IndicatorSpecs specs={draft.specs.indicator} set={(p) => setSpecs('indicator', p)} />
        ) : null}
        {k === 'telegram' ? (
          <TelegramSpecs specs={draft.specs.telegram} set={(p) => setSpecs('telegram', p)} />
        ) : null}
        {k === 'other' ? (
          <OtherSpecs specs={draft.specs.other} set={(p) => setSpecs('other', p)} />
        ) : null}
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <Section title="Basics">
          <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
            <Field label="Title" htmlFor="title" count={`${draft.title.length} / 120`}>
              <input
                id="title"
                value={draft.title}
                maxLength={120}
                placeholder="Bundle Detector Overlay"
                className={INPUT}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            <Field
              label="Summary"
              htmlFor="summary"
              count={`${draft.summary.length} / 280`}
              hint="One line on the market card."
            >
              <input
                id="summary"
                value={draft.summary}
                maxLength={280}
                placeholder="Flags bundled launches on Axiom"
                className={INPUT}
                onChange={(e) => update({ summary: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field
              label="Description"
              htmlFor="description"
              hint="Buyers compare the file with this, and the review checks its declared permissions, so say exactly what it does."
            >
              <textarea
                id="description"
                rows={4}
                value={draft.description}
                className={INPUT}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
          </div>
        </Section>
        <ContentTabs
          text={draft.text}
          setText={(fn) => setDraft((d) => ({ ...d, text: fn(d.text) }))}
          gallery={images}
          previews={Object.fromEntries(images.map((image) => [image.id, image.url]))}
          intro={
            <p data-testid="template-note" className="m-0 px-5 pt-3 text-[13px] text-ink-2">
              Started from the{' '}
              <span className="text-ink">{CATEGORIES.find((c) => c.code === category)?.label}</span>{' '}
              template.{' '}
              {left ? (
                <span className="text-warn">
                  {left} [bracketed] part{left === 1 ? '' : 's'} left to replace.
                </span>
              ) : (
                'Everything is yours to edit.'
              )}
            </p>
          }
          actions={(key) => (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={!category || draft.text[key] === templateFor(category)[key]}
                onClick={() =>
                  category &&
                  setDraft((d) => ({
                    ...d,
                    text: { ...d.text, [key]: templateFor(category)[key] },
                  }))
                }
              >
                Reset to template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!draft.text[key]}
                onClick={() => setDraft((d) => ({ ...d, text: { ...d.text, [key]: '' } }))}
              >
                Start blank
              </Button>
            </>
          )}
        />
      </>
    );
  } else if (step === 4) {
    body = (
      <GalleryEditor
        images={images}
        setImages={setImages}
        cover={cover}
        setCover={setCover}
        onFiles={addImages}
        onRemove={(id) => setImages((list) => list.filter((i) => i.id !== id))}
        note={
          <>
            {imageMessage ? (
              <p role="alert" className="m-0 text-sm text-danger">
                {imageMessage}
              </p>
            ) : null}
            <p className="m-0 text-[12px] text-muted">
              Images aren’t kept in the draft; add them before you submit.
            </p>
          </>
        }
      />
    );
  } else if (step === 5) {
    body = (
      <>
        <Section title="One-time price" sub="What a buyer pays once. You keep 100% of it.">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <label className="flex h-16 w-full items-center rounded-ctl border-2 border-accent bg-inset px-4 focus-within:ring-2 focus-within:ring-accent/40 sm:w-[280px]">
              <span className="sr-only">Price (SOL)</span>
              <input
                id="price"
                inputMode="decimal"
                placeholder="1.20"
                value={draft.price}
                onChange={(e) => update({ price: e.target.value })}
                className="tabular w-full flex-1 bg-transparent font-mono text-[28px] font-semibold placeholder:text-faint field-bare"
              />
              <span className="font-mono text-sm text-muted">SOL</span>
            </label>
            {priceLamports !== null ? (
              <div className="text-ink-2">
                <Money lamports={priceLamports} centsPerSol={centsPerSol} stacked />
              </div>
            ) : null}
          </div>
          {median !== null && peerPrices ? (
            <div
              className="mt-5 rounded-card border border-line bg-inset p-4 text-[13px]"
              data-testid="price-median"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-2">
                  Live {CATEGORIES.find((c) => c.code === category)?.label.toLowerCase()} on
                  TrenchMart
                </span>
                <span className="font-mono text-muted">
                  median {solText(median)} · {peerPrices.length} listings
                </span>
              </div>
            </div>
          ) : null}
        </Section>
        <Section
          title="Updates subscription"
          sub="Buyers renew monthly to keep getting new versions."
          right={
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              {draft.updatesOn ? 'On' : 'Off'}
              <button
                type="button"
                role="switch"
                aria-checked={draft.updatesOn}
                aria-label="Paid updates"
                onClick={() => update({ updatesOn: !draft.updatesOn })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${draft.updatesOn ? 'bg-accent' : 'border border-line-control bg-surface-2'}`}
              >
                <span
                  className={`absolute h-[18px] w-[18px] rounded-full ${draft.updatesOn ? 'right-[3px] bg-onaccent' : 'left-[3px] bg-muted'}`}
                />
              </button>
            </span>
          }
        >
          {draft.updatesOn ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex h-12 w-full items-center rounded-ctl border border-line-control bg-inset px-4 focus-within:border-accent sm:w-[240px]">
                  <span className="sr-only">Monthly update price (SOL)</span>
                  <input
                    id="update-price"
                    inputMode="decimal"
                    placeholder="0.12"
                    value={updateField}
                    onChange={(e) => update({ updatePrice: e.target.value })}
                    className="tabular w-full flex-1 bg-transparent font-mono text-xl font-semibold field-bare"
                  />
                  <span className="whitespace-nowrap font-mono text-sm text-muted">
                    SOL / month
                  </span>
                </label>
                <span className="font-mono text-[13px] text-muted">
                  Suggested {updateBps / 100}% of the price
                </span>
              </div>
              <div className="mt-4 rounded-card border border-accent-line bg-accent-bg p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-accent">
                  <CheckIcon /> First {freeDays} days of updates are free with every purchase
                </div>
                <div className="mt-4 grid grid-cols-3 text-[12px]">
                  {[
                    [
                      'Day 0',
                      `Buys v1.0.0${priceLamports !== null ? ` · ${solText(priceLamports)}` : ''}`,
                    ],
                    [`Days 1–${freeDays}`, 'Free updates'],
                    [
                      `Day ${freeDays + 1}`,
                      updateLamports !== null
                        ? `Renews at ${solText(updateLamports)}/mo`
                        : 'Renews monthly',
                    ],
                  ].map(([a, b], i) => (
                    <div key={a} className={i ? 'pl-3' : ''}>
                      <div
                        className={`mb-2 h-1 rounded-full ${i === 1 ? 'bg-accent' : i === 0 ? 'bg-accent/60' : 'bg-line-strong'}`}
                      />
                      <div className="font-mono text-[11px] text-muted">{a}</div>
                      <div className="text-ink-2">{b}</div>
                    </div>
                  ))}
                </div>
                <p className="m-0 mt-3 text-[12px] text-ink-2">
                  Buyers who stop renewing keep the last version they downloaded.
                </p>
              </div>
            </>
          ) : (
            <p className="m-0 text-[13px] text-ink-2">
              Off: every buyer gets every future version free, forever.
            </p>
          )}
        </Section>
      </>
    );
    aside = (
      <>
        <div className="rounded-panel border border-line bg-surface p-5" data-testid="earnings">
          <Label>You receive per sale</Label>
          <div className="tabular mt-1 font-mono text-2xl font-semibold">
            {priceLamports !== null ? (
              <Money lamports={priceLamports} centsPerSol={centsPerSol} strong />
            ) : (
              '—'
            )}
          </div>
          <dl className="m-0 mt-4 space-y-2 border-t border-line-soft pt-4 text-[13px]">
            <Row a="Your price" b={priceLamports !== null ? solText(priceLamports) : '—'} />
            <Row a="Creator commission" b="0%" />
            <Row
              a="Buyer fee (on top)"
              b={
                priceLamports !== null && config
                  ? `+ ${solText((priceLamports * BigInt(config.feeBps)) / 10_000n)}`
                  : `${(config?.feeBps ?? 500) / 100}%`
              }
            />
            <div className="-mt-1.5 text-right text-[11px] text-muted">
              cut up to 100% by the buyer’s $TRENCH tier
            </div>
            <Row
              a="Update renewals"
              b={
                draft.updatesOn && updateLamports ? `${solText(updateLamports)} / mo each` : 'Free'
              }
            />
          </dl>
          <p className="m-0 mt-3 text-[12px] text-muted">
            Paid in SOL from the Squads vault after each {config?.escrowHours ?? 1} h escrow
            releases.
          </p>
        </div>
        {preview}
      </>
    );
  } else if (step === 6) {
    body = (
      <>
        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-10 text-center hover:border-accent-line"
        >
          <span className="text-base font-semibold">
            {fileInfo?.file.name || 'Drop your file here, or browse'}
          </span>
          <span className="text-[13px] text-muted">
            {meta?.files ?? '.user.js, .json, .csv or .zip'} · up to 5 MB (25 MB for setups)
          </span>
          <input
            id="file"
            type="file"
            className="sr-only"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </label>
        {fileInfo ? <FileSummary info={fileInfo} uncovered={scriptUncovered} /> : null}
        <Panel tone="info" className="p-4 text-[13px] text-ink-2">
          The file isn’t kept in the draft. It uploads when you submit on the next step.
        </Panel>
      </>
    );
  } else if (step === 7) {
    const edit = (n: number) => (
      <button
        type="button"
        onClick={() => go(n)}
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink"
      >
        <EditIcon /> Edit
      </button>
    );
    body = (
      <div className="space-y-4" data-testid="review">
        <ReviewBlock n="01" title="What you sell" edit={edit(1)}>
          <KV
            rows={[
              [
                'Type',
                <span key="t">
                  {meta?.label}{' '}
                  <span className="ml-1">{draft.kind ? kindTag(draft.kind) : null}</span>
                </span>,
              ],
            ]}
          />
        </ReviewBlock>
        <ReviewBlock n="02" title={specificsLabel} edit={edit(2)}>
          <KV rows={rows.map(([a, b]) => [a, b])} />
        </ReviewBlock>
        <ReviewBlock n="03" title="Details" edit={edit(3)}>
          <KV
            rows={[
              ['Title', draft.title || '—'],
              ['Summary', draft.summary || '—'],
              [
                'Guide',
                <span key="g" className="flex flex-wrap items-center gap-2">
                  {(['readme', 'howto', 'requirements'] as const).map((k) => (
                    <Tag key={k} tone={draft.text[k].trim() ? 'ok' : 'neutral'}>
                      {draft.text[k].trim() ? '✓' : '○'}{' '}
                      {k === 'readme' ? 'README' : k === 'howto' ? 'HOW TO USE' : 'REQUIREMENTS'}
                    </Tag>
                  ))}
                  {left ? (
                    <span className="text-[12px] text-warn">{left} [bracketed] parts left</span>
                  ) : null}
                </span>,
              ],
            ]}
          />
        </ReviewBlock>
        <ReviewBlock n="04" title="Media" edit={edit(4)}>
          {images.length ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                <span
                  key={img.id}
                  className={`relative h-[62px] w-[100px] overflow-hidden rounded-[8px] border ${img.id === cover ? 'border-accent' : 'border-line'}`}
                >
                  <img src={img.url} alt={img.alt} className="h-full w-full object-cover" />
                  {img.id === cover ? (
                    <span className="absolute left-1 top-1 rounded-[4px] bg-accent px-1 font-mono text-[9px] font-bold text-onaccent">
                      COVER
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13px] text-muted">
              No images. Listings with screenshots sell better.
            </p>
          )}
        </ReviewBlock>
        <ReviewBlock n="05" title="Pricing" edit={edit(5)}>
          <KV
            rows={[
              [
                'One-time',
                priceLamports !== null ? (
                  <Money key="p" lamports={priceLamports} centsPerSol={centsPerSol} />
                ) : (
                  '—'
                ),
              ],
              [
                'Updates',
                draft.updatesOn && updateLamports
                  ? `${solText(updateLamports)} / month · first ${freeDays} days free`
                  : 'Free forever',
              ],
              ['You receive', '100% · 0% creator commission'],
            ]}
          />
        </ReviewBlock>
        <ReviewBlock n="06" title="File" edit={edit(6)}>
          {fileInfo ? (
            <FileSummary info={fileInfo} uncovered={scriptUncovered} />
          ) : (
            <p className="m-0 text-[13px] text-danger">No file yet.</p>
          )}
        </ReviewBlock>
      </div>
    );
    aside = (
      <>
        <div
          className="rounded-panel border border-accent-line bg-surface p-5 shadow-[0_0_0_3px_rgba(198,244,50,0.06)]"
          data-testid="submit-card"
        >
          <h2 className="m-0 text-base font-semibold">Review fee &amp; submit</h2>
          <dl className="m-0 mt-4 space-y-2 text-[13px]">
            <Row
              a="Verification fee"
              b={fee === null ? '…' : req?.feeWaived ? 'Waived for your tier' : solText(fee)}
            />
            <Row
              a="Creator bond"
              b={
                req
                  ? bondShort
                    ? `${solText(categoryBond)} needed`
                    : `✓ ${solText(BigInt(req.bondActive))} staked`
                  : '…'
              }
            />
          </dl>
          {req && !req.xLinked ? (
            <p className="m-0 mt-3 text-[12px] text-muted" data-testid="x-optional">
              Optional: verify with X for a trust badge on your listings.{' '}
              <Link href="/studio/profile#socials" className="text-accent">
                Verify with X →
              </Link>
            </p>
          ) : null}
          {bondShort ? (
            <div
              data-testid="bond-short"
              className="mt-3 rounded-ctl border border-warn-line bg-warn-bg p-3 text-[12px] text-ink-2"
            >
              This category needs a {solText(categoryBond)} bond (OG tier gets a discount).{' '}
              <Link href="/studio" className="text-accent">
                Stake in the studio →
              </Link>
            </div>
          ) : null}
          <div className="mt-3 flex items-baseline justify-between border-t border-line-soft pt-3">
            <span className="text-sm font-medium">You pay now</span>
            <span className="font-mono text-lg">{fee === null ? '…' : solText(fee)}</span>
          </div>
          <label className="mt-4 flex cursor-pointer gap-3 rounded-ctl border border-line bg-inset p-3 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            />
            The file does what this listing says, it contains nothing I declared as “never”, and I
            have the right to sell it.
          </label>
          <Button
            size="lg"
            className="mt-4 w-full"
            data-testid="submit"
            disabled={!attested || !!busy || bondShort}
            aria-busy={!!busy || undefined}
            onClick={() =>
              void submit().catch((err: Error) => {
                setBusy('');
                setMessage(err.message);
              })
            }
          >
            {busy ||
              (fee && fee > 0n ? `Pay ${solText(fee)} & submit for review` : 'Submit for review')}
          </Button>
          {fee && fee > 0n ? (
            <p className="m-0 mt-2 text-center text-[12px] text-muted">
              Your wallet asks you to sign one transaction.
            </p>
          ) : null}
          {message ? (
            <p role="alert" className="m-0 mt-3 text-sm text-danger">
              {message}
            </p>
          ) : null}
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <Label>What happens next</Label>
          <ol className="m-0 mt-3 space-y-3 p-0 text-sm">
            {[
              ['Static checks', 'eval, remote code, key access, hosts'],
              ['Sandbox run', 'isolated, network and wallet calls logged'],
              ['AI verdict', 'rules engine plus LLM; the stricter wins'],
              ['Listing page', 'images and links checked'],
            ].map(([a, b], i) => (
              <li key={a} className="flex list-none gap-3">
                <Square>{i + 1}</Square>
                <span>
                  <span className="block font-medium">{a}</span>
                  <span className="block text-[13px] text-muted">{b}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-4 text-[13px] text-ink-2">You watch each step live. No queue.</p>
        </div>
        {preview}
      </>
    );
  }

  return (
    <section data-testid="wizard" data-step={step} className="space-y-6" ref={top}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[24px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            New listing
          </h1>
          <p className="m-0 mt-1 hidden text-ink-2 sm:block">
            {step === 2 && meta ? `${meta.label} · ${meta.blurb}` : HEAD_SUB[step]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-1.5 font-mono text-xs text-muted"
            data-testid="draft-status"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {savedAt
              ? `Draft saved on this device · ${savedAt.toTimeString().slice(0, 5)}`
              : 'Draft saves on this device'}
          </span>
          <Button
            variant="secondary"
            className="hidden sm:inline-flex"
            onClick={() => router.push('/studio')}
          >
            Save &amp; exit
          </Button>
        </div>
      </div>
      <Stepper step={step} specificsLabel={specificsLabel} reached={reached} onJump={go} />
      {aside ? (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            {body}
            {actions}
          </div>
          <aside className="space-y-4">{aside}</aside>
        </div>
      ) : (
        <>
          {body}
          {actions}
        </>
      )}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  count,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="flex justify-between text-sm font-medium">
        {label}
        {count ? (
          <span className="font-mono text-[11px] font-normal text-muted">{count}</span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="m-0 mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Row({ a, b }: { a: string; b: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{a}</dt>
      <dd className="m-0 text-right font-mono text-ink">{b}</dd>
    </div>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-[150px_1fr]">
      {rows.map(([a, b]) => (
        <div key={a} className="contents">
          <dt className="text-muted">{a}</dt>
          <dd className="m-0 text-ink">{b}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewBlock({
  n,
  title,
  edit,
  children,
}: {
  n: string;
  title: string;
  edit: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
        <span className="flex items-center gap-3">
          <Square tone="ok">✓</Square>
          <span className="font-mono text-[11px] text-muted">{n}</span>
          <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        </span>
        {edit}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function FileSummary({ info, uncovered }: { info: FileInfo; uncovered: string[] }) {
  const h = info.header;
  return (
    <div className="space-y-3" data-testid="file-summary">
      <div className="flex items-center gap-4 rounded-card border border-line bg-inset p-4">
        <span className="grid h-11 w-11 place-items-center rounded-ctl border border-accent-line bg-accent-bg text-accent">
          <FileIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm text-ink">{info.file.name}</div>
          <div className="truncate font-mono text-[12px] text-muted">
            {bytesLabel(info.file.size)} · sha256 {info.sha.slice(0, 6)}…{info.sha.slice(-6)} ·
            v1.0.0
          </div>
        </div>
      </div>
      {h ? (
        <>
          <div className="grid gap-2 text-[12px] sm:grid-cols-3">
            <Check ok={Boolean(h.name)} text={h.name ? `@name ${h.name}` : 'No @name line'} />
            <Check
              ok={h.matches.length > 0 && uncovered.length === 0}
              text={
                uncovered.length
                  ? `@match misses ${uncovered.join(', ')}`
                  : h.matches.length
                    ? `@match: ${h.matches.length} line${h.matches.length === 1 ? '' : 's'}`
                    : 'No @match line'
              }
            />
            <Check ok text={h.grants.length ? `@grant ${h.grants.join(', ')}` : '@grant none'} />
          </div>
          <p className="m-0 text-[12px] text-muted">
            Pre-checked in your browser from the script header. The full review runs on submit.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-ctl border px-3 py-2 ${ok ? 'border-line-soft text-ink-2' : 'border-warn-line text-warn'}`}
    >
      <span className={ok ? 'text-accent' : 'text-warn'}>
        {ok ? <CheckIcon className="h-3 w-3" /> : '!'}
      </span>
      <span className="truncate">{text}</span>
    </span>
  );
}
