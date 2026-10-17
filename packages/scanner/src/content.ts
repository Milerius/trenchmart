import { isMediaUrl, markdownRefs, markdownText, mediaIdOf } from '@trenchmart/shared';
import type { CheckResult, ScanCheck } from './scan';

/**
 * Moderation for listing pages (README, How to use, requirements, image alt text).
 * The renderer already makes the Markdown inert; these checks look for intent: links that
 * phish, ask for a seed phrase, push an off-platform download or try script injection.
 */

export const CONTENT_ENGINE_VER = 'content@1.0.0';

export type ContentInput = {
  readme: string;
  howto: string;
  requirements: string;
  alts?: string[];
  /** Media ids this listing owns. A README may only embed these. */
  ownMediaIds: Set<string>;
  blocklistHosts?: string[];
};

const OFFICIAL: Record<string, string[]> = {
  phantom: ['phantom.app', 'phantom.com'],
  solflare: ['solflare.com'],
  backpack: ['backpack.app', 'backpack.exchange'],
  raydium: ['raydium.io'],
  metamask: ['metamask.io'],
  coinbase: ['coinbase.com'],
  binance: ['binance.com'],
  gmgn: ['gmgn.ai'],
  bullx: ['bullx.io'],
  axiomtrade: ['axiom.trade'],
  pumpfun: ['pump.fun'],
  jupag: ['jup.ag'],
  trojan: ['trojan.com', 'trojanonsolana.com'],
  trenchmart: ['trenchmart.fun'],
  tampermonkey: ['tampermonkey.net'],
  telegram: ['telegram.org', 't.me'],
  solscan: ['solscan.io'],
};

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'cutt.ly',
  'rb.gy',
  'shorturl.at',
  'ow.ly',
  'tiny.cc',
  'rebrand.ly',
  'buff.ly',
  'shorte.st',
  'adf.ly',
]);
const FILE_HOSTS = new Set([
  'mega.nz',
  'mediafire.com',
  'dropbox.com',
  'drive.google.com',
  'gofile.io',
  'anonfiles.com',
  'wetransfer.com',
  'pixeldrain.com',
  'sendspace.com',
  'files.catbox.moe',
]);
const EXECUTABLE =
  /\.(exe|msi|scr|bat|cmd|ps1|vbs|jse?|jar|apk|dmg|pkg|deb|rpm|appimage|sh|hta|lnk|crx|xpi)$/i;
const ARCHIVE = /\.(zip|rar|7z|iso|js|user\.js)$/i;
const DICTIONARY = new Set(['finance', 'phantoms']);
const DANGEROUS_HTML =
  /<\s*\/?\s*(script|iframe|object|embed|form|meta|link|base|style|svg|math)\b|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;
const SECRET =
  /\b(seed|secret|recovery|backup)\s*(phrase|words?)\b|\bmnemonic\b|\bprivate\s*key\b|\bsecret\s*key\b|\b(12|24)[\s-]*words?\b/i;
const ASK =
  /\b(enter|paste|type|input|share|send|submit|provide|import|give|dm|upload|fill|verify|connect|sync|validate)\b/i;
const NEGATION =
  /\b(never|don['’]?t|do\s+not|won['’]?t|will\s+not|no\s+one|nobody|not|no\s+need|without)\b/i;

function check(ruleId: string, result: CheckResult, title: string, detail: string): ScanCheck {
  return { ruleId, result, title, detail, locations: [] };
}

function registrable(host: string): string {
  const parts = host.split('.');
  return parts.slice(-2).join('.');
}

function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function deconfuse(value: string): string {
  return value
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/0/g, 'o')
    .replace(/[1|]/g, 'l')
    .replace(/3/g, 'e')
    .replace(/5/g, 's')
    .replace(/[^a-z]/g, '');
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** A brand this host imitates without being on one of its official domains, or null. */
export function lookalikeOf(host: string): string | null {
  const lower = host.toLowerCase().replace(/\.$/, '');
  for (const domains of Object.values(OFFICIAL)) {
    if (domains.some((domain) => onDomain(lower, domain))) return null;
  }
  const flat = deconfuse(lower);
  const label = deconfuse(registrable(lower).split('.')[0] ?? '');
  for (const [brand, domains] of Object.entries(OFFICIAL)) {
    if (brand.length >= 5 && flat.includes(brand)) return domains[0]!;
    if (
      brand.length >= 6 &&
      label.length >= 5 &&
      !DICTIONARY.has(label) &&
      distance(label, brand) === 1
    ) {
      return domains[0]!;
    }
  }
  return null;
}

