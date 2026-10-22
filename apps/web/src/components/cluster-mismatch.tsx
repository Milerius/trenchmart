// Server component: always in the HTML, hidden until the wallet provider marks
// <html data-cluster-mismatch> (lib/wallet.tsx). No client JS.
import Link from 'next/link';
import { CLUSTER } from '@/lib/cluster';

/** Amber banner when the connected wallet is not on this site's cluster; payments are blocked. */
export function ClusterMismatchBanner() {
  const devnet = CLUSTER.id === 'devnet';
  return (
    <div
      role="alert"
      data-testid="cluster-mismatch"
      className="hidden border-b border-warn bg-warn-bg px-4 py-2.5 text-center text-sm text-warn sm:px-6 [[data-cluster-mismatch]_&]:block"
    >
      <span aria-hidden="true">⚠ </span>
      Your wallet is not on Solana <b>{CLUSTER.label}</b>, but this site is. Payments are blocked
      until you switch.
      {devnet ? ' Phantom: Settings → Developer Settings → Testnet Mode → Solana Devnet.' : ''}{' '}
      <Link href="/docs/buyers" className="text-ink underline">
        How?
      </Link>
    </div>
  );
}
