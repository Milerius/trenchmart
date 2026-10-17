import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { CONTACT_EMAIL } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'Privacy Policy · TrenchMart' };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <DocHeader
        kicker="Legal"
        title="Privacy Policy"
        lede="What TrenchMart stores when you connect a wallet, link an X handle, upload a file, or download a purchase."
      />
      <p className="m-0 mt-4 text-sm text-muted">Last updated 17 October 2026.</p>
      <DocSection id="who" title="Who operates the service">
        <p>
          TrenchMart runs the site at trenchmart.fun and the API at api.trenchmart.fun. Privacy
          questions go to{' '}
          <a className="text-ink underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </DocSection>
      <DocSection id="collected" title="Data we collect">
        <p>Wallet address. Sign-in is a signed message. The address is the account key.</p>
        <p>
          X handle and X user id, when you link them. A handle you submit is stored on your user
          row.
        </p>
        <p>
          Uploads. File name, size, sha256, and the bytes of each version you submit, plus the
          static-scan and sandbox results and the AI attestation.
        </p>
        <p>
          Logs. Order, bond, payout, dispute, and audit records; a session cookie named tm_session;
          and, on download, a hash of the requesting IP rather than the raw address. Nonces used for
          sign-in are stored until they expire or are used.
        </p>
        <p>We do not ask for a seed phrase or a private key. Signing happens in your wallet.</p>
      </DocSection>
      <DocSection id="why" title="Why it is stored">
        <p>
          The wallet address identifies your account, licenses, and payouts. The X handle is the
          public creator identity when you set one. Uploads are the product buyers pay for, and the
          scan records are how a listing becomes live. Logs are how an order moves through escrow,
          how a dispute is resolved, and how a watermarked download is tied to a license.
        </p>
      </DocSection>
      <DocSection id="processors" title="Processors">
        <p>
          Supabase processes the Postgres database that holds accounts, listings, orders, scans, and
          the ledger.
        </p>
        <p>
          Cloudflare processes the website, the API workers, and R2 object storage for uploads,
          watermarked downloads, and payout-batch files. Signed download URLs expire after a few
          minutes.
        </p>
        <p>
          Solana validators and the RPC provider see the public transactions your wallet submits,
          including transfers into the vault. Those transfers are public on Solana devnet.
        </p>
      </DocSection>
      <DocSection id="cookies" title="Cookies and sessions">
        <p>
          After a successful sign-in the API sets tm_session as an httpOnly cookie on the site, with
          SameSite Lax. Clearing it, or signing out, ends the session. The wallet picker remembers
          the last wallet id in local storage on your device.
        </p>
      </DocSection>
      <DocSection id="retention" title="How long it stays">
        <p>
          Account, listing, order, scan, and ledger rows stay for as long as the marketplace keeps
          that history, including after a ban or a delist, because refunds and audits refer to them.
          You can ask {CONTACT_EMAIL} what is stored for your wallet address.
        </p>
      </DocSection>
      <DocSection id="contact" title="Contact">
        <p>
          Email{' '}
          <a className="text-ink underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          to ask for a copy of the rows stored for your wallet, or to ask a question about this
          policy.
        </p>
      </DocSection>
    </article>
  );
}
