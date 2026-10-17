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
        lede="Escrowed SOL sits in a Squads multisig vault. The API never holds a key that can move it."
      />
      <DocSection id="vault" title="Custody">
        <p>
          Checkout builds a system transfer from the buyer to the vault address, plus the order
          memo. Bond and verification-fee transfers use the same vault. The database ledger records
          which part of that balance belongs to a creator, a buyer refund, or a fee bucket. The
          on-chain vault balance is expected to cover the vault ledger.
        </p>
        <p>
          Signer keys and the approval threshold are configured in Squads. This repository does not
          store the signer set or a threshold, so a policy such as 2-of-3 is an operational Squads
          setting rather than a constant in the program or the API.
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
          <span className="font-mono text-ink">{protocol.programId}</span> on {protocol.cluster} can
          hold a deposit inside its own PDA and pay it out with the same split. That program is
          tested on every pull request. Live orders do not call it. Custody for the running
          marketplace is the Squads vault.
        </p>
      </DocSection>
    </article>
  );
}
