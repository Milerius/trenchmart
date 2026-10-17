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
        lede="trench_escrow is an Anchor program on devnet. Every checkout creates and funds an escrow account in one buyer-signed transaction; the API verifies the account before it marks the order paid. The program is built and tested in CI."
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
          It stores the buyer, seller, resolver, and the buyback, verification, ops, and safety
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
      <DocSection id="check" title="Check it yourself">
        <ul className="m-0 grid gap-2 p-0">
          <li className="list-none">
            Program on Solana Explorer:{' '}
            <a
              className="font-mono text-ink underline"
              href={`https://explorer.solana.com/address/${protocol.programId}?cluster=${protocol.cluster}`}
              target="_blank"
              rel="noreferrer"
            >
              {protocol.programId}
            </a>
            . The IDL is published on chain (Program Metadata, seed{' '}
            <span className="font-mono">idl</span>):{' '}
            <span className="font-mono text-ink">
              npx @solana-program/program-metadata fetch idl {protocol.programId} --rpc &lt;devnet
              RPC&gt;
            </span>
          </li>
          <li className="list-none">
            The binary embeds a security.txt (name, project URL, source, policy). Explorer shows it
            on the program page.
          </li>
          <li className="list-none">
            Live program hash, upgrade authority, multisig, buckets and the latest escrows are on{' '}
            <a className="text-ink underline" href="/verify#proof">
              /verify
            </a>
            . Your own order&apos;s escrow account and release time are on your purchases page, read
            from chain.
          </li>
          <li className="list-none">
            A verified (reproducible) build is not published yet, so compare the deployed hash with
            your own <span className="font-mono">anchor build</span> of programs/trench_escrow.
          </li>
        </ul>
      </DocSection>
      <DocSection id="resolver" title="Resolver">
        <p>
          The resolver pubkey is stored at initialize. Refund and reject_dispute require that pubkey
          as a signer. Refund pays the deposit back only when disputed_from is paid, because a
          release has already moved the lamports out of the account. The API holds the resolver key:
          its cron sends release after escrow_until, and resolving a dispute sends refund or
          reject_dispute. Release only moves funds out of paid, so a disputed escrow cannot be
          released. A refund after release is funded from the creator bond and then the safety
          bucket. Release pays every bucket directly, so each bucket wallet must already hold the
          rent-exempt minimum.
        </p>
      </DocSection>
    </article>
  );
}
