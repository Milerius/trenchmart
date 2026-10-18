'use client';

import { useFxModule } from '@/lib/fx';

// Desktop-only React Bits effects for the listing page (lazy chunks after idle, see lib/fx.ts).
// Phones and reduced motion keep the static fallbacks and never download them.

const loadElectric = () => import('@/components/rb/ElectricBorder');
const loadDecrypt = () => import('@/components/rb/DecryptedText');

/**
 * React Bits ElectricBorder drawn as an overlay on the checkout card. It sits on top of the card
 * (pointer events off) instead of wrapping it, so the checkout never remounts when it loads.
 */
export function CheckoutElectric() {
  const ElectricBorder = useFxModule(loadElectric);
  if (!ElectricBorder) return null;
  return (
    <div
      data-fx="electric"
      aria-hidden="true"
      className="fx-in pointer-events-none absolute inset-0 z-[1]"
    >
      <ElectricBorder
        color="#C6F432"
        speed={0.6}
        chaos={0.35}
        thickness={1.5}
        borderRadius={26}
        glow={0.6}
        className="h-full w-full"
      />
    </div>
  );
}

/** Hash text that decrypts into place on desktop; plain text otherwise. */
export function DecryptHash({ text }: { text: string }) {
  const DecryptedText = useFxModule(loadDecrypt);
  if (!DecryptedText) return <span className="text-info">{text}</span>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        <DecryptedText
          text={text}
          animateOn="view"
          sequential
          speed={35}
          className="text-info"
          encryptedClassName="text-faint"
        />
      </span>
    </>
  );
}
