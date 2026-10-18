import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { Serif } from '@/components/ui';
import { PurchaseDiagram } from '@/components/diagrams';
import { CONTACT_LABEL, CONTACT_URL, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Docs · TrenchMart' };

export default function DocsOverviewPage() {
  return (
    <article>
      <DocHeader
        kicker="Protocol"
        title={
          <>
            How TrenchMart <Serif>works</Serif>
          </>
        }
        lede="A non-custodial Solana marketplace for trading tools. Buyers pay into escrow, sellers post a bond, and automated checks review every upload."
      />
      <DocSection id="flow" title="The purchase flow">
        <PurchaseDiagram />
      </DocSection>
      <DocSection id="where" title="Where the figures come from">
        <p>
          The numbers on these pages are the seeded defaults in the shared config. A deployed config
          row can override them. Checkout uses the Anchor escrow program{' '}
          <span className="break-all font-mono text-ink">{protocol.programId}</span> on{' '}
          {protocol.cluster}: each order is held in its own program account until release. Bonds and
          verification fees go to a Squads multisig vault. Every address, the program hash and the
          multisig threshold are read live on{' '}
          <a className="text-ink underline" href="/verify#proof">
            /verify
          </a>
          .
        </p>
      </DocSection>
      <DocSection id="paths" title="Two paths">
        <p>
          Buyers browse a live listing, pay the price plus a fee, and download only after escrow
          releases. Sellers bond the category, pay a verification fee unless their tier waives it,
          and upload a file. Static checks, a sandbox, and the automated reviewer{' '}
          {protocol.aiAgentId} (a rules engine plus an LLM that can only make the verdict stricter)
          decide whether the version goes live.
        </p>
        <p>
          Questions about an order go to{' '}
          <a className="text-ink underline" href={CONTACT_URL}>
            {CONTACT_LABEL}
          </a>
          .
        </p>
      </DocSection>
    </article>
  );
}
