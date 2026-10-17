import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { CONTACT_LABEL, CONTACT_URL, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'FAQ · TrenchMart docs' };

const QA: [string, string][] = [
  [
    'When can I download?',
    `As soon as your payment is confirmed in the escrow account. Downloads pause while a dispute is open. The seller is paid only after the ${protocol.escrowHours}-hour window.`,
  ],
  [
    'Who holds the SOL?',
    `Your order's own escrow account, a PDA of the trench_escrow program on ${protocol.cluster}. After the ${protocol.escrowHours}-hour window the program pays the seller and the fee buckets; during a dispute the resolver can refund you. Bonds and verification fees sit in a Squads multisig vault. Every address is on /verify.`,
  ],
  [
    'What does the seller receive?',
    `The list price. Creator commission is ${protocol.creatorCommission}. The buyer pays the ${protocol.marketplaceFeeLabel} marketplace fee, minus any tier rebate.`,
  ],
  [
    'Does $TRENCH pay yield?',
    'No. A tier can lower fees or a bond. It is not a share of the marketplace and not a promise that the token will increase in price.',
  ],
  [
    'How long do I have to dispute?',
    `Until the ${protocol.escrowHours}-hour window ends, or ${protocol.maliciousDisputeDays} days from payment if the reason is malicious.`,
  ],
  [
    'Who reviews listings?',
    `An automated reviewer, ${protocol.aiAgentId}: static checks, a sandboxed run and a rules engine. No language model is configured yet, and each listing's signed scan report names the engine that reviewed it. There is no human verifier role.`,
  ],
  [
    'Where do I write about an order?',
    `${CONTACT_LABEL}. For anything private, a private GitHub advisory.`,
  ],
];

export default function FaqDocsPage() {
  return (
    <article>
      <DocHeader
        kicker="FAQ"
        title="Short answers"
        lede="The longer pages next to this one are the source for fees, escrow, and verification."
      />
      <div className="mt-8 max-w-3xl space-y-3">
        {QA.map(([question, answer]) => (
          <details key={question} className="rounded-card border border-line bg-surface p-4">
            <summary className="cursor-pointer font-semibold text-ink">{question}</summary>
            <p className="m-0 mt-2 text-[15px] leading-7 text-ink-2">{answer}</p>
          </details>
        ))}
      </div>
      <DocSection id="more" title="Still stuck">
        <p>
          Mail{' '}
          <a className="text-ink underline" href={CONTACT_URL}>
            {CONTACT_LABEL}
          </a>{' '}
          with the order id and the transaction signature.
        </p>
      </DocSection>
    </article>
  );
}
