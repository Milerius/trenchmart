import type { Metadata } from 'next';
import { DocHeader, DocSection, FactGrid } from '@/components/doc';
import { FeeFlowDiagram } from '@/components/diagrams';
import { formatTrench } from '@trenchmart/shared/tier';
import { bonds, feeSplit, protocol, tierRows } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Fees · TrenchMart docs' };

export default function FeesDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Fees"
        title="What a purchase costs"
        lede="Buyers pay the marketplace fee on top of the price. Creators pay no commission. Basis points and bonds below are the seeded config."
      />
      <FactGrid
        facts={[
          {
            testId: 'fee-marketplace',
            label: 'Marketplace fee',
            text: protocol.marketplaceFeeLabel,
          },
          {
            testId: 'fee-commission',
            label: 'Creator commission',
            text: protocol.creatorCommission,
          },
          { testId: 'fee-verification', label: 'Verification fee', text: protocol.verificationFee },
          { testId: 'fee-og-bond', label: 'OG bond discount', text: protocol.ogBondDiscount },
          {
            testId: 'fee-upload-supplement',
            label: 'Upload supplement',
            text: protocol.uploadSupplement,
          },
          {
            testId: 'fee-verify-supplement',
            label: 'Verify supplement',
            text: protocol.verifySupplement,
          },
        ]}
      />
      <DocSection id="split" title="Where the fee goes">
        <p>
          The fee is floor-divided in lamports. The tier rebate is floor-divided from that fee. The
          remainder is the net fee. Each bucket takes its basis points of the net fee, and any
          rounding dust is added to ops so the parts sum to the net fee. The verification fee is not
          split: it is paid in full to the verification bucket.
        </p>
        <ul className="m-0 grid gap-2 p-0 sm:grid-cols-2">
          {feeSplit.map((row) => (
            <li
              key={row.key}
              data-testid={`fee-split-${row.key}`}
              className="list-none rounded-card border border-line bg-surface px-4 py-3"
            >
              <span className="font-semibold text-ink">{row.label}</span>
              <span className="mt-1 block font-mono text-sm text-accent">{row.percent}</span>
            </li>
          ))}
        </ul>
        <FeeFlowDiagram />
      </DocSection>
      <DocSection id="tiers" title="Tier rebates">
        <p>
          The rebate is a discount on the fee, not on the price. Scout needs{' '}
          {formatTrench(protocol.thresholds.scout)}, Trencher{' '}
          {formatTrench(protocol.thresholds.trencher)}, and OG{' '}
          {formatTrench(protocol.thresholds.og)}. The tier uses the lowest balance held during the
          last {protocol.tierWindowHours} hours.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Buyer fee by tier</caption>
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  Tier
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Rebate
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Buyer fee
                </th>
              </tr>
            </thead>
            <tbody>
              {tierRows.map((row) => (
                <tr
                  key={row.tier}
                  className="border-t border-line-soft"
                  data-testid={`tier-${row.tier}`}
                >
                  <th scope="row" className="px-4 py-2 font-medium text-ink">
                    {row.label}
                  </th>
                  <td className="px-4 py-2 font-mono">{row.rebateLabel}</td>
                  <td className="px-4 py-2 font-mono text-ink">{row.buyerFee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSection>
      <DocSection id="supplements" title="Updates and supplements">
        <p>
          Update renewals cost the seller&apos;s monthly update price plus the{' '}
          {protocol.marketplaceFeeLabel} marketplace fee, with the same tier rebates as a purchase.
          The seller receives the update price; the net fee is split as above.
        </p>
        <p>
          Supplements are flat SOL amounts set in config: {protocol.uploadSupplement} per upload
          beyond {protocol.updatesPerListingPerDay} update per listing or{' '}
          {protocol.uploadsPerCreatorPerDay} uploads per creator in a UTC day, and{' '}
          {protocol.verifySupplement} per file verification beyond {protocol.verifyFreePerDay} free
          per day. Both are split across the fee buckets.
        </p>
      </DocSection>
      <DocSection id="bonds" title="Bonds">
        <ul className="m-0 grid gap-2 p-0 sm:grid-cols-2">
          {bonds.map((bond) => (
            <li key={bond.code} className="list-none text-ink">
              {bond.label}: {bond.sol} ({bond.ogSol} for OG)
            </li>
          ))}
        </ul>
      </DocSection>
    </article>
  );
}
