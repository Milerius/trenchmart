import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { formatTrench } from '@trenchmart/shared';
import { CONTACT_LABEL, CONTACT_URL, bonds, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Terms of Service · TrenchMart' };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <DocHeader
        kicker="Legal"
        title="Terms of Service"
        lede="These terms cover use of TrenchMart, a non-custodial Solana marketplace for trading tools."
      />
      <p className="m-0 mt-4 text-sm text-muted">Last updated 17 October 2026.</p>
      <DocSection id="marketplace" title="The marketplace">
        <p>
          TrenchMart lets people list and buy trading tools: userscripts, wallet lists, filters,
          setups, strategies, and alerts. The interface at trenchmart.fun and the API at
          api.trenchmart.fun are the service. Using the site, connecting a wallet, or signing a
          transaction means you accept these terms and the Privacy Policy.
        </p>
        <p>
          The service currently runs on Solana {protocol.cluster}. Amounts are {protocol.cluster}{' '}
          SOL. A signature you send moves {protocol.cluster} funds from the wallet you control.
        </p>
      </DocSection>
      <DocSection id="custody" title="Non-custodial checkout">
        <p>
          TrenchMart does not take custody of your wallet. When you buy, your wallet signs one
          transaction that creates an escrow account for the order in the on-chain escrow program (
          {protocol.programId}) on {protocol.cluster} and deposits the order total into it, with a
          memo that identifies the order. The program alone moves those funds: to the seller and the
          fee buckets when the window ends, or back to you when a dispute is upheld.
        </p>
        <p>
          Bond and verification-fee payments are a transfer to a Squads multisig vault with a memo.
          Signer keys for that vault are configured in Squads, outside this service.
        </p>
      </DocSection>
      <DocSection id="escrow" title="Escrow, release, and refunds">
        <p>
          A purchase quote adds the marketplace fee of {protocol.marketplaceFeeLabel} of the list
          price, minus any holder rebate that applies to your wallet. Creator commission is{' '}
          {protocol.creatorCommission}. The order stays pending for {protocol.orderTtlMinutes}{' '}
          minutes, with {protocol.paymentGraceMinutes} minutes of grace for a matching transfer.
        </p>
        <p>
          Once the escrow account holds the full total, the order is paid and held for{' '}
          {protocol.escrowWindow}. If you do not open a dispute, release pays the seller the list
          price and splits the net fee. You can download the file as soon as the order is paid, only
          for a wallet that holds the license, and not while a dispute is open. The file is
          watermarked with the order, the wallet, and the file hash.
        </p>
        <p>
          You may open a dispute for not as described, broken or changed, malicious or unsafe, or
          another reason you explain, while the order is paid and the window has not ended. A
          malicious reason can be opened for {protocol.maliciousDisputeDays} days after payment,
          including after release. Opening a dispute inside the window freezes the escrow on chain,
          which you sign. If the dispute is upheld, the total you paid is refunded: by the escrow
          program when the order was still paid, and from the creator bond and then the safety
          bucket when it was already released. If the dispute is rejected, the order returns to the
          status it had before. One dispute is kept per order.
        </p>
      </DocSection>
      <DocSection id="verification" title="Automated review">
        <p>
          Every upload is checked by the static scanner and, for userscripts and JavaScript alerts,
          by a sandbox. The automated reviewer, {protocol.aiAgentId} (a rules engine plus a language
          model that can only make the verdict stricter), then approves the version, rejects it, or
          asks the creator for a real explanation of a warning. There is no human reviewer. A
          passing review means the automated checks completed. It does not mean the tool will make
          money, that it is fit for a particular terminal, or that it will stay safe after you
          change it.
        </p>
      </DocSection>
      <DocSection id="bonds" title="Creator bonds">
        <p>
          A creator posts a bond before listing. The amount depends on the category, from{' '}
          {bonds.reduce((min, bond) => (bond.lamports < min.lamports ? bond : min)).sol} to{' '}
          {bonds.reduce((max, bond) => (bond.lamports > max.lamports ? bond : max)).sol} in the
          seeded config. OG holders pay {protocol.ogBondDiscount} of that bond. The bond can be
          slashed to fund a refund. An unlock request waits {protocol.bondUnlockDays} days. If the
          active bond falls below the required amount, the creator&apos;s listings can be paused.
        </p>
      </DocSection>
      <DocSection id="token" title="The $TRENCH token">
        <p>
          Holding $TRENCH can place a wallet in a tier. A tier can lower the buyer fee, waive the{' '}
          {protocol.verificationFee} verification fee from {protocol.verificationFeeFreeFrom}{' '}
          upward, discount an OG bond, and unlock holder-only listings. The thresholds are Scout{' '}
          {formatTrench(protocol.thresholds.scout)}, Trencher{' '}
          {formatTrench(protocol.thresholds.trencher)}, and OG{' '}
          {formatTrench(protocol.thresholds.og)}. The balance that counts is the lowest balance in a{' '}
          {protocol.tierWindowHours}
          -hour window.
        </p>
        <p>
          $TRENCH is not a share of TrenchMart, not a claim on fees, and not an offer of profit,
          yield, or buyback at any price. The buyback bucket is only a destination for part of the
          marketplace fee. Buying or holding the token is not an investment in the marketplace.
        </p>
      </DocSection>
      <DocSection id="prohibited" title="Prohibited content">
        <p>
          You may not list, upload, or sell malware, drainers, wallet stealers, or any tool that
          reads keys, signs transactions, or moves funds except as the listing truthfully describes.
          Obfuscated payloads, undeclared network calls, and stolen copies of another creator&apos;s
          file are rejected. An upheld malicious dispute delists the listing, delists its live and
          superseded versions, bans the creator, and slashes the bond.
        </p>
        <p>
          You are responsible for the tools you buy and run. Trading tools do not guarantee profits.
        </p>
      </DocSection>
      <DocSection id="contact" title="Contact">
        <p>
          Questions about these terms or an order:{' '}
          <a className="text-ink underline" href={CONTACT_URL}>
            {CONTACT_LABEL}
          </a>
          . Include the order id and, if you have it, the transaction signature.
        </p>
      </DocSection>
    </article>
  );
}
