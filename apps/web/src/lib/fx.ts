'use client';

import { useEffect, useState } from 'react';

// Heavy decorative effects (WebGL, gsap, motion) only run on a desktop-class device with a fine
// pointer, without prefers-reduced-motion, and only after the page has loaded and gone idle.
// Everything they decorate has a static CSS fallback, so phones never download them.
const DESKTOP = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const REDUCE = '(prefers-reduced-motion: reduce)';

let idleReady: Promise<void> | null = null;

/**
 * Automated browsers (CI e2e, audits) get the static fallbacks so software-rendered WebGL does not
 * starve timing-sensitive tests. A test that checks the effects opts in with `window.__TM_FX__`.
 */
function automated(): boolean {
  return navigator.webdriver === true && !(window as Window & { __TM_FX__?: boolean }).__TM_FX__;
}

function afterLoadAndIdle(): Promise<void> {
  idleReady ??= new Promise<void>((resolve) => {
    const idle = () =>
      window.requestIdleCallback
        ? window.requestIdleCallback(() => resolve(), { timeout: 3000 })
        : window.setTimeout(resolve, 1500);
    if (document.readyState === 'complete') idle();
    else window.addEventListener('load', idle, { once: true });
  });
  return idleReady;
}

/** True once heavy effects may run here (see above). Always false on the server. */
export function useDesktopFx(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || automated()) return;
    const desktop = window.matchMedia(DESKTOP);
    const reduce = window.matchMedia(REDUCE);
    let ready = false;
    let alive = true;
    const update = () => alive && setOn(ready && desktop.matches && !reduce.matches);
    // Keep listening either way: a window resized to desktop, or motion re-enabled, opts in later.
    void afterLoadAndIdle().then(() => {
      ready = true;
      update();
    });
    desktop.addEventListener('change', update);
    reduce.addEventListener('change', update);
    return () => {
      alive = false;
      desktop.removeEventListener('change', update);
      reduce.removeEventListener('change', update);
    };
  }, []);
  return on;
}

/**
 * Loads a lazily split module once desktop effects are allowed; null until then (and always on
 * phones), so callers render their static fallback.
 */
export function useFxModule<T>(load: () => Promise<{ default: T }>): T | null {
  const fx = useDesktopFx();
  const [mod, setMod] = useState<{ value: T } | null>(null);
  useEffect(() => {
    if (!fx || mod) return;
    let alive = true;
    load()
      .then((loaded) => alive && setMod({ value: loaded.default }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // `load` is a stable module-level import thunk, so it is not a dependency.
  }, [fx, mod]);
  return fx && mod ? mod.value : null;
}
