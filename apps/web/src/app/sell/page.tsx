import { PrimaryCta } from '@/components/cta';
import { MARKET_WRAP, PageHero } from '@/components/page-hero';
import { Serif } from '@/components/ui';
import { protocol } from '@/lib/protocol-facts';
import { SellFees, SellSteps, StudioLink } from './sell-parts';

export default function SellPage() {
  return (
    <>
      <PageHero
        eyebrow="Sell on TrenchMart"
        title={
          <>
            Sell your tooling. <Serif className="text-accent">Keep 100%</Serif> of the price.
          </>
        }
        sub="0% creator commission. Buyers pay the fee, and every version you upload goes through automated review live, so buyers trust it on sight."
      >
        <div className="flex flex-wrap gap-3">
          <PrimaryCta href="/studio/listings/new">Create a listing</PrimaryCta>
          <StudioLink />
        </div>
      </PageHero>
      <div className={`${MARKET_WRAP} grid gap-10 py-14 lg:grid-cols-2`}>
        <section aria-labelledby="sell-how" className="flex min-w-0 flex-col gap-4">
          <h2 id="sell-how" className="m-0 text-3xl font-semibold tracking-[-0.03em]">
            How it works
          </h2>
          <SellSteps />
        </section>
        <section aria-labelledby="sell-pay" className="flex min-w-0 flex-col gap-4">
          <h2 id="sell-pay" className="m-0 text-3xl font-semibold tracking-[-0.03em]">
            What you pay
          </h2>
          <SellFees
            verificationFreeFrom={protocol.verificationFeeFreeFrom}
            ogBondDiscount={protocol.ogBondDiscount}
            bondUnlockDays={protocol.bondUnlockDays}
          />
        </section>
      </div>
    </>
  );
}
