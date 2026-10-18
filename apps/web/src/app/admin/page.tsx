'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FeaturingAdmin } from '@/components/featuring-admin';
import { ReviewModeration } from '@/components/review-moderation';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

type Dispute = { id: string; order_id: string; reason: string; details: string; status: string };

export default function AdminPage() {
  const wallet = useWallet();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!wallet.session?.roles.includes('admin')) return;
    void api<Dispute[]>('/admin/disputes')
      .then(setDisputes)
      .catch((err: Error) => setMessage(err.message));
  }, [wallet.session]);

  async function resolve(id: string, status: 'upheld' | 'rejected') {
    await api(`/admin/disputes/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        resolution: status === 'upheld' ? 'Upheld by admin' : 'Rejected by admin',
      }),
    });
    setDisputes((current) => current.filter((row) => row.id !== id));
  }

  if (!wallet.session) return <p>Connect an admin wallet.</p>;
  if (!wallet.session.roles.includes('admin')) return <p>This wallet is not an admin.</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-3xl">Admin</h1>
      <Link href="/admin/status" className="text-sm underline" data-testid="admin-status-link">
        System status
      </Link>
      <ul className="space-y-3">
        {disputes.map((dispute) => (
          <li key={dispute.id} className="rounded-xl border border-line p-4">
            <p>
              {dispute.reason} · {dispute.details}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-md border border-line px-3 py-1"
                onClick={() => void resolve(dispute.id, 'upheld')}
              >
                Uphold
              </button>
              <button
                type="button"
                className="rounded-md border border-line px-3 py-1"
                onClick={() => void resolve(dispute.id, 'rejected')}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
        {disputes.length === 0 ? <li className="text-muted">No open disputes.</li> : null}
      </ul>
      {message ? <p>{message}</p> : null}
      <ReviewModeration />
      <FeaturingAdmin />
    </section>
  );
}
