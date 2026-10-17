import type { Metadata } from 'next';
import { DocHeader, DocSection, FactGrid } from '@/components/doc';
import { PurchaseDiagram } from '@/components/diagrams';
import { DISPUTE_REASONS, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Buyers · TrenchMart docs' };

const REASON_LABEL: Record<(typeof DISPUTE_REASONS)[number], string> = {
  malicious: 'Malicious or unsafe',
  not_as_described: 'Not as described',
  broken: 'Broken or changed',
  other: 'Something else',
};

export default function BuyersDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Buyers"
        title="Buy into escrow"
        lede="You pay the list price plus the marketplace fee. The seller is paid only after the escrow window, and the file stays locked until then."
      />
      <FactGrid
        facts={[
          {
            testId: 'buyer-escrow-hours',
            label: 'Escrow window',
            text: `${protocol.escrowHours} hours`,
          },
          {
            testId: 'buyer-order-ttl',
            label: 'Payment window',
            text: `${protocol.orderTtlMinutes} minutes`,
          },
          {
            testId: 'buyer-grace',
            label: 'Payment grace',
            text: `${protocol.paymentGraceMinutes} minutes`,
          },
          {
            testId: 'buyer-malicious-days',
            label: 'Malicious dispute',
            text: `${protocol.maliciousDisputeDays} days`,
          },
        ]}
      />
      <DocSection id="browse" title="Browse">
        <p>
          Listings appear when they have a live version and are not paused or delisted. Holder-only
          listings require a Scout tier or higher. A holder-only early window blocks wallets with no
          tier until that window ends. You cannot buy your own listing, and a wallet that already
          holds a license for it is rejected.
        </p>
      </DocSection>
      <DocSection id="pay" title="Pay">
        <p>
          Checkout creates a pending order and an unsigned transfer of the total to the Squads
          vault, with memo <span className="font-mono text-ink">tm:</span> plus the first eight
          characters of the order id. The order expires after {protocol.orderTtlMinutes} minutes. A
          matching transfer can still settle for {protocol.paymentGraceMinutes} minutes after that.
          The amount, memo, source, and vault must match. Overpayment and underpayment do not
          settle.
        </p>
      </DocSection>
      <DocSection id="window" title="Escrow window">
        <p>
          A settled order is paid. Release waits until {protocol.escrowHours} hours after payment,
          and only when the payment transaction is finalized and no dispute is open. The seller
          receives the list price. The net fee is split across buyback, AI verification, ops, and
          safety.
        </p>
      </DocSection>
      <DocSection id="disputes" title="Refunds and disputes">
        <p>
          While the order is paid and the window has not ended, you can open a dispute for{' '}
          {DISPUTE_REASONS.map((reason) => REASON_LABEL[reason]).join(', ')}. A malicious dispute
          can also be opened up to {protocol.maliciousDisputeDays} days after payment, including
          after release. Opening a dispute pauses release.
        </p>
        <p>
          If the dispute is upheld, you are refunded the total you paid. When the order was still
          paid, that refund is debited from the vault ledger. When it was already released, the
          refund is taken from the creator bond and then from the safety bucket. An upheld malicious
          dispute delists the listing, delists its live and superseded versions, bans the creator,
          and slashes the bond. A rejected dispute returns the order to the status it had before the
          dispute.
        </p>
      </DocSection>
      <DocSection id="download" title="Download integrity">
        <p>
          The download route accepts the order only when its status is released and a license exists
          for your wallet. The file is watermarked with the order id, your wallet, and the version
          sha256, then stored and handed out through a signed URL that lasts{' '}
          {protocol.downloadUrlSeconds} seconds. The version hash is checked on upload, and the same
          bytes cannot be listed by a different creator. The public verify page matches a file you
          already have against that hash.
        </p>
      </DocSection>
      <PurchaseDiagram />
    </article>
  );
}
