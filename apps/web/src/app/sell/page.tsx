import Link from 'next/link';

export default function SellPage() {
  return (
    <article className="max-w-2xl space-y-4">
      <h1 className="text-3xl">Sell your tooling</h1>
      <p className="text-muted">
        Link a wallet, post a 1–5 SOL creator bond, and upload a version. The scanner and isolated
        sandbox run immediately, then the AI verifier approves, rejects, or asks for a note.
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Connect and sign in. No transaction is required to sign in.</li>
        <li>Stake the bond for the category you sell.</li>
        <li>Create a listing and upload the file. A new file is a new version.</li>
      </ol>
      <Link href="/studio" className="inline-block rounded-md bg-accent px-4 py-2 text-onaccent">
        Open creator studio
      </Link>
    </article>
  );
}
