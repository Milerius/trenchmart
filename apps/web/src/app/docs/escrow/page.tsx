import type { Metadata } from 'next';
import { DocHeader, DocSection, FactGrid } from '@/components/doc';
import { EscrowStateDiagram } from '@/components/diagrams';
import { ESCROW_INSTRUCTIONS, orderEdges, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Escrow program · TrenchMart docs' };

const INSTRUCTION_COPY: Record<(typeof ESCROW_INSTRUCTIONS)[number], string> = {
  initialize:
    'Buyer creates the escrow PDA and stores the seller, resolver, buckets, price, and fee.',
  fund: 'Buyer transfers the quoted total into the escrow account. Status becomes paid.',
  release:
    'After escrow_until, price goes to the seller and the net fee is split to the four buckets.',
  expire: 'After expires_at, an unpaid order becomes expired. No funds have been deposited.',
  open_dispute: 'Buyer moves paid or released to disputed and stores the previous status.',
  refund: 'Resolver returns the deposit to the buyer, and only when the dispute started from paid.',
  reject_dispute: 'Resolver restores the order to paid or released.',
};

export default function EscrowDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Escrow"
        title="The escrow program"
        lede="trench_escrow is an Anchor program on devnet. Live checkout pays the Squads vault and tracks the same states in Postgres. The program is built and tested in CI."
      />
      <FactGrid
        facts={[
          { testId: 'escrow-cluster', label: 'Cluster', text: protocol.cluster },
          { testId: 'escrow-program-id', label: 'Program id', text: protocol.programId },
          { testId: 'escrow-seeds', label: 'PDA seeds', text: protocol.pdaSeeds },
          { testId: 'escrow-hours', label: 'Escrow window', text: `${protocol.escrowHours} hours` },
        ]}
      />
      <DocSection id="accounts" title="Accounts">
        <p>
          The escrow account is a PDA seeded with the byte string escrow and the 16-byte order id.
          It stores the buyer, seller, resolver, and the buyback, AI verification, ops, and safety
          pubkeys, plus status, disputed_from, price, deposit, fee and rebate basis points, the four
          split basis points, expires_at, escrow_until, and the bump.
        </p>
      </DocSection>
      <DocSection id="instructions" title="Instructions">
        <ul className="m-0 grid gap-3 p-0">
          {ESCROW_INSTRUCTIONS.map((name) => (
            <li key={name} className="list-none rounded-card border border-line bg-surface p-4">
              <span className="font-mono text-sm text-accent">{name}</span>
              <p className="m-0 mt-1">{INSTRUCTION_COPY[name]}</p>
            </li>
          ))}
        </ul>
      </DocSection>
      <DocSection id="states" title="States">
        <p>
          Refunded and expired are terminal. Release and expire on the program are permissionless
          once the clock allows them. The buyer signs initialize, fund, and open_dispute.
        </p>
        <ul data-testid="order-edges" className="m-0 grid gap-1 p-0 font-mono text-sm text-ink">
          {orderEdges.map((edge) => (
            <li key={`${edge.from}-${edge.to}`} className="list-none">
              {edge.from} → {edge.to}
            </li>
          ))}
        </ul>
        <EscrowStateDiagram />
      </DocSection>
      <DocSection id="resolver" title="Resolver">
        <p>
          The resolver pubkey is stored at initialize. Refund and reject_dispute require that pubkey
          as a signer. Refund pays the deposit back only when disputed_from is paid, because a
          release has already moved the lamports out of the account. On the live ledger path, an
          operator resolves the dispute in the API, and a refund after release is funded from the
          creator bond and then the safety bucket.
        </p>
      </DocSection>
    </article>
  );
}
