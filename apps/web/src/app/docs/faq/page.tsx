import type { Metadata } from 'next';
import { DocHeader, DocSection } from '@/components/doc';
import { CONTACT_EMAIL, protocol } from '@/lib/protocol-facts';

export const metadata: Metadata = { title: 'FAQ · TrenchMart docs' };

const QA: [string, string][] = [
  [
    'When can I download?',
    `After the order status is released. A paid order is still inside the ${protocol.escrowHours}-hour escrow window.`,
  ],
  [
    'Who holds the SOL?',
    'A Squads multisig vault. The API has no key that can move it. The Anchor program on devnet is a separate, tested path and is not the live checkout.',
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
  ['Who reviews listings?', `${protocol.aiAgentId} does. There is no human verifier role.`],
  ['Where do I write about an order?', CONTACT_EMAIL],
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
          <a className="text-ink underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          with the order id and the transaction signature.
        </p>
      </DocSection>
    </article>
  );
}
