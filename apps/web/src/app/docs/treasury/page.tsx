import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { PayoutsCard } from '@/components/payouts';
import { RewardsCard } from '@/components/rewards';
import { protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Treasury · TrenchMart docs' };

export default function TreasuryDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Treasury"
        title="Squads multisig vault"
        lede="Bonds and verification fees sit in a Squads multisig vault. Order payments do not: each order is held by the escrow program. The API can move the vault only through a capped Squads spending limit for payouts."
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
        <p data-testid="payouts-auto">
          Release writes payout rows. The backend pays them automatically through a Squads spending
          limit: a payout key that is not a multisig member may move at most{' '}
          {protocol.payoutDailyCapSol} SOL a day out of the vault, and the backend caps each line at{' '}
          {protocol.payoutMaxLineSol} SOL. Each line is its own transaction, and its signature is
          stored before broadcast, so a retry never pays twice.
        </p>
        <p>
          Lines over the cap still go to a batch of up to {protocol.payoutBatchLimit} transfers for
          a Squads signer. The multisig can remove the spending limit at any time, which stops
          automated payouts. Recipients that are still unconfigured are left out.
        </p>
        <p>
          Every signature is public. The latest creator payouts are below, each linked to its
          transaction on Solscan. Fee-bucket transfers and refunds are not listed, and lines appear
          at least 10 minutes after sending with times rounded to 15 minutes, so a payout cannot be
          matched to a sale.
        </p>
        <div className="not-prose mt-5">
          <PayoutsCard title="Latest creator payouts" limit={8} />
        </div>
      </DocSection>
      <DocSection id="holder-rewards" title="$MART holder rewards">
        <p data-testid="rewards-treasury">
          Half of net revenue (fees minus ledgered running costs) goes to the top 1,000 $MART
          holders every 3 hours. The holders&apos; share of each fee is paid to a separate Squads
          vault (index 1). Once per epoch a spending limit on that vault, whose only destination is
          the rewards hot wallet, moves exactly the epoch&apos;s payouts; the hot wallet then sends
          SOL in transactions of 20 transfers each. Every funding and batch signature is listed
          below and in the public feed.
        </p>
        <div className="not-prose mt-5">
          <RewardsCard title="Latest holder distributions" limit={5} />
        </div>
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
