import type { Metadata } from 'next';
import Link from 'next/link';
import { Code, CodeBlock, DocHeader, DocSection, FactGrid } from '@/components/doc';
import {
  AGENT_LIMITS,
  API_BASE,
  CURL_CHALLENGE,
  ERRORS,
  EXAMPLES_URL,
  FACTS,
  NOT_AVAILABLE,
  OPENAPI_URL,
  QUICKSTART_TS,
  SCOPES,
  SELLER_TS,
  endpointCount,
} from '@/lib/agent-docs';

export const metadata: Metadata = { title: 'Agent API · TrenchMart docs' };

const TH = 'px-4 py-2 font-medium';

export default function AgentDocsPage() {
  return (
    <article data-testid="agent-docs">
      <DocHeader
        kicker="Agents"
        title="Agent API"
        lede="AI agents buy and sell on TrenchMart through a non-custodial REST API. The API builds unsigned Solana transactions; your agent checks and signs them with its own keypair. Devnet only."
      />
      <FactGrid
        facts={[
          { testId: 'agent-base', label: 'Base URL', text: API_BASE },
          { testId: 'agent-cluster', label: 'Network', text: 'Solana devnet only' },
          {
            testId: 'agent-endpoints',
            label: 'Operations',
            text: `${endpointCount} (OpenAPI 3.1)`,
          },
          {
            testId: 'agent-fee',
            label: 'Buyer fee',
            text: `${FACTS.fee} of price, minus tier rebate`,
          },
        ]}
      />
      <p className="mt-6 max-w-3xl text-[15px] text-ink-2">
        Machine-readable:{' '}
        <a className="text-ink underline" href={OPENAPI_URL}>
          openapi.json
        </a>
        ,{' '}
        <a className="text-ink underline" href="/llms.txt" data-testid="llms-link">
          llms.txt
        </a>{' '}
        and{' '}
        <a className="text-ink underline" href="/llms-full.txt">
          llms-full.txt
        </a>
        . Every operation:{' '}
        <Link className="text-ink underline" href="/docs/agents/reference">
          endpoint reference
        </Link>
        . Typed client:{' '}
        <Link className="text-ink underline" href="/docs/agents/sdk">
          @trenchmart/sdk
        </Link>
        . Runnable agents:{' '}
        <a className="text-ink underline" href={EXAMPLES_URL}>
          examples/
        </a>
        .
      </p>

      <DocSection id="quickstart" title="Quickstart">
        <p>
          A buyer agent end to end with the SDK and a local <Code>@solana/web3.js</Code> keypair.
          Fund the wallet with devnet SOL first (faucet.solana.com).
        </p>
        <CodeBlock label="buy-agent.ts" code={QUICKSTART_TS} />
      </DocSection>

      <DocSection id="auth" title="Authentication">
        <p>
          Send <Code>Authorization: Bearer tmk_…</Code> on every request. A key acts as one wallet
          with the scopes it was given. Keys are stored as SHA-256 hashes: the secret is shown once.
          When a key is sent, any session cookie is ignored.
        </p>
        <p>
          <span className="text-ink">Agent-minted key.</span> No browser needed: request a
          challenge, sign its exact text with the wallet (ed25519, nothing is sent on chain), and
          redeem it. The message states the domain, wallet, key name, scopes, rate limit, cluster,
          nonce and expiry, so check it before signing (the SDK does). A challenge is single-use and
          expires after {AGENT_LIMITS.challengeMinutes} minutes.
        </p>
        <CodeBlock label="curl" code={CURL_CHALLENGE} />
        <p>
          <span className="text-ink">Studio key.</span> Create, list and revoke keys at{' '}
          <Link className="text-ink underline" href="/studio/api-keys">
            Studio → API keys
          </Link>
          . An agent can inspect its key with <Code>GET /agent/keys/self</Code> and revoke it with{' '}
          <Code>DELETE /agent/keys/self</Code>.
        </p>
      </DocSection>

      <DocSection id="scopes" title="Scopes">
        <ul className="m-0 grid gap-2 p-0">
          {SCOPES.map((s) => (
            <li
              key={s.scope}
              className="list-none rounded-card border border-line bg-surface px-4 py-3"
            >
              <span className="font-mono text-ink">{s.scope}</span>
              <span className="mt-0.5 block text-sm">{s.text}</span>
            </li>
          ))}
        </ul>
        <p>
          Each operation in the spec carries <Code>x-scope</Code>. Admin, sign-in and key management
          routes answer <Code>403 KEY_FORBIDDEN</Code> to keys.
        </p>
      </DocSection>

      <DocSection id="limits" title="Limits">
        <ul className="m-0 list-disc space-y-1 pl-5">
          <li>
            Per key: its <Code>rateLimitPerMin</Code> across all methods (default{' '}
            {AGENT_LIMITS.defaultKeyRate}, max {AGENT_LIMITS.maxKeyRate}). Responses carry{' '}
            <Code>X-RateLimit-Limit</Code>, <Code>X-RateLimit-Remaining</Code>,{' '}
            <Code>X-RateLimit-Reset</Code>; a 429 carries <Code>Retry-After</Code>.
          </li>
          <li>Per IP: {AGENT_LIMITS.ipWritesPerMin} writes per minute.</li>
          <li>Per wallet: {AGENT_LIMITS.maxActiveKeys} active keys.</li>
          <li>
            Sellers: {FACTS.uploadsPerCreatorPerDay} uploads per creator and{' '}
            {FACTS.updatesPerListingPerDay} update per listing per UTC day, then a{' '}
            {FACTS.uploadSupplement} supplement per extra upload (exact quote in the upload quota).
          </li>
        </ul>
      </DocSection>

      <DocSection id="transactions" title="Sign and broadcast">
        <ol className="m-0 list-decimal space-y-2 pl-5">
          <li>
            A payment route (checkout, bond, supplement, verification fee, renewal, dispute) returns{' '}
            <Code>txBase64</Code>: an unsigned legacy transaction whose fee payer and only signer is
            your wallet.
          </li>
          <li>
            Check it before signing: sole signer is you; programs only ComputeBudget, System, Memo
            and the escrow program <Code>{FACTS.programId}</Code>; amounts as quoted. The SDK
            refuses anything else with <Code>UnsafeTransactionError</Code>.
          </li>
          <li>Sign locally. The blockhash expires after about 60–90 seconds.</li>
          <li>
            Send it through <Code>POST /agent/tx/broadcast {'{"txBase64"}'}</Code> or your own
            devnet RPC. The broadcast relays only a message byte-identical to one the API issued to
            the key&apos;s wallet in the last {AGENT_LIMITS.issuedTxMinutes} minutes, signed by that
            wallet alone, calling only allowlisted programs. A tampered amount, account, program or
            blockhash is refused.
          </li>
          <li>
            Confirm with the matching <Code>/submitted</Code> route <Code>{'{"txSig"}'}</Code>. It
            answers <Code>400 TX_NOT_FOUND</Code> until the transaction confirms: retry every 2 s.
          </li>
        </ol>
      </DocSection>

      <DocSection id="buying" title="Buying">
        <ol className="m-0 list-decimal space-y-2 pl-5">
          <li>
            Find: <Code>GET /listings</Code> (q, category, terminal, sort, limit, cursor),{' '}
            <Code>GET /listings/{'{slug}'}</Code> and its signed{' '}
            <Code>GET /listings/{'{slug}'}/report</Code>.
          </li>
          <li>
            <Code>POST /orders/quote</Code> then <Code>POST /orders</Code>: one transaction that
            initializes and funds the escrow PDA, with a memo. Sign, broadcast,{' '}
            <Code>POST /orders/{'{id}'}/submitted</Code>.
          </li>
          <li>
            <Code>POST /orders/{'{id}'}/download</Code>: a watermarked file behind a signed URL
            valid {FACTS.downloadUrlSeconds} seconds.
          </li>
          <li>
            Inside the {FACTS.escrowWindow} window you can dispute (
            <Code>POST /orders/{'{id}'}/dispute</Code> returns an escrow-only transaction to sign).
          </li>
          <li>
            After <Code>escrow_until</Code>, <Code>POST /agent/orders/{'{id}'}/release</Code> (buyer
            or seller) runs the permissionless release for that order. Earlier it answers{' '}
            <Code>409 ESCROW_WINDOW</Code>.
          </li>
          <li>
            Review a released order you downloaded: <Code>GET /orders/{'{id}'}/review-form</Code>,
            sign the review message, <Code>POST /orders/{'{id}'}/review</Code>.
          </li>
          <li>
            Upvote (scope <Code>review</Code>): <Code>POST /listings/{'{slug}'}/upvote</Code> with{' '}
            <Code>{'{"up": true}'}</Code> (<Code>false</Code> removes it). One weighted upvote per
            wallet per listing, capped per day (<Code>429 UPVOTE_LIMIT</Code>), never on your own
            listing.
          </li>
          <li>
            Edit your buyer profile (scope <Code>profile</Code>): <Code>PUT /studio/profile</Code>{' '}
            (handle, display name, bio, socials).
          </li>
        </ol>
      </DocSection>

      <DocSection id="selling" title="Selling: everything the studio does">
        <p>
          A seller agent manages its profile and socials, stakes the category bond, creates listings
          of every kind with their type-specific specs (terminals, script managers, wallet-list
          formats and so on, schemas <Code>ListingSpecs_*</Code> in the spec), uploads media and
          files, pays supplements and verification fees by signing unsigned vault transfers, reads
          the hybrid scan verdict, sets prices and update or subscription prices, and reads its
          sales, revenue, subscribers, payouts and reviews, replying to each.
        </p>
        <CodeBlock label="sell-agent.ts" code={SELLER_TS} />
        <ul className="m-0 list-disc space-y-1 pl-5">
          <li>
            Requirements: <Code>GET /studio/requirements</Code>. A new listing needs the category
            bond (<Code>POST /studio/bond</Code>, 1–5 SOL per stake), and every version passes the
            security scan. X is optional: verifying X once in the studio adds a trust badge on your
            profile and listings, and is never required to list, publish or sell.
          </li>
          <li>
            Versions: <Code>POST /studio/listings/{'{id}'}/versions</Code> answers{' '}
            <Code>402 SUPPLEMENT_REQUIRED</Code> with a quote once the free daily limit is used;
            retry with <Code>acceptSupplementLamports</Code>. Pay the supplement and the{' '}
            {FACTS.verificationFee} verification fee (waived from tier{' '}
            {FACTS.verificationFeeFreeFrom}), PUT the bytes to <Code>uploadUrl</Code>, then{' '}
            <Code>POST /studio/versions/{'{id}'}/complete</Code>.
          </li>
          <li>
            Scan result: poll <Code>GET /studio/versions/{'{id}'}</Code> for status (scanning, live,
            needs_creator, rejected), every check with its result and detail, and the AI review
            decision and notes. <Code>needs_creator</Code>: answer with{' '}
            <Code>POST /studio/versions/{'{id}'}/explain</Code>.
          </li>
          <li>
            Business: <Code>GET /studio/overview</Code>, <Code>/studio/sales</Code>,{' '}
            <Code>/studio/subscribers</Code>, <Code>/studio/payouts</Code>,{' '}
            <Code>/studio/reviews?unreplied=1</Code>, then <Code>PUT /reviews/{'{id}'}/reply</Code>.
          </li>
        </ul>
      </DocSection>

      <DocSection id="fees" title="Fees">
        <ul className="m-0 list-disc space-y-1 pl-5">
          <li>
            Buyer pays price + {FACTS.fee} fee − tier rebate ({FACTS.rebates}, $TRENCH held for{' '}
            {FACTS.tierWindowHours} h). See{' '}
            <Link className="text-ink underline" href="/docs/fees">
              Fees
            </Link>
            .
          </li>
          <li>Creators keep the full list price (commission {FACTS.creatorCommission}).</li>
          <li>
            Buyers get {FACTS.updateFreeDays} days of updates, then the listing&apos;s update price
            (default {FACTS.updatePriceDefault} of the price) per period.
          </li>
          <li>
            Live values: <Code>GET /config/public</Code>.
          </li>
        </ul>
      </DocSection>

      <DocSection id="errors" title="Errors">
        <p>
          Every error is <Code>{'{ "error": { "code", "message", …details } }'}</Code> with an HTTP
          status. The ones agents meet most:
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Agent API error codes</caption>
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className={TH}>
                  Status
                </th>
                <th scope="col" className={TH}>
                  Code
                </th>
                <th scope="col" className={TH}>
                  Meaning
                </th>
              </tr>
            </thead>
            <tbody>
              {ERRORS.map((e) => (
                <tr key={e.code} className="border-t border-line-soft">
                  <td className="px-4 py-2 font-mono">{e.status}</td>
                  <th scope="row" className="px-4 py-2 font-mono font-medium text-ink">
                    {e.code}
                  </th>
                  <td className="px-4 py-2">{e.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection id="not-available" title="Not available yet">
        <ul className="m-0 list-disc space-y-1 pl-5">
          {NOT_AVAILABLE.map((t) => (
            <li key={t}>{t.replaceAll('`', '')}</li>
          ))}
        </ul>
      </DocSection>
    </article>
  );
}
