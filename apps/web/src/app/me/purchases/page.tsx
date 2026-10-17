'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { moneyText } from '@/lib/money';
import { useWallet } from '@/lib/wallet';

type Order = {
  id: string;
  title: string;
  slug: string;
  status: string;
  escrow_until: string | null;
  amount: { lamports: string; usdCents: string | null };
};

export default function PurchasesPage() {
  const wallet = useWallet();
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!wallet.session) return;
    void api<{ orders: Order[] }>('/me/orders')
      .then((body) => setOrders(body.orders))
      .catch((err: Error) => setMessage(err.message));
  }, [wallet.session]);

  async function download(id: string) {
    try {
      const result = await api<{ url: string }>(`/orders/${id}/download`, { method: 'POST' });
      window.location.href = result.url;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'download locked');
    }
  }

  if (!wallet.session) return <p>Connect a wallet to see purchases.</p>;

  return (
    <section data-testid="dashboard">
      <h1 className="text-3xl">Purchases</h1>
      <p className="mt-2 text-sm text-muted">
        Amounts are the real lamport totals, with a USD equivalent beside them. Downloads stay
        locked until escrow releases.
      </p>
      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th>Item</th>
            <th>Paid</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-t border-line">
              <td className="py-2">
                <Link href={`/l/${order.slug}`}>{order.title}</Link>
              </td>
              <td className="font-mono">
                {moneyText(order.amount.lamports, order.amount.usdCents)}
              </td>
              <td>{order.status}</td>
              <td className="space-x-3">
                <button type="button" className="underline" onClick={() => void download(order.id)}>
                  Download
                </button>
                <Link href={`/me/purchases/${order.id}/dispute`}>Dispute</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 ? <p className="mt-4 text-muted">No purchases yet.</p> : null}
      {message ? <p className="mt-4">{message}</p> : null}
    </section>
  );
}
