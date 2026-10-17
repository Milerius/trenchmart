import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { PurchaseDiagram } from '@/components/diagrams';
import { CONTACT_EMAIL, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Docs · TrenchMart' };

export default function DocsOverviewPage() {
  return (
    <article>
      <DocHeader
        kicker="Protocol"
        title="How TrenchMart works"
        lede="A non-custodial Solana marketplace for trading tools. Buyers pay into escrow, sellers post a bond, and an automated reviewer checks every upload."
      />
      <DocSection id="where" title="Where the figures come from">
        <p>
          The numbers on these pages are the seeded defaults in the shared config. A deployed config
          row can override them. Checkout today records the order in the ledger and pays a Squads
          multisig vault. The Anchor program{' '}
          <span className="font-mono text-ink">{protocol.programId}</span> is on {protocol.cluster}{' '}
          and uses the same states and fee maths. It is not the path that holds funds on the live
          checkout.
        </p>
      </DocSection>
      <DocSection id="paths" title="Two paths">
        <p>
          Buyers browse a live listing, pay the price plus a fee, and download only after escrow
          releases. Sellers bond the category, pay a verification fee unless their tier waives it,
          and upload a file. Static checks, a sandbox, and {protocol.aiAgentId} decide whether the
          version goes live.
        </p>
        <p>
          Questions about an order go to{' '}
          <a className="text-ink underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </DocSection>
      <PurchaseDiagram />
    </article>
  );
}
