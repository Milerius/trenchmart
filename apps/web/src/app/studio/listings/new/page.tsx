'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { solToLamports } from '@trenchmart/shared';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

export default function NewListingPage() {
  const wallet = useWallet();
  const router = useRouter();
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lamports = solToLamports(String(data.get('price') ?? '0')).toString();
    const created = await api<{ id: string }>('/studio/listings', {
      method: 'POST',
      body: JSON.stringify({
        title: String(data.get('title') ?? ''),
        summary: String(data.get('summary') ?? ''),
        description: String(data.get('description') ?? ''),
        category: String(data.get('category') ?? 'userscript'),
        priceLamports: lamports,
        terminals: String(data.get('terminals') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      router.push('/studio');
      return;
    }
    const version = await api<{ versionId: string; uploadUrl: string }>(
      `/studio/listings/${created.id}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          semver: '1.0.0',
          changelog: 'initial',
          fileName: file.name,
          fileSize: file.size,
        }),
      },
    );
    const target = new URL(version.uploadUrl, window.location.origin);
    const put = await fetch(`${target.pathname}${target.search}`, {
      method: 'PUT',
      body: file,
      credentials: 'include',
    });
    if (!put.ok) throw new Error('upload failed');
    router.push(`/studio/listings/${created.id}/versions/${version.versionId}`);
  }

  if (!wallet.session) return <p>Connect a wallet first.</p>;

  return (
    <form
      data-testid="studio"
      className="mx-auto max-w-xl space-y-3"
      onSubmit={(event) => void submit(event).catch((err: Error) => setMessage(err.message))}
    >
      <h1 className="text-3xl">New listing</h1>
      <input
        name="title"
        required
        minLength={3}
        placeholder="Title"
        className="w-full rounded-md border border-line bg-inset px-3 py-2"
      />
      <input
        name="summary"
        required
        minLength={3}
        placeholder="Summary"
        className="w-full rounded-md border border-line bg-inset px-3 py-2"
      />
      <textarea
        name="description"
        required
        placeholder="Description"
        className="w-full rounded-md border border-line bg-inset px-3 py-2"
      />
      <select name="category" className="w-full rounded-md border border-line bg-inset px-3 py-2">
        {['userscript', 'wallet_list', 'filter', 'setup', 'strategy', 'alerts'].map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <input
        name="price"
        required
        placeholder="Price in SOL"
        className="w-full rounded-md border border-line bg-inset px-3 py-2"
      />
      <input
        name="terminals"
        placeholder="Terminals, comma separated"
        className="w-full rounded-md border border-line bg-inset px-3 py-2"
      />
      <input name="file" type="file" className="w-full text-sm" />
      <button type="submit" className="rounded-md bg-accent px-4 py-2 text-onaccent">
        Create
      </button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}
