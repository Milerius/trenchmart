'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import SpotlightCard, { type SpotlightShape } from '@/components/rb/SpotlightCard';

/**
 * React Bits SpotlightCard with TrenchMart tokens: surface fill, 1px line border and a
 * category-tinted pointer light (also follows keyboard focus). Pure DOM, no canvas: the light
 * only animates while a pointer is near, and reduced motion snaps instead of easing.
 */
export function Spot({
  color = '#C6F432',
  alpha = '38',
  shape = 'circle',
  surface = 'var(--color-surface)',
  border = 'var(--color-line)',
  className = '',
  style,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'color'> & {
  /** Hex colour of the light (category colour). */
  color?: string;
  /** Hex alpha appended to `color` (light strength). */
  alpha?: string;
  shape?: SpotlightShape;
  surface?: string;
  border?: string;
  children: ReactNode;
}) {
  return (
    <SpotlightCard
      spotlightColor={`${color}${alpha}`}
      shape={shape}
      intensity={0.35}
      borderGlow={0.6}
      className={`!rounded-card !p-0 ${className}`}
      style={
        {
          '--spotlight-card-surface': surface,
          '--spotlight-card-border': border,
          '--spotlight-card-shadow': 'none',
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      {children}
    </SpotlightCard>
  );
}