type Link = { url: string; where: string };

function withoutCode(md: string): string {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

export function scanContent(input: ContentInput): ScanCheck[] {
  const sections: [string, string][] = [
    ['README', input.readme],
    ['How to use', input.howto],
    ['Requirements', input.requirements],
  ];
  const links: Link[] = [];
  const images: Link[] = [];
  const html: string[] = [];
  let prose = (input.alts ?? []).join('\n');
  for (const [where, md] of sections) {
    if (!md.trim()) continue;
    const refs = markdownRefs(md);
    links.push(...refs.links.map((link) => ({ url: link.url, where })));
    images.push(...refs.images.map((url) => ({ url, where })));
    html.push(...refs.html);
    // Bare URLs in text (not autolinked) still steer readers.
    for (const match of md.matchAll(/\bhttps?:\/\/[^\s<>()"'`\]]+/gi)) {
      if (!links.some((link) => link.url === match[0])) links.push({ url: match[0], where });
    }
    prose += `\n${markdownText(md)}`;
  }
  const block = new Set((input.blocklistHosts ?? []).map((host) => host.toLowerCase()));
  const checks: ScanCheck[] = [];

  // Schemes: anything but http(s), mailto, same-page anchors or site paths is hostile.
  const badScheme = [...links, ...images].filter(({ url }) => {
    // eslint-disable-next-line no-control-regex
    const value = url.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '');
    if (!value || value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) {
      return false;
    }
    const parsed = parseUrl(value);
    return !parsed || !['https:', 'http:', 'mailto:'].includes(parsed.protocol);
  });
  // Text the parser did not turn into a link ("java\tscript:") is inert, but writing it is
  // still an injection attempt.
  const outsideCode = sections.map(([, md]) => withoutCode(md));
  const rawScheme = outsideCode.some((md) =>
    /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:|data\s*:\s*text\/html/i.test(
      md,
    ),
  );
  if (rawScheme && !badScheme.length) badScheme.push({ url: 'javascript: in text', where: 'page' });
  checks.push(
    badScheme.length
      ? check(
          'content-link-scheme',
          'fail',
          'Link schemes',
          `Unsafe link target: ${badScheme
            .slice(0, 3)
            .map((l) => l.url.slice(0, 60))
            .join(', ')}`,
        )
      : check('content-link-scheme', 'pass', 'Link schemes', 'Links are https, http or mailto.'),
  );

  // Code blocks may show HTML on purpose; anywhere else a script-capable tag is an attempt,
  // even when the parser left it as text.
  const dangerous = [...html, ...outsideCode].filter((fragment) => DANGEROUS_HTML.test(fragment));
  checks.push(
    dangerous.length
      ? check(
          'content-html',
          'fail',
          'Raw HTML',
          `Script-capable HTML in the page: ${(DANGEROUS_HTML.exec(dangerous[0]!)?.[0] ?? '').trim()}`,
        )
      : html.length
        ? check(
            'content-html',
            'warn',
            'Raw HTML',
            'Raw HTML is shown as plain text to buyers. Use Markdown instead.',
          )
        : check('content-html', 'pass', 'Raw HTML', 'No raw HTML.'),
  );

  const hosts = links
    .map((link) => ({ ...link, parsed: parseUrl(link.url) }))
    .filter(
      (link): link is Link & { parsed: URL } =>
        !!link.parsed && /^https?:$/.test(link.parsed.protocol),
    );
  const phishing: string[] = [];
  for (const { parsed, url } of hosts) {
    const host = parsed.hostname.toLowerCase();
    if (parsed.username || parsed.password)
      phishing.push(`${url.slice(0, 60)} (credentials in URL)`);
    else if (host.split('.').some((label) => label.startsWith('xn--')))
      phishing.push(`${host} (punycode)`);
    else {
      const brand = lookalikeOf(host);
      if (brand) phishing.push(`${host} (imitates ${brand})`);
    }
    if (block.has(host) || block.has(registrable(host))) phishing.push(`${host} (blocklisted)`);
  }
  checks.push(
    phishing.length
      ? check(
          'content-phishing',
          'fail',
          'Phishing links',
          `Lookalike or blocklisted domains: ${[...new Set(phishing)].slice(0, 4).join(', ')}`,
        )
      : check(
          'content-phishing',
          'pass',
          'Phishing links',
          'No lookalike, punycode or blocklisted domains.',
        ),
  );

  const ipOrShort = hosts.filter(({ parsed }) => {
    const host = parsed.hostname.toLowerCase();
    return SHORTENERS.has(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
  });
  const plainHttp = hosts.filter(({ parsed }) => parsed.protocol === 'http:');
  const warnLinks = [
    ...ipOrShort.map((l) => `${l.parsed.hostname} (shortener or IP)`),
    ...plainHttp.map((l) => `${l.parsed.hostname} (not https)`),
  ];
  checks.push(
    warnLinks.length
      ? check(
          'content-link-hygiene',
          'warn',
          'Link hygiene',
          `Readers can't see where these go: ${[...new Set(warnLinks)].slice(0, 4).join(', ')}`,
        )
      : check(
          'content-link-hygiene',
          'pass',
          'Link hygiene',
          'No shorteners, raw IPs or plain http links.',
        ),
  );

  const executables = hosts.filter(({ parsed }) => EXECUTABLE.test(parsed.pathname));
  const fileHosts = hosts.filter(({ parsed }) => {
    const host = parsed.hostname.toLowerCase();
    return (
      [...FILE_HOSTS].some((domain) => onDomain(host, domain)) || ARCHIVE.test(parsed.pathname)
    );
  });
  checks.push(
    executables.length
      ? check(
          'content-offsite-download',
          'fail',
          'Off-platform downloads',
          `Links to downloadable programs outside TrenchMart: ${executables
            .slice(0, 3)
            .map((l) => l.url.slice(0, 70))
            .join(', ')}`,
        )
      : fileHosts.length
        ? check(
            'content-offsite-download',
            'warn',
            'Off-platform downloads',
            `File-sharing or archive links bypass the scan and escrow: ${fileHosts
              .slice(0, 3)
              .map((l) => l.url.slice(0, 70))
              .join(', ')}`,
          )
        : check(
            'content-offsite-download',
            'pass',
            'Off-platform downloads',
            'The file is only delivered through TrenchMart.',
          ),
  );

  const asks = prose
    .split(/(?<=[.!?\n])\s+|\n+/)
    .filter((sentence) => SECRET.test(sentence) && ASK.test(sentence) && !NEGATION.test(sentence));
  checks.push(
    asks.length
      ? check(
          'content-secret-request',
          'fail',
          'Seed phrase requests',
          `Asks buyers for wallet secrets: "${asks[0]!.trim().slice(0, 100)}"`,
        )
      : check(
          'content-secret-request',
          'pass',
          'Seed phrase requests',
          'Never asks for a seed phrase or private key.',
        ),
  );

  const foreign = images.filter(
    ({ url }) => isMediaUrl(url) && !input.ownMediaIds.has(mediaIdOf(url) ?? ''),
  );
  const remote = images.filter(({ url }) => !isMediaUrl(url));
  checks.push(
    foreign.length
      ? check(
          'content-images',
          'fail',
          'Embedded images',
          'Embeds images uploaded to another listing.',
        )
      : remote.length
        ? check(
            'content-images',
            'warn',
            'Embedded images',
            `External images are removed when shown (no hotlinking): ${remote
              .slice(0, 3)
              .map((l) => l.url.slice(0, 60))
              .join(', ')}. Upload them instead.`,
          )
        : check(
            'content-images',
            'pass',
            'Embedded images',
            'Only this listing’s uploaded images.',
          ),
  );
  return checks;
}

/** Media ids a page references (gallery and README embeds), for public serving. */
export function contentMediaIds(markdown: string[]): string[] {
  const ids = new Set<string>();
  for (const md of markdown) {
    for (const url of markdownRefs(md).images) {
      const id = mediaIdOf(url);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
