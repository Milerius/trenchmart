'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export default function VerifyPage() {
  const [message, setMessage] = useState('');

  async function onFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const result = await api<{ match: boolean; message: string }>('/verify', {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentBase64: btoa(binary) }),
    });
    setMessage(result.message);
  }

  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-3xl">Verify a file</h1>
      <p className="text-sm text-muted">
        Drop a file you downloaded. A match means the bytes are a reviewed version.
      </p>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file).catch((err: Error) => setMessage(err.message));
        }}
      />
      {message ? <p>{message}</p> : null}
    </section>
  );
}
