import { describe, expect, it } from 'vitest';
import { contentMediaIds, lookalikeOf, scanContent } from './content';

const OWN = 'a3f1c2d4-1111-4222-8333-444455556666';
const OTHER = 'b3f1c2d4-1111-4222-8333-444455556666';

function verdicts(readme: string, extra: Partial<Parameters<typeof scanContent>[0]> = {}) {
  const checks = scanContent({
    readme,
    howto: '',
    requirements: '',
    ownMediaIds: new Set([OWN]),
    ...extra,
  });
  return Object.fromEntries(checks.map((c) => [c.ruleId, c.result]));
}

describe('listing content moderation', () => {
  it('passes an honest README with official links and its own images', () => {
    const result = verdicts(
      `## Install\n1. Get [Tampermonkey](https://www.tampermonkey.net/).\n2. Open [Trojan](https://trojan.com/).\n\n![panel](/api/v1/media/${OWN})\n\nNever share your seed phrase with anyone.`,
    );
    expect(Object.values(result).every((r) => r === 'pass')).toBe(true);
  });

  it('fails javascript:, data: and vbscript: links in every syntax', () => {
    for (const md of [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](java\tscript:alert(1))',
      '[x](&#106;avascript:alert(1))',
      '<javascript:alert(1)>',
      '[x][r]\n\n[r]: javascript:alert(1)',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](vbscript:msgbox)',
      '![x](javascript:alert(1))',
    ]) {
      expect(verdicts(md)['content-link-scheme'], md).toBe('fail');
    }
  });

  it('fails script-capable raw HTML and warns on harmless HTML', () => {
    expect(verdicts('<script>alert(1)</script>')['content-html']).toBe('fail');
    expect(verdicts('<img src=x onerror=alert(1)>')['content-html']).toBe('fail');
    expect(verdicts('<iframe src="https://evil.example"></iframe>')['content-html']).toBe('fail');
    expect(verdicts('text <svg/onload=alert(1)>')['content-html']).toBe('fail');
    expect(verdicts('<details><summary>More</summary>hi</details>')['content-html']).toBe('warn');
  });

  it('fails lookalike, punycode, credential and blocklisted domains', () => {
    for (const md of [
      '[claim](https://phantom-wallet-airdrop.com/claim)',
      '[app](https://phant0m.app)',
      '[swap](https://jup-ag.io)',
      '[login](https://axiom-trade.net/login)',
      '[x](https://xn--phntom-0ra.app)',
      '[x](https://phantom.app@evil.example/)',
      '[bot](https://tr0janbot.xyz)',
    ]) {
      expect(verdicts(md)['content-phishing'], md).toBe('fail');
    }
    expect(
      verdicts('[x](https://evil.example)', { blocklistHosts: ['evil.example'] })[
        'content-phishing'
      ],
    ).toBe('fail');
    for (const ok of [
      'https://phantom.app/download',
      'https://docs.phantom.com',
      'https://data-gateway.api.trojan.com/v1',
      'https://finance.yahoo.com',
      'https://github.com/x/y',
    ]) {
      expect(verdicts(`[ok](${ok})`)['content-phishing'], ok).toBe('pass');
    }
    expect(lookalikeOf('solflare.com')).toBeNull();
    expect(lookalikeOf('so1flare.com')).toBe('solflare.com');
  });

  it('warns on shorteners, raw IPs and plain http', () => {
    expect(verdicts('[x](https://bit.ly/abc)')['content-link-hygiene']).toBe('warn');
    expect(verdicts('see http://203.0.113.9/panel')['content-link-hygiene']).toBe('warn');
    expect(verdicts('[x](http://example.com)')['content-link-hygiene']).toBe('warn');
  });

  it('fails off-platform programs and warns on file hosts and archives', () => {
    expect(verdicts('[setup](https://cdn.example.com/setup.exe)')['content-offsite-download']).toBe(
      'fail',
    );
    expect(verdicts('[ext](https://x.example/helper.crx)')['content-offsite-download']).toBe(
      'fail',
    );
    expect(verdicts('[zip](https://mega.nz/file/abc)')['content-offsite-download']).toBe('warn');
    expect(verdicts('[zip](https://example.com/pack.zip)')['content-offsite-download']).toBe(
      'warn',
    );
  });

  it('fails requests for a seed phrase or private key, but not warnings about them', () => {
    for (const md of [
      'To activate, paste your seed phrase in the settings box.',
      'Import your private key so the bot can trade.',
      'Enter your 12 word recovery phrase to sync.',
      'DM your secret key to support for verification.',
    ]) {
      expect(verdicts(md)['content-secret-request'], md).toBe('fail');
    }
    expect(
      verdicts('This script never asks for your seed phrase or private key.')[
        'content-secret-request'
      ],
    ).toBe('pass');
    expect(verdicts("Don't ever paste your private key anywhere.")['content-secret-request']).toBe(
      'pass',
    );
    expect(
      scanContent({
        readme: '',
        howto: '',
        requirements: '',
        alts: ['Paste your seed phrase here'],
        ownMediaIds: new Set(),
      }).find((c) => c.ruleId === 'content-secret-request')?.result,
    ).toBe('fail');
  });

  it("allows only this listing's media, and warns on hotlinked images", () => {
    expect(verdicts(`![x](https://trenchmart.fun/api/v1/media/${OWN})`)['content-images']).toBe(
      'pass',
    );
    expect(verdicts(`![x](/api/v1/media/${OTHER})`)['content-images']).toBe('fail');
    expect(verdicts('![x](https://imgur.example/a.png)')['content-images']).toBe('warn');
    expect(
      verdicts(`![x](https://trenchmart.fun.evil.example/api/v1/media/${OWN})`)['content-images'],
    ).toBe('warn');
    expect(contentMediaIds([`![a](/api/v1/media/${OWN}) ![b](https://x.example/b.png)`])).toEqual([
      OWN,
    ]);
  });
});

describe('content moderation and code samples', () => {
  it('lets code blocks show HTML without failing', () => {
    const md = 'Example:\n\n```html\n<script src="x.js"></script>\n```\n\nInline `<iframe>` too.';
    expect(verdicts(md)['content-html']).toBe('pass');
  });
});
