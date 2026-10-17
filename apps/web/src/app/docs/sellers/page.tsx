import type { Metadata } from 'next';
import { DocHeader, DocSection, FactGrid } from '@/components/doc';
import { VerificationDiagram } from '@/components/diagrams';
import { bonds, protocol, versionEdges } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Sellers · TrenchMart docs' };

export default function SellersDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Sellers"
        title="List a tool"
        lede="You keep the list price. Buyers pay the fee. Every version is scanned before it can go live, and a creator bond backs an upheld dispute."
      />
      <FactGrid
        facts={[
          { testId: 'seller-vfee', label: 'Verification fee', text: protocol.verificationFee },
          {
            testId: 'seller-vfee-free',
            label: 'Fee waived from',
            text: protocol.verificationFeeFreeFrom,
          },
          {
            testId: 'seller-commission',
            label: 'Creator commission',
            text: protocol.creatorCommission,
          },
          {
            testId: 'seller-unlock',
            label: 'Bond unlock',
            text: `${protocol.bondUnlockDays} days`,
          },
        ]}
      />
      <DocSection id="bond" title="Bond by category">
        <p>
          The bond is the highest amount among the categories you list. A new creator still has to
          meet at least the cheapest category. OG holders pay {protocol.ogBondDiscount} of the bond.
          It is a vault transfer with memo <span className="font-mono text-ink">bond:</span>. After
          a release request, the unlock wait is {protocol.bondUnlockDays} days. An upheld dispute
          can slash it.
        </p>
        <ul className="m-0 grid gap-2 p-0 sm:grid-cols-2">
          {bonds.map((bond) => (
            <li
              key={bond.code}
              data-testid={`bond-${bond.code}`}
              className="list-none rounded-card border border-line bg-surface px-4 py-3 text-ink"
            >
              <span className="font-semibold">{bond.label}</span>
              <span className="mt-1 block font-mono text-sm text-ink-2">
                {bond.sol}
                <span className="text-muted"> · OG {bond.ogSol}</span>
              </span>
            </li>
          ))}
        </ul>
      </DocSection>
      <DocSection id="fee" title="Verification fee">
        <p>
          Each version quotes {protocol.verificationFee} unless your tier is{' '}
          {protocol.verificationFeeFreeFrom} or higher. The transfer uses memo{' '}
          <span className="font-mono text-ink">vfee:</span>. The whole fee is paid to the
          verification bucket. A version cannot finish review until that fee is recorded or waived.
        </p>
      </DocSection>
      <DocSection id="upload" title="Upload">
        <p>
          Files default to {protocol.maxFileDefault}. Setup files can be {protocol.maxFileSetup}.
          The sha256 is stored on the version. If another creator already uploaded those exact
          bytes, the upload is rejected. Userscript remote scripts are limited to{' '}
          {protocol.allowHosts.join(', ')}.
        </p>
      </DocSection>
      <DocSection id="scan" title="Scanning and verdicts">
        <p>
          The static scanner ({protocol.scannerEngine}) is the malware screen. Any failing check
          summarizes to fail, any warning to warn, otherwise pass. Userscripts, and alert files
          whose name ends in .js, also run in a sandbox. A sandbox failure or any wallet signing
          call is a reject.
        </p>
        <p>
          {protocol.aiAgentId} ({protocol.aiEngine}) then decides. The rules engine (
          {protocol.rulesEngine}) gives a verdict, and an LLM ({protocol.aiModel}) reads your file
          against the listing and gives its own. The stricter verdict wins: the model can turn an
          approval into request_changes or reject, never the reverse. If the model is unavailable,
          the rules verdict stands and the report says so. A failing check rejects the version.
          Warnings need a creator note of at least 20 characters that is not a trivial reply such as
          “ok” or “lgtm”; otherwise the verdict is request_changes. A clean file is approved. There
          is no human reviewer. An approval carries an HMAC attestation over the version id, sha256,
          decision, and time.
        </p>
        <p>Version status moves only along these edges.</p>
        <ul data-testid="version-edges" className="m-0 grid gap-1 p-0 font-mono text-sm text-ink">
          {versionEdges.map((edge) => (
            <li key={`${edge.from}-${edge.to}`} className="list-none">
              {edge.from} → {edge.to}
            </li>
          ))}
        </ul>
      </DocSection>
      <DocSection id="payouts" title="Payouts">
        <p>
          After release, a payout row pays your wallet the list price. Fee buckets are separate
          rows. Pending payouts are grouped into batches of at most {protocol.payoutBatchLimit}{' '}
          transfers, written to object storage, and marked proposed. Signers execute the Squads
          proposal. The API does not hold a key that can move the vault.
        </p>
      </DocSection>
      <VerificationDiagram />
    </article>
  );
}
