import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { formatTrench } from '@trenchmart/shared';
import { protocol, tierRows } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: '$TRENCH · TrenchMart docs' };

export default function TokenDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="$TRENCH"
        title="Holder tiers"
        lede="Holding $TRENCH can lower the buyer fee, waive the verification fee, and discount a creator bond. It is not equity and it is not a promise of profit."
      />
      <DocSection id="tiers" title="Tiers">
        <p>
          A tier is the lowest balance observed during the last {protocol.tierWindowHours} hours,
          compared with the configured thresholds: Scout {formatTrench(protocol.thresholds.scout)},
          Trencher {formatTrench(protocol.thresholds.trencher)}, and OG{' '}
          {formatTrench(protocol.thresholds.og)} (of a 1,000,000,000 supply). Balances are read from
          the $TRENCH mint on Solana devnet when you sign in and re-checked at most every five
          minutes when you get a quote.
        </p>
        <ul className="m-0 grid gap-2 p-0">
          {tierRows.map((row) => (
            <li key={row.tier} className="list-none rounded-card border border-line bg-surface p-4">
              <span className="font-semibold text-ink">{row.label}</span>
              <span className="mt-1 block">
                Buyer fee {row.buyerFee}. Rebate {row.rebateLabel}.
                {row.threshold ? ` Hold at least ${formatTrench(row.threshold)}.` : ''}
              </span>
            </li>
          ))}
        </ul>
      </DocSection>
      <DocSection id="benefits" title="What a tier changes">
        <p>Scout, Trencher, and OG reduce the buyer fee by the rebate in the table above.</p>
        <p>Trencher and OG skip the {protocol.verificationFee} verification fee on each version.</p>
        <p>OG pays {protocol.ogBondDiscount} of the category bond.</p>
        <p>
          A listing marked holder-only can be bought only by Scout or higher. A holder-only early
          window hides the buy button from wallets with no tier until that many hours after the
          listing first went live.
        </p>
      </DocSection>
      <DocSection id="not-an-investment" title="What the token is not">
        <p>
          $TRENCH does not represent a share of TrenchMart, a claim on fees, or a right to have the
          token bought back at any price. The buyback bucket is a destination for part of the
          marketplace fee. Nothing on this site promises that the token will rise, that a holder
          will be paid yield, or that a purchase of the token is an investment.
        </p>
      </DocSection>
    </article>
  );
}
