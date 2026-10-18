import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Treasury · TrenchMart docs' };

export default function TreasuryDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Treasury"
        title="Squads multisig vault"
        lede="Bonds and verification fees sit in a Squads multisig vault. Order payments do not: each order is held by the escrow program. The API never holds a key that can move the vault."
      />
      <DocSection id="vault" title="Custody">
        <p>
          Bond and verification-fee payments are a system transfer from your wallet to the vault
          address, with a memo. The database ledger records which part of that balance belongs to
          whom. Order payments go to a per-order escrow account of the program instead (see Escrow
          program).
        </p>
        <p>
          Signer keys and the approval threshold are configured in Squads, not in this code. They
          are public on chain:{' '}
          <a className="text-ink underline" href="/verify#proof">
            /verify
          </a>{' '}
          reads the multisig account live and shows its threshold and members.
        </p>
      </DocSection>
      <DocSection id="payouts" title="Payouts">
        <p>
          Release writes payout rows. A batch takes up to {protocol.payoutBatchLimit} pending rows,
          writes the transfer list to object storage under payout-batches, and marks them proposed.
          A Squads signer executes the proposal. Posting the signature marks the batch sent.
          Recipients that are still unconfigured are left out of the batch.
        </p>
      </DocSection>
      <DocSection id="program" title="The on-chain program">
        <p>
          <span className="break-all font-mono text-ink">{protocol.programId}</span> on{' '}
          {protocol.cluster} can holds each order&apos;s deposit inside its own PDA and pays it out
          with the fee split. Every live order uses it, and it is tested on every pull request. Its
          IDL is published on chain and it embeds a security.txt.
        </p>
      </DocSection>
    </article>
  );
}
