'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TERMINALS } from '@trenchmart/shared/terminals';
import { TerminalMark } from '@/components/terminal-logo';
import { useFxModule } from '@/lib/fx';

// Desktop-only React Bits effects for home. Each is a separate lazy chunk loaded after idle (see
// lib/fx.ts); until then, and always on phones or with reduced motion, the static fallback renders.

const loadAurora = () => import('@/components/rb/Aurora');
const loadShiny = () => import('@/components/rb/ShinyText');
const loadRotating = () => import('@/components/rb/RotatingText');
const loadLogoLoop = () => import('@/components/rb/LogoLoop');
const loadCountUp = () => import('@/components/rb/CountUp');
const loadBorderGlow = () => import('@/components/rb/BorderGlow');
const loadRays = () => import('@/components/rb/LightRays');
const loadSplit = () => import('@/components/rb/SplitText');

/** WebGL aurora behind the hero. The static fallback is the `.hero-aurora` CSS gradient. */
export function HeroAurora() {
  const Aurora = useFxModule(loadAurora);
  if (!Aurora) return null;
  return (
    // Dimmed well below the prototype's raw values: the hero copy sits on top of it and must stay
    // readable at every frame (body text keeps 4.5:1 or better; see the hero contrast test).
    <div
      data-fx="aurora"
      aria-hidden="true"
      className="fx-in pointer-events-none absolute inset-0 opacity-45"
    >
      <Aurora
        colorStops={['#C6F432', '#3b82ff', '#a66bff']}
        amplitude={0.7}
        blend={0.5}
        speed={0.6}
        glow={0.6}
        brightness={0.8}
        height={1}
        scale={1.2}
      />
    </div>
  );
}

/** Shine sweep across a short accent phrase; plain text until loaded. */
export function Shiny({ text }: { text: string }) {
  const ShinyText = useFxModule(loadShiny);
  if (!ShinyText) return <>{text}</>;
  return <ShinyText text={text} color="#C6F432" shineColor="#ffffff" speed={3} />;
}

const ROTATING = ['userscripts', 'wallet lists', 'terminal filters', 'full setups', 'alert bots'];
// A solid dark pill so the word reads on any frame of the aurora behind it.
const ROTATING_CLASS =
  'inline-flex overflow-hidden rounded-md bg-[#0b0d0b]/90 px-2 font-medium text-accent ring-1 ring-accent/35';

/** "Trading <thing>" word rotator; the fallback shows the first word in the same pill. */
export function TradingWords() {
  const RotatingText = useFxModule(loadRotating);
  if (!RotatingText) return <span className={ROTATING_CLASS}>{ROTATING[0]}</span>;
  return (
    <RotatingText
      texts={ROTATING}
      effect="slide"
      rotationInterval={2800}
      mainClassName={ROTATING_CLASS}
      // A quick swap: the pill is never empty for long, so the word stays readable.
      transition={{ type: 'tween', duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      staggerDuration={0.008}
    />
  );
}

function TerminalChip({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap text-[22px] font-semibold tracking-[-0.03em] text-ink-2">
      <TerminalMark name={name} className="h-7 w-7 rounded-md" />
      {name}
    </span>
  );
}

/** Supported terminals: a LogoLoop marquee on desktop, a static row everywhere else. */
export function TerminalBand() {
  const LogoLoop = useFxModule(loadLogoLoop);
  return (
    <section
      aria-label="Supported terminals"
      data-testid="terminal-band"
      className="border-y border-line-soft bg-inset/60 py-6"
    >
      {LogoLoop ? (
        <LogoLoop
          logos={TERMINALS.map((name) => ({ node: <TerminalChip name={name} />, title: name }))}
          speed={60}
          gap={72}
          logoHeight={28}
          pauseOnHover
          fadeOut
          fadeOutColor="#070807"
          ariaLabel="Supported terminals"
        />
      ) : (
        // Phones: a CSS-only marquee (compositor transform, no JS); reduced motion wraps instead.
        <div className="terminal-marquee overflow-hidden">
          <div className="terminal-track">
            <ul className="m-0 flex items-center gap-x-[72px] gap-y-4 p-0 pr-[72px]">
              {TERMINALS.map((name) => (
                <li key={name} className="shrink-0 list-none">
                  <TerminalChip name={name} />
                </li>
              ))}
            </ul>
            <ul
              aria-hidden="true"
              className="terminal-copy m-0 items-center gap-x-[72px] p-0 pr-[72px]"
            >
              {TERMINALS.map((name) => (
                <li key={name} className="shrink-0 list-none">
                  <TerminalChip name={name} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * A stat that renders its final value at once. On desktop it rolls up with React Bits CountUp, but
 * only from the moment it scrolls into view, so it never shows 0 while off screen.
 */
export function StatCount({ value }: { value: number }) {
  const CountUp = useFxModule(loadCountUp);
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!CountUp || seen || !el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [CountUp, seen]);
  return (
    <span ref={ref} data-testid="count-up" data-value={value}>
      {CountUp && seen ? (
        <CountUp to={value} separator="," duration={1.6} />
      ) : (
        value.toLocaleString('en-US')
      )}
    </span>
  );
}

/** Animated conic glow border on desktop; a plain bordered panel otherwise. */
export function GlowPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const BorderGlow = useFxModule(loadBorderGlow);
  if (!BorderGlow)
    return (
      <div
        className={`rounded-[26px] border border-white/10 bg-[rgba(12,14,12,0.92)] ${className}`}
      >
        {children}
      </div>
    );
  return (
    <BorderGlow
      glowColor="84 90 60"
      colors={['#C6F432', '#7CC4FF', '#C9A2FF']}
      backgroundColor="rgba(12,14,12,.82)"
      borderRadius={26}
      animated
      className={`backdrop-blur-xl ${className}`}
    >
      {children}
    </BorderGlow>
  );
}

/** WebGL light rays for the sell CTA panel; the CSS glow behind it is the fallback. */
export function CtaRays() {
  const LightRays = useFxModule(loadRays);
  if (!LightRays) return null;
  return (
    <div data-fx="rays" aria-hidden="true" className="fx-in pointer-events-none absolute inset-0">
      <LightRays
        raysOrigin="top-center"
        raysColor="#C6F432"
        raysSpeed={0.8}
        lightSpread={0.9}
        rayLength={1.4}
        followMouse
        mouseInfluence={0.08}
      />
    </div>
  );
}

/**
 * Hero display line with the React Bits split-letter entrance (on load). Static text until the
 * chunk is in; the heading keeps its accessible name from a screen-reader copy.
 */
export function SplitLine({ text }: { text: string }) {
  const SplitText = useFxModule(loadSplit);
  if (!SplitText) return <span className="block">{text} </span>;
  return (
    <>
      <span className="sr-only">{text} </span>
      <span aria-hidden="true" className="block">
        <SplitText
          text={text}
          tag="span"
          effect="rise"
          splitType="chars"
          delay={28}
          duration={0.9}
          trigger="load"
          className="block"
        />
      </span>
    </>
  );
}
