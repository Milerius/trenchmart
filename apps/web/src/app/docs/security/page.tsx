import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Security · TrenchMart docs' };

export default function SecurityDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Security"
        title="What is checked"
        lede="Uploads are scanned before they go live, downloads are watermarked, and the API cannot spend the vault."
      />
      <DocSection id="uploads" title="Uploads">
        <p>
          {protocol.scannerEngine} fails closed on a bad userscript header, wide match patterns,
          obfuscation, and network calls the header did not declare. Remote scripts have to come
          from {protocol.allowHosts.join(', ')}. A sandbox failure or a wallet signing call is
          rejected by {protocol.aiAgentId}. The same file hash cannot be published by a second
          creator.
        </p>
      </DocSection>
      <DocSection id="money" title="Payments">
        <p>
          Amounts are integer lamports. A payment settles only when the transfer matches the order
          total, the memo, the buyer, and the vault, inside the expiry plus{' '}
          {protocol.paymentGraceMinutes} minutes of grace. The cluster guard refuses a mainnet RPC
          URL. Wallet sign-in is a message signature, not a transaction.
        </p>
      </DocSection>
      <DocSection id="downloads" title="Downloads and sessions">
        <p>
          Downloads require a released order and a license for that wallet. The signed URL expires
          after {protocol.downloadUrlSeconds} seconds. The session cookie is httpOnly. Download logs
          store a hash of the IP, not the raw address. Private keys and seed phrases are not
          collected.
        </p>
      </DocSection>
      <DocSection id="prohibited" title="Prohibited tools">
        <p>
          Malware, drainers, wallet stealers, and tools that sign or move funds without the action
          the listing described are not allowed. An upheld malicious dispute delists the listing and
          bans the creator.
        </p>
      </DocSection>
    </article>
  );
}
