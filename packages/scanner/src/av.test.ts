import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { clamAvHttpClient, EICAR, scan, signatureScan } from './index';

const enc = (s: string) => new TextEncoder().encode(s);
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));

function avOf(out: Awaited<ReturnType<typeof scan>>) {
  return out.checks.find((c) => c.ruleId === 'av-signatures');
}

describe('signature antivirus', () => {
  it('detects the EICAR test file by hash and by string, in any category and inside zips', async () => {
    const hits = await signatureScan(enc(EICAR));
    expect(hits.map((h) => h.signature)).toEqual(
      expect.arrayContaining(['EICAR-Test-File (sha256)', 'EICAR-Test-File']),
    );
    const md = await scan({ name: 'notes.md', bytes: enc(`# notes\n${EICAR}\n`) }, 'strategy');
    expect(avOf(md)?.result).toBe('fail');
    expect(md.summary).toBe('fail');
    const { zipSync } = await import('fflate');
    const zip = zipSync({ 'a/readme.md': enc(EICAR) }, { level: 0 });
    const out = await scan({ name: 'setup.zip', bytes: zip }, 'setup');
    expect(out.checks.find((c) => c.ruleId === 'zip:a/readme.md:av-signatures')?.result).toBe(
      'fail',
    );
  });

  it('flags native executables', async () => {
    const pe = new Uint8Array(128);
    pe.set([0x4d, 0x5a]);
    pe[60] = 64;
    pe.set([0x50, 0x45, 0, 0], 64);
    expect((await signatureScan(pe)).map((h) => h.signature)).toContain('Executable.PE');
    expect(
      (await signatureScan(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1]))).map((h) => h.signature),
    ).toContain('Executable.ELF');
  });

  it('detects drainer kits and miners, warns on exfil channels, passes the Trojan script', async () => {
    expect((await signatureScan(enc('const kit = "Inferno Drainer v3";')))[0]?.severity).toBe(
      'fail',
    );
    expect((await signatureScan(enc("new CoinHive.Anonymous('k').start()")))[0]?.signature).toBe(
      'Miner.CoinHive',
    );
    expect((await signatureScan(enc("ws('stratum+tcp://pool:3333')")))[0]?.signature).toBe(
      'Miner.Stratum',
    );
    expect(
      (await signatureScan(enc('fetch("https://api.telegram.org/bot123:abc/sendMessage")')))[0]
        ?.severity,
    ).toBe('warn');
    const trojan = await scan(
      { name: 'trojan-trenches-intel.user.js', bytes: fixture('trojan-trenches-intel.user.js') },
      'userscript',
    );
    expect(avOf(trojan)?.result).toBe('pass');
  });

  it('honours an operator hash blocklist', async () => {
    const bytes = enc('harmless looking payload');
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(await signatureScan(bytes)).toEqual([]);
    const out = await scan({ name: 'f.json', bytes }, 'filter', {
      blockedSha256: [hash.toUpperCase()],
    });
    expect(avOf(out)?.result).toBe('fail');
  });

  it('uses a ClamAV service when configured and never treats its failure as clean', async () => {
    const bytes = enc('{"name":"x"}');
    const infected = await scan({ name: 'f.json', bytes }, 'filter', {
      antivirus: async () => ({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' }),
    });
    expect(avOf(infected)?.result).toBe('fail');
    expect(avOf(infected)?.detail).toContain('Win.Test.EICAR_HDB-1');
    const down = await scan({ name: 'f.json', bytes }, 'filter', {
      antivirus: async () => ({ status: 'error', detail: 'ClamAV service unreachable: TypeError' }),
    });
    expect(avOf(down)?.result).toBe('warn');
    const clean = await scan({ name: 'f.json', bytes }, 'filter', {
      antivirus: async () => ({ status: 'clean' }),
    });
    expect(avOf(clean)?.detail).toContain('ClamAV');
  });

  it('HTTP ClamAV client maps responses and errors', async () => {
    const file = { name: 'x.js', bytes: enc('x') };
    const ok = vi.fn(async () => Response.json({ infected: false }));
    expect(
      await clamAvHttpClient('https://av.test/scan', { fetchImpl: ok, token: 't' })(file),
    ).toEqual({ status: 'clean' });
    const call = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer t');
    const bad = async () => Response.json({ infected: true, signature: 'Js.Miner' });
    expect(await clamAvHttpClient('u', { fetchImpl: bad })(file)).toEqual({
      status: 'infected',
      signature: 'Js.Miner',
    });
    const err = async () => new Response('no', { status: 502 });
    expect((await clamAvHttpClient('u', { fetchImpl: err })(file)).status).toBe('error');
    const weird = async () => Response.json({ ok: 1 });
    expect((await clamAvHttpClient('u', { fetchImpl: weird })(file)).status).toBe('error');
    const thrown = async () => {
      throw new TypeError('down');
    };
    expect((await clamAvHttpClient('u', { fetchImpl: thrown })(file)).status).toBe('error');
  });
});

describe('obfuscation heuristic', () => {
  it('passes the real Trojan userscript statically (no rotator false positive)', async () => {
    const out = await scan(
      { name: 'trojan-trenches-intel.user.js', bytes: fixture('trojan-trenches-intel.user.js') },
      'userscript',
    );
    const obf = out.checks.find((c) => c.ruleId === 'no-obfuscation');
    expect(obf?.result).toBe('pass');
    expect(out.checks.filter((c) => c.result === 'fail')).toEqual([]);
  });

  it('fails real javascript-obfuscator output, with hex and with mangled identifiers', async () => {
    for (const name of ['obfuscator-io-hex.js', 'obfuscator-io-mangled.js']) {
      const out = await scan({ name, bytes: fixture(name) }, 'userscript');
      const obf = out.checks.find((c) => c.ruleId === 'no-obfuscation');
      expect(obf?.result, name).toBe('fail');
      expect(obf?.detail, name).toContain('string-array rotator pattern');
    }
  });

  it('does not flag ordinary queue code that uses push and shift on different arrays', async () => {
    const body = `
      const labels = [${Array.from({ length: 30 }, (_, i) => `'label${i}'`).join(', ')}];
      const queue = []; const done = [];
      function next() { const job = queue.shift(); if (job) done.push(job); }
      queue.push('a'); next();
    `;
    const src = `// ==UserScript==\n// @name q\n// @match https://axiom.trade/*\n// @grant none\n// ==/UserScript==\n${body}`;
    const out = await scan({ name: 'q.user.js', bytes: enc(src) }, 'userscript');
    expect(out.checks.find((c) => c.ruleId === 'no-obfuscation')?.result).toBe('pass');
  });
});
