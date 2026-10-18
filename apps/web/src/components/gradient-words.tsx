'use client';

import type { ReactNode } from 'react';
import { useFxModule } from '@/lib/fx';

const loadGradient = () => import('@/components/rb/GradientText');

/**
 * React Bits GradientText on desktop (loaded after idle via useFxModule); phones, reduced
 * motion and automation get the same colours as a static CSS gradient.
 */
export function GradientWords({
  colors,
  children,
  speed = 6,
}: {
  colors: string[];
  children: ReactNode;
  speed?: number;
}) {
  const GradientText = useFxModule(loadGradient);
  if (!GradientText)
    return (
      <span
        className="bg-clip-text text-transparent [-webkit-background-clip:text]"
        style={{ backgroundImage: `linear-gradient(90deg, ${colors.join(', ')})` }}
      >
        {children}
      </span>
    );
  return (
    <span data-fx="gradient-text">
      <GradientText colors={colors} animationSpeed={speed} className="!mx-0 !inline-flex">
        {children}
      </GradientText>
    </span>
  );
}
