'use client';

import Link from 'next/link';
import Stepper, { Step } from '@/components/rb/Stepper';
import { SELL_STEPS } from './sell-parts';

/** Desktop "How it works": the React Bits Stepper, loaded after idle by SellSteps. */
export default function SellStepper() {
  return (
    <div data-fx="stepper">
      <Stepper
        initialStep={1}
        width="100%"
        accentColor="#C6F432"
        nextButtonText="Next step"
        completeButtonText="Open the studio"
        completedContent={
          <div className="flex flex-col gap-3 py-4">
            <span className="text-xl font-semibold">You&apos;re ready.</span>
            <Link href="/studio/listings/new" className="font-medium text-accent">
              Start your first listing →
            </Link>
          </div>
        }
      >
        {SELL_STEPS.map(({ icon: Icon, title, body }) => (
          <Step key={title} title={title}>
            <div className="flex flex-col gap-3 py-2">
              <Icon size={28} className="text-accent" aria-hidden="true" />
              <span className="text-xl font-semibold">{title}</span>
              <p className="m-0 text-ink-2">{body}</p>
            </div>
          </Step>
        ))}
      </Stepper>
    </div>
  );
}
