import { ButtonLink, Label, Serif } from '@/components/ui';

const STEPS: [string, string][] = [
  ['Connect and sign in', 'Sign a message with your wallet. No transaction is needed to sign in.'],
  [
    'Post your creator bond',
    'A 1–5 SOL bond for the category you sell. It backs buyers if a dispute is upheld.',
  ],
  [
    'Upload and watch the review',
    'Static checks (and, for scripts, an isolated sandbox) run at once, then a rules engine and an LLM review the code against your listing and approve, reject or ask for a note. About a minute, not days.',
  ],
  ['Get paid in SOL', 'You keep 100% of your price. Each sale pays out after its escrow releases.'],
];

export default function SellPage() {
  return (
    <article className="space-y-10">
      <header className="max-w-2xl">
        <Label className="text-accent-label">Sell on TrenchMart</Label>
        <h1 className="m-0 mt-2 text-[40px] font-semibold leading-tight tracking-[-0.03em]">
          Sell your tooling. <Serif className="text-accent">Keep 100%</Serif> of the price.
        </h1>
        <p className="m-0 mt-3 text-[17px] text-ink-2">
          0% creator commission. Buyers pay the fee, and every version you upload goes through
          automated review live, so buyers trust it on sight.
        </p>
        <ButtonLink href="/studio" size="lg" className="mt-6">
          Open creator studio
        </ButtonLink>
      </header>
      <ol className="m-0 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, body], index) => (
          <li
            key={title}
            className="motion-card list-none rounded-card border border-line bg-surface p-5"
          >
            <span className="font-mono text-xs text-accent">0{index + 1}</span>
            <h2 className="m-0 mt-3 text-base font-semibold">{title}</h2>
            <p className="m-0 mt-2 text-sm text-ink-2">{body}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
