'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ContentTabs,
  GalleryEditor,
  imageProblem,
  MAX_IMAGES,
  mediaPath,
  type GalleryItem,
} from '@/components/content-editor';
import { CATEGORIES, defaultUpdatePrice, solToLamports } from '@trenchmart/shared';
import { Button, Label, Money, Panel, Square } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { solExact } from '@/lib/money';
import { payVerificationFee, type UnsignedTx } from '@/lib/studio';
import { templateFor, type ContentField } from '@/lib/listing-templates';
import { useWallet } from '@/lib/wallet';

const INPUT =
  'mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm placeholder:text-faint';

function lamportsOf(value: string): bigint | null {
  try {
    return value.trim() ? solToLamports(value.trim()) : null;
  } catch {
    return null;
  }
}

export default function NewListingPage() {
  const wallet = useWallet();
  const router = useRouter();
  const centsPerSol = useSolUsd();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [price, setPrice] = useState('');
  const config = usePublicConfig();
  // null until the seller edits it: the field then follows the suggested 10% of the price.
  const [updatePrice, setUpdatePrice] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]!.code);
  const [text, setText] = useState<Record<ContentField, string>>(() =>
    templateFor(CATEGORIES[0]!.code),
  );
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [imageMessage, setImageMessage] = useState('');

  function changeCategory(next: string) {
    const before = templateFor(category);
    const after = templateFor(next);
    // Untouched sections follow the new category's template; edited ones are kept.
    setText((current) => {
      const updated = { ...current };
      for (const key of Object.keys(updated) as ContentField[]) {
        if (current[key] === before[key]) updated[key] = after[key];
      }
      return updated;
    });
    setCategory(next);
  }

  function addImages(files: File[]) {
    setImageMessage('');
    const room = MAX_IMAGES - images.length;
    const picked: GalleryItem[] = [];
    for (const file of files.slice(0, room)) {
      const problem = imageProblem(file);
      if (problem) {
        setImageMessage(problem);
        continue;
      }
      // A real UUID, so the Markdown preview accepts it as a media path until the upload swaps it.
      picked.push({ id: crypto.randomUUID(), url: URL.createObjectURL(file), alt: '', file });
    }
    if (files.length > room) setImageMessage(`Up to ${MAX_IMAGES} images.`);
    setImages((list) => [...list, ...picked]);
    setCover((value) => value ?? picked[0]?.id ?? null);
  }

  function removeImage(id: string) {
    setImages((list) => list.filter((image) => image.id !== id));
  }

  /** Uploads picked images, swaps their ids in the Markdown, saves the page and submits it. */
  async function saveContent(listingId: string) {
    const ids = new Map<string, string>();
    const gallery: { imageId: string; alt: string }[] = [];
    for (const [index, image] of images.entries()) {
      if (!image.file) continue;
      setBusy(`Uploading image ${index + 1} of ${images.length}…`);
      const saved = await api<{ id: string }>(`/studio/listings/${listingId}/images`, {
        method: 'POST',
        headers: { 'content-type': image.file.type },
        body: image.file,
      });
      ids.set(image.id, saved.id);
      gallery.push({ imageId: saved.id, alt: image.alt });
    }
    const swap = (value: string) =>
      [...ids].reduce(
        (out, [temp, real]) => out.split(mediaPath(temp)).join(mediaPath(real)),
        value,
      );
    const page = {
      readme: swap(text.readme),
      howto: swap(text.howto),
      requirements: swap(text.requirements),
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

  const updateBps = config?.updatePriceDefaultBps ?? 1000;
  const suggestedUpdate = (() => {
    const value = lamportsOf(price);
    return value === null ? '' : solExact(defaultUpdatePrice(value, updateBps));
  })();
  const updateField = updatePrice ?? suggestedUpdate;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const data = new FormData(event.currentTarget);
    const lamports = solToLamports(String(data.get('price') ?? '0')).toString();
    setBusy('Creating listing…');
    const created = await api<{ id: string }>('/studio/listings', {
      method: 'POST',
      body: JSON.stringify({
        title: String(data.get('title') ?? ''),
        summary: String(data.get('summary') ?? ''),
        description: String(data.get('description') ?? ''),
        category: String(data.get('category') ?? 'userscript'),
        priceLamports: lamports,
        updatePriceLamports: solToLamports(updateField || '0').toString(),
        terminals: String(data.get('terminals') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    await saveContent(created.id);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      router.push('/studio');
      return;
    }
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
      // Over the daily upload limit: the upload page shows the supplement before paying.
      if (err instanceof ApiError && err.code === 'SUPPLEMENT_REQUIRED') {
        router.push(`/studio/listings/${created.id}/versions/new`);
        return;
      }
      throw err;
    }
    if (version.feeTx) {
      // Pay while the fee transaction's blockhash is fresh. /complete refuses an unpaid fee.
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

  const lamports = lamportsOf(price);

  return (
    <form
      data-testid="studio"
      className="grid items-start gap-8 lg:grid-cols-[1fr_360px]"
      onSubmit={(event) =>
        void submit(event).catch((err: Error) => {
          setBusy('');
          setMessage(err.message);
        })
      }
    >
      <div className="min-w-0 space-y-6">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[32px] font-semibold tracking-[-0.03em]">New listing</h1>
          <p className="m-0 mt-1 text-ink-2">
            Describe it, add screenshots and an install guide, set a price, drop the file. Automated
            review starts the moment it uploads.
          </p>
        </div>

        <div className="space-y-4 rounded-panel border border-line bg-surface p-5">
          <Field label="Title" htmlFor="title">
            <input
              id="title"
              name="title"
              required
              minLength={3}
              maxLength={120}
              placeholder="Bundle Detector Overlay"
              className={INPUT}
            />
          </Field>
          <Field label="Summary" htmlFor="summary" hint="One line buyers see on the card.">
            <input
              id="summary"
              name="summary"
              required
              minLength={3}
              maxLength={280}
              placeholder="Flags bundled launches on Axiom"
              className={INPUT}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="description"
            hint="Buyers compare the file with this, and the review checks its declared permissions, so say exactly what it does."
          >
            <textarea id="description" name="description" required rows={5} className={INPUT} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="category">
              <select
                id="category"
                name="category"
                value={category}
                onChange={(event) => changeCategory(event.target.value)}
                className={INPUT}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.code} value={cat.code}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Terminals"
              htmlFor="terminals"
              hint="Comma separated: Axiom, GMGN, Photon, Terminal, Trojan, or Any."
            >
              <input id="terminals" name="terminals" placeholder="Axiom, GMGN" className={INPUT} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Price (SOL)" htmlFor="price">
              <input
                id="price"
                name="price"
                required
                inputMode="decimal"
                placeholder="1.20"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className={`${INPUT} font-mono`}
              />
            </Field>
            <Field
              label="Monthly update price (SOL)"
              htmlFor="update-price"
              hint={`Buyers get updates free for ${config?.updateFreeDays ?? 30} days, then pay this per month. Suggested ${updateBps / 100}% of the price; 0 means free updates forever.`}
            >
              <input
                id="update-price"
                name="updatePrice"
                inputMode="decimal"
                placeholder="0.12"
                value={updateField}
                onChange={(event) => setUpdatePrice(event.target.value)}
                className={`${INPUT} font-mono`}
              />
            </Field>
          </div>
        </div>

        <GalleryEditor
          images={images}
          setImages={setImages}
          cover={cover}
          setCover={setCover}
          onFiles={addImages}
          onRemove={removeImage}
          note={
            imageMessage ? (
              <p role="alert" className="m-0 text-sm text-danger">
                {imageMessage}
              </p>
            ) : null
          }
        />

        <ContentTabs
          text={text}
          setText={setText}
          gallery={images}
          previews={Object.fromEntries(images.map((image) => [image.id, image.url]))}
          intro={
            <p data-testid="template-note" className="m-0 px-5 pt-3 text-[13px] text-ink-2">
              Started from the{' '}
              <span className="text-ink">
                {CATEGORIES.find((cat) => cat.code === category)?.label}
              </span>{' '}
              template. Replace the [bracketed] parts; everything is yours to edit.
            </p>
          }
          actions={(key) => (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={text[key] === templateFor(category)[key]}
                onClick={() =>
                  setText((value) => ({ ...value, [key]: templateFor(category)[key] }))
                }
              >
                Reset to template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!text[key]}
                onClick={() => setText((value) => ({ ...value, [key]: '' }))}
              >
                Start blank
              </Button>
            </>
          )}
        />

        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-10 text-center hover:border-accent-line"
        >
          <span className="text-base font-semibold">
            {fileName || 'Drop your file here, or browse'}
          </span>
          <span className="text-[13px] text-muted">
            .user.js, .json, .csv or .zip · up to 5 MB (25 MB for setups)
          </span>
          <input
            id="file"
            name="file"
            type="file"
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!!busy} aria-busy={!!busy || undefined}>
            {busy || 'Create and start review'}
          </Button>
          {message ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {message}
            </p>
          ) : null}
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="rounded-panel border border-line bg-surface p-5">
          <Label>You receive per sale</Label>
          <div className="mt-1 text-xl font-semibold">
            {lamports !== null ? (
              <Money lamports={lamports} centsPerSol={centsPerSol} strong />
            ) : (
              '—'
            )}
          </div>
          <p className="m-0 mt-2 text-[13px] text-ink-2">
            100% of your price. 0% creator commission. Buyers pay a 5% fee on top, cut by their
            $TRENCH tier.
          </p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <Label>What happens next</Label>
          <ol className="m-0 mt-3 space-y-3 p-0 text-sm">
            {[
              ['Static checks', 'eval, remote code, key access, hosts'],
              ['Sandbox run', 'isolated, network and wallet calls logged'],
              ['AI verdict', 'rules engine plus LLM; the stricter wins'],
              ['Listing page', 'images and links checked; warnings need a note'],
            ].map(([title, detail], index) => (
              <li key={title} className="flex list-none gap-3">
                <Square>{index + 1}</Square>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="block text-[13px] text-muted">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-4 text-[13px] text-ink-2">You watch each step live. No queue.</p>
        </div>
        <Panel tone="info" className="p-4 text-[13px] text-ink-2">
          Your listing goes live the moment it passes. Buyers see the checks and the file hash.
        </Panel>
      </aside>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
