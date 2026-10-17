'use client';

import { useState } from 'react';
import { Panel } from '@/components/ui';
import { api } from '@/lib/api';

export default function VerifyPage() {
  const [result, setResult] = useState<{ match: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError('');
    setResult(null);
    setBusy(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      setResult(
        await api<{ match: boolean; message: string }>('/verify', {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, contentBase64: btoa(binary) }),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="m-0 text-[32px]">Verify a file</h1>
        <p className="m-0 mt-2 text-ink-2">
          Drop a file you downloaded. A match means the bytes are exactly a version that passed AI
          verification. Nothing is stored.
        </p>
      </div>
      <label
        htmlFor="verify-file"
        className="flex cursor-pointer flex-col items-center gap-2 rounded-panel border border-dashed border-line-control bg-inset px-6 py-12 text-center hover:border-accent-line"
      >
        <span className="text-base font-semibold">
          {busy ? 'Checking…' : 'Choose a file to check'}
        </span>
        <span className="text-[13px] text-muted">
          We compare its SHA-256 with every reviewed version.
        </span>
        <input
          id="verify-file"
          type="file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file).catch((err: Error) => setError(err.message));
          }}
        />
      </label>
      {result ? (
        <Panel tone={result.match ? 'ok' : 'warn'} role="status" className="p-4 text-sm">
          <p className="m-0 font-semibold">{result.match ? '✓ Match' : 'No match'}</p>
          <p className="m-0 mt-1 text-ink-2">{result.message}</p>
        </Panel>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
