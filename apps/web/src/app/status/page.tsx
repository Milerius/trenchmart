import type { Metadata } from 'next';
import { StatusBoard } from '@/components/status';

export const metadata: Metadata = {
  title: 'System status · TrenchMart',
  description:
    'Live health and speed of the TrenchMart website, API, Solana devnet RPC, escrow, database, uploads and sign-in, with 90 days of uptime and incident history.',
};

export default function StatusPage() {
  return <StatusBoard />;
}
