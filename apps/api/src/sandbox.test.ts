import { describe, expect, it } from 'vitest';
import { runIsolatedSandbox } from './sandbox';

const clean = `// ==UserScript==
// @name clean
// @match https://axiom.trade/*
// @grant none
// ==/UserScript==
console.log('ok');
`;

describe('isolated sandbox', () => {
  it('fails a script that signs on load and passes a script that does not', () => {
    const bad = runIsolatedSandbox(`${clean}\nwindow.solana.signTransaction({ tx: 1 });`, 0);
    expect(bad.verdict).toBe('fail');
    expect(bad.walletCalls).toContain('signTransaction');
    const good = runIsolatedSandbox(clean, 0);
    expect(good.verdict).toBe('pass');
    expect(good.walletCalls).toEqual([]);
  });
});
