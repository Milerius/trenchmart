'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import StarBorder from '@/components/rb/StarBorder';

/**
 * The one primary call to action per view: an accent pill with React Bits StarBorder lights
 * running round its edge. The canvas idles off screen, and stays still with reduced motion.
 */
export function PrimaryCta({
  href,
  children,
  className = '',
  ...rest
}: { href: string; children: ReactNode; className?: string } & Omit<
  ComponentProps<typeof Link>,
  'href' | 'children' | 'className' | 'as'
>) {
  return (
    <StarBorder<typeof Link>
      as={Link}
      href={href}
      color="#C6F432"
      trailColor="#7CC4FF"
      radius={999}
      thickness={1.5}
      duration={4}
      stars={2}
      glow={1}
      sparkle
      hover="lap"
      backgroundColor="var(--color-accent)"
      textColor="var(--color-onaccent)"
      borderColor="rgba(198, 244, 50, 0.35)"
      className={`motion-press h-12 !px-6 !py-0 text-[15px] font-semibold hover:brightness-110 ${className}`}
      {...rest}
    >
      {children}
    </StarBorder>
  );
}
