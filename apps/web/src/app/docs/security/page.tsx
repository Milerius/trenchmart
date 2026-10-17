import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Security · TrenchMart docs' };

export default function SecurityDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="Security"
        title="What is checked"
        lede="Uploads are scanned before they go live, downloads are watermarked, and the API cannot spend the vault."
      />
      <DocSection id="uploads" title="Uploads">
        <p>
          {protocol.scannerEngine} fails closed on a bad userscript header, wide match patterns,
          obfuscation, and network calls the header did not declare. Remote scripts have to come
          from {protocol.allowHosts.join(', ')}. A sandbox failure or a wallet signing call is
          rejected by {protocol.aiAgentId}. The same file hash cannot be published by a second
          creator.
        </p>
      </DocSection>
      <DocSection id="money" title="Payments">
        <p>
          Amounts are integer lamports. An order settles only when its escrow account on chain holds
          the quoted total with the buyer, seller, resolver, buckets and fee fields the API asked
          the buyer to sign. Bond and verification-fee transfers settle only when the amount, memo,
          sender and vault match. Every transaction is built with you as the only signer and fee
          payer, carries explicit compute-budget limits, and is simulated on devnet first. The
          cluster guard refuses a mainnet RPC URL. Wallet sign-in is a Sign-In With Solana message
          for trenchmart.fun, not a transaction.
        </p>
      </DocSection>
      <DocSection id="reports" title="Signed scan reports">
        <p>
          Each listing&apos;s Security tab has a downloadable JSON report: the file name, size and
          SHA-256, every static, sandbox and review step with its engine and timestamps, every check
          with its result, and the review attestation. The report is signed with Ed25519. The signed
          bytes are the UTF-8 of <span className="font-mono">trenchmart-scan-report:v1</span>, a
          newline, and the report as JSON with sorted keys and no spaces. The public key is on{' '}
          <a className="text-ink underline" href="/verify#proof">
            /verify
          </a>{' '}
          and at <span className="font-mono">/api/v1/transparency</span>, and /verify can check a
          report in your browser.
        </p>
        <p>
          The review step is an AI review ({protocol.aiEngine}): a rules engine (
          {protocol.rulesEngine}) and an LLM ({protocol.aiModel}, reasoning effort{' '}
          {protocol.aiReasoningEffort}). The model sees the listing text buyers read (summary,
          README, install guide), the first 40,000 characters of the file, your note and the check
          results, all as untrusted data. The stricter verdict wins, so the model can only make a
          verdict stricter. Each signed report names the engine and model that reviewed the version.
          The model is skipped when the rules already reject, and if it is unavailable the rules
          verdict stands; either way the report shows the rules engine alone. Live settings are on
          /verify.
        </p>
      </DocSection>
      <DocSection id="downloads" title="Downloads and sessions">
        <p>
          Downloads require a paid (escrow-confirmed) or released order and a license for that
          wallet, and pause during a dispute. The signed URL expires after{' '}
          {protocol.downloadUrlSeconds} seconds. The session cookie is httpOnly. Download logs store
          a hash of the IP, not the raw address. Private keys and seed phrases are not collected.
        </p>
      </DocSection>
      <DocSection id="prohibited" title="Prohibited tools">
        <p>
          Malware, drainers, wallet stealers, and tools that sign or move funds without the action
          the listing described are not allowed. An upheld malicious dispute delists the listing and
          bans the creator.
        </p>
      </DocSection>
    </article>
  );
}
