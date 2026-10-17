import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import bs58 from 'bs58';
import { unzipSync } from 'fflate';
import { arrayBufferOf, filterPresetSchema } from '@trenchmart/shared';
import { listZip, unsafeZipPath, unixModeIsSymlink, type ZipEntryMeta } from './zip';

export const ENGINE_VER = 'scanner@1.0.0';

export type CheckResult = 'pass' | 'warn' | 'fail' | 'na';

export type ScanLocation = { line: number; col: number; snippet: string };

export type ScanCheck = {
  ruleId: string;
  result: CheckResult;
  title: string;
  detail: string;
  locations: ScanLocation[];
};

export type Declared = {
  match: string[];
  include: string[];
  grant: string[];
  connect: string[];
  require: string[];
  files?: { path: string; sha256: string; size: number }[];
};

export type ScanOutput = {
  engineVer: string;
  checks: ScanCheck[];
  declared: Declared;
  summary: CheckResult;
};

export type ScanOptions = {
  blocklistHosts?: string[];
  requireAllowHosts?: string[];
  creatorWallet?: string;
  maxWalletRows?: number;
  maxZipEntries?: number;
  maxUncompressed?: number;
};

const DEFAULT_ALLOW = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'];

export const KNOWN_PROGRAM_IDS = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
]);

const SIGN_NAMES = new Set([
  'signTransaction',
  'signAllTransactions',
  'signAndSendTransaction',
  'sendTransaction',
  'signMessage',
]);

const WALLET_GLOBALS = new Set(['solana', 'phantom', 'backpack', 'solflare', 'ethereum']);

const SECRET_PROPS = new Set(['privateKey', 'secretKey', 'mnemonic', 'seed']);

type AstNode = acorn.Node & {
  type: string;
  name?: string;
  value?: unknown;
  callee?: AstNode;
  object?: AstNode;
  property?: AstNode;
  arguments?: AstNode[];
  computed?: boolean;
  source?: AstNode;
  left?: AstNode;
  right?: AstNode;
  init?: AstNode;
  elements?: Array<AstNode | null>;
  loc?: { start: { line: number; column: number } };
};

function emptyDeclared(): Declared {
  return { match: [], include: [], grant: [], connect: [], require: [] };
}

function check(
  ruleId: string,
  result: CheckResult,
  title: string,
  detail: string,
  locations: ScanLocation[] = [],
): ScanCheck {
  return {
    ruleId,
    result,
    title,
    detail,
    locations: locations.map((l) => ({ ...l, snippet: l.snippet.slice(0, 200) })),
  };
}

function lineOf(text: string, index: number): ScanLocation {
  const until = text.slice(0, Math.max(0, index));
  const line = until.split('\n').length;
  const col = index - until.lastIndexOf('\n');
  const lineText = text.split('\n')[line - 1] ?? '';
  return { line, col, snippet: lineText.trim().slice(0, 200) };
}

function summarize(checks: ScanCheck[]): CheckResult {
  const ranked = checks.filter((c) => c.result !== 'na');
  if (ranked.some((c) => c.result === 'fail')) return 'fail';
  if (ranked.some((c) => c.result === 'warn')) return 'warn';
  return 'pass';
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function isPubkey(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function parseHeader(text: string): Declared & { ok: boolean } {
  const declared = emptyDeclared();
  const match = text.match(/\/\/ ==UserScript==\s*([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!match) return { ...declared, ok: false };
  const body = match[1] ?? '';
  for (const line of body.split('\n')) {
    const m = line.match(/@(\w+)\s+(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = (m[2] ?? '').trim();
    if (key === 'match') declared.match.push(value);
    if (key === 'include') declared.include.push(value);
    if (key === 'grant') declared.grant.push(value);
    if (key === 'connect') declared.connect.push(value);
    if (key === 'require') declared.require.push(value);
  }
  const ok = declared.match.length + declared.include.length > 0;
  return { ...declared, ok };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function shannon(input: string): number {
  if (!input.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of input) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / input.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function nameOf(node: AstNode | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Identifier' && node.name) return node.name;
  return null;
}

function scanJs(
  text: string,
  fileName: string,
  opts: ScanOptions,
): { checks: ScanCheck[]; declared: Declared } {
  const header = parseHeader(text);
  const declared: Declared = {
    match: header.match,
    include: header.include,
    grant: header.grant,
    connect: header.connect,
    require: header.require,
  };
  const checks: ScanCheck[] = [];
  const allow = new Set(opts.requireAllowHosts ?? DEFAULT_ALLOW);
  const block = new Set((opts.blocklistHosts ?? []).map((h) => h.toLowerCase()));

  checks.push(
    header.ok
      ? check(
          'header-valid',
          'pass',
          'Userscript header',
          'Header block has an @match or @include.',
        )
      : check(
          'header-valid',
          'fail',
          'Userscript header',
          'Missing or invalid ==UserScript== block, or no @match / @include.',
          [lineOf(text, 0)],
        ),
  );

  const wide = [...header.match, ...header.include].filter(
    (v) => v === '*://*/*' || v === '<all_urls>' || v === '*',
  );
  checks.push(
    wide.length
      ? check('match-scope', 'warn', 'Match scope', `Broad match: ${wide.join(', ')}`, [
          lineOf(text, text.indexOf(wide[0]!)),
        ])
      : check('match-scope', 'pass', 'Match scope', 'Matches are scoped to declared sites.'),
  );

  let ast: AstNode | null = null;
  try {
    ast = acorn.parse(text, {
      ecmaVersion: 'latest',
      locations: true,
      allowHashBang: true,
      sourceType: 'script',
    }) as AstNode;
  } catch (err) {
    checks.push(
      check('js-parse', 'fail', 'JavaScript parse', `Could not parse: ${(err as Error).message}`, [
        lineOf(text, 0),
      ]),
    );
  }

  const evalHits: ScanLocation[] = [];
  const signHits: ScanLocation[] = [];
  const keyHits: ScanLocation[] = [];
  const clipRead: ScanLocation[] = [];
  const clipWrite: ScanLocation[] = [];
  const remoteHits: ScanLocation[] = [];
  const netHosts = new Set<string>();
  const dynamicNet: ScanLocation[] = [];
  const domHits: ScanLocation[] = [];
  const identTotal = { n: 0, obf: 0 };
  const stringLiterals: string[] = [];

  const locNode = (node: AstNode): ScanLocation => {
    const line = node.loc?.start.line ?? 1;
    const lineText = text.split('\n')[line - 1] ?? '';
    return { line, col: (node.loc?.start.column ?? 0) + 1, snippet: lineText.trim().slice(0, 200) };
  };

  if (ast) {
    walk.simple(ast, {
      Identifier(node) {
        identTotal.n += 1;
        if (/^_0x[0-9a-f]+$/i.test((node as AstNode).name ?? '')) identTotal.obf += 1;
      },
      Literal(node) {
        const n = node as AstNode;
        if (typeof n.value === 'string') stringLiterals.push(n.value);
      },
      CallExpression(node) {
        const n = node as AstNode;
        const callee = n.callee;
        const fn = nameOf(callee);
        if (fn === 'eval') evalHits.push(locNode(n));
        if (
          (fn === 'setTimeout' || fn === 'setInterval') &&
          n.arguments?.[0]?.type === 'Literal' &&
          typeof n.arguments[0].value === 'string'
        ) {
          evalHits.push(locNode(n));
        }
        if (fn && SIGN_NAMES.has(fn)) signHits.push(locNode(n));
        if (callee?.type === 'MemberExpression') {
          const prop = callee.property;
          const propName =
            prop && !callee.computed
              ? nameOf(prop)
              : typeof prop?.value === 'string'
                ? String(prop.value)
                : null;
          if (propName && SIGN_NAMES.has(propName)) signHits.push(locNode(n));
          const objName = nameOf(callee.object);
          if (objName === 'atob') {
            /* recorded via source check below */
          }
          if (propName === 'readText' || propName === 'read') {
            const obj = callee.object;
            if (obj?.type === 'MemberExpression' && nameOf(obj.property) === 'clipboard')
              clipRead.push(locNode(n));
          }
          if (
            propName === 'writeText' &&
            callee.object?.type === 'MemberExpression' &&
            nameOf(callee.object.property) === 'clipboard'
          ) {
            clipWrite.push(locNode(n));
          }
          if (
            propName === 'getItem' &&
            (objName === 'localStorage' || objName === 'sessionStorage')
          ) {
            const arg = n.arguments?.[0];
            if (
              arg?.type === 'Literal' &&
              typeof arg.value === 'string' &&
              /key|wallet|seed|phrase|secret/i.test(arg.value)
            ) {
              keyHits.push(locNode(n));
            }
          }
          if (
            (fn === 'fetch' ||
              propName === 'fetch' ||
              propName === 'sendBeacon' ||
              propName === 'xmlhttpRequest' ||
              propName === 'xmlHttpRequest') &&
            n.arguments?.[0]
          ) {
            const arg = n.arguments[0];
            if (arg.type === 'Literal' && typeof arg.value === 'string') {
              const host = hostOf(arg.value);
              if (host) netHosts.add(host);
              else dynamicNet.push(locNode(n));
            } else if (arg.type === 'ObjectExpression') {
              /* GM_xmlhttpRequest({url}) handled below by source regex as well */
            } else dynamicNet.push(locNode(n));
          }
          if (propName === 'createElement') {
            const arg = n.arguments?.[0];
            if (arg?.type === 'Literal' && arg.value === 'script') remoteHits.push(locNode(n));
          }
        }
        if (fn === 'fetch' || fn === 'GM_xmlhttpRequest') {
          const arg = n.arguments?.[0];
          if (arg?.type === 'Literal' && typeof arg.value === 'string') {
            const host = hostOf(arg.value);
            if (host) netHosts.add(host);
          } else if (arg && arg.type !== 'ObjectExpression') dynamicNet.push(locNode(n));
        }
      },
      NewExpression(node) {
        const n = node as AstNode;
        if (nameOf(n.callee) === 'Function') evalHits.push(locNode(n));
        if (nameOf(n.callee) === 'WebSocket') {
          const arg = n.arguments?.[0];
          if (arg?.type === 'Literal' && typeof arg.value === 'string') {
            const host = hostOf(arg.value);
            if (host) netHosts.add(host);
          } else dynamicNet.push(locNode(n));
        }
      },
      ImportExpression(node) {
        const n = node as AstNode;
        if (n.source && n.source.type !== 'Literal') evalHits.push(locNode(n));
      },
      MemberExpression(node) {
        const n = node as AstNode;
        const prop = n.property;
        const propName =
          prop && !n.computed
            ? nameOf(prop)
            : typeof prop?.value === 'string'
              ? String(prop.value)
              : null;
        if (propName && SECRET_PROPS.has(propName)) keyHits.push(locNode(n));
        if (propName && SIGN_NAMES.has(propName)) signHits.push(locNode(n));
        if (nameOf(n.object) === 'window' && propName && WALLET_GLOBALS.has(propName))
          signHits.push(locNode(n));
        if (propName === 'solana' && nameOf(n.object) === 'phantom') signHits.push(locNode(n));
      },
    });
  }

  const gmUrls = [
    ...text.matchAll(/GM_xmlhttpRequest\s*\(\s*\{[\s\S]*?url\s*:\s*['"]([^'"]+)['"]/g),
  ];
  for (const m of gmUrls) {
    const host = hostOf(m[1] ?? '');
    if (host) netHosts.add(host);
    else dynamicNet.push(lineOf(text, m.index ?? 0));
  }
  const xhrUrls = [...text.matchAll(/\.open\(\s*['"][A-Z]+['"]\s*,\s*['"]([^'"]+)['"]/g)];
  for (const m of xhrUrls) {
    const host = hostOf(m[1] ?? '');
    if (host) netHosts.add(host);
  }
  if (/new\s+Image\(\)|\.src\s*=/.test(text) && /https?:\/\//.test(text)) {
    const img = text.match(/\.src\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
    if (img?.[1]) {
      const host = hostOf(img[1]);
      if (host) netHosts.add(host);
    }
  }

  checks.push(
    evalHits.length
      ? check(
          'no-eval',
          'fail',
          'No eval',
          'Found eval, Function, string timer, or dynamic import().',
          evalHits,
        )
      : check('no-eval', 'pass', 'No eval', 'No eval, Function, or dynamic import().'),
  );

  const requireProblems: string[] = [];
  for (const req of header.require) {
    const host = hostOf(req.split('#')[0] ?? req);
    const hasSri = /#sha(256|384|512)-/i.test(req) || /integrity=sha/i.test(req);
    if (!host || !allow.has(host)) requireProblems.push(`${req} (host not allowlisted)`);
    else if (!hasSri) requireProblems.push(`${req} (missing SRI)`);
  }
  if (/<script[^>]+src=/i.test(text)) requireProblems.push('inline <script src> injection');
  if (remoteHits.length && /script/.test(text)) {
    const dynamicSrc =
      /\.src\s*=\s*(?!['"]https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)\/)/.test(
        text,
      );
    if (dynamicSrc && /createElement\(\s*['"]script['"]\s*\)/.test(text))
      requireProblems.push('dynamic script element');
  }
  checks.push(
    requireProblems.length
      ? check('no-remote-code', 'fail', 'No remote code', requireProblems.join('; '), [
          lineOf(text, text.indexOf('@require') === -1 ? 0 : text.indexOf('@require')),
        ])
      : check(
          'no-remote-code',
          'pass',
          'No remote code',
          'No remote code loading outside the allowlist.',
        ),
  );

  const obfReasons: string[] = [];
  const longLine = text.split('\n').findIndex((l) => l.length > 5000);
  if (longLine >= 0) obfReasons.push(`line ${longLine + 1} is longer than 5000 characters`);
  if (identTotal.n > 10 && identTotal.obf / identTotal.n > 0.3)
    obfReasons.push('more than 30% of identifiers look like _0x obfuscation');
  const joined = stringLiterals.join('');
  if (joined.length > 2048 && shannon(joined) > 5.5)
    obfReasons.push('string literal entropy is above 5.5 bits/char');
  if (/atob\s*\(/.test(text) && /eval\s*\(|Function\s*\(/.test(text))
    obfReasons.push('atob combined with eval or Function');
  if (/\.shift\(\)/.test(text) && /\.push\(/.test(text) && stringLiterals.length > 20)
    obfReasons.push('string-array rotator pattern');
  checks.push(
    obfReasons.length
      ? check('no-obfuscation', 'fail', 'No obfuscation', obfReasons.join('; '))
      : check(
          'no-obfuscation',
          'pass',
          'No obfuscation',
          'Readable source, no obfuscation heuristics.',
        ),
  );

  checks.push(
    signHits.length
      ? check(
          'no-sign-transaction',
          'fail',
          'No transaction signing',
          'Touches a wallet signing API or window wallet global.',
          signHits,
        )
      : check(
          'no-sign-transaction',
          'pass',
          'No transaction signing',
          'Does not call signTransaction or read wallet globals.',
        ),
  );

  const b58 = text.match(/[1-9A-HJ-NP-Za-km-z]{87,88}/);
  if (b58) keyHits.push(lineOf(text, b58.index ?? 0));
  checks.push(
    keyHits.length
      ? check(
          'no-key-access',
          'fail',
          'No key access',
          'Reads a secret-looking property, storage key, or base58 secret.',
          keyHits,
        )
      : check(
          'no-key-access',
          'pass',
          'No key access',
          'No private-key, seed, or wallet-storage reads.',
        ),
  );

  checks.push(
    clipRead.length
      ? check('no-clipboard-read', 'fail', 'No clipboard read', 'Reads the clipboard.', clipRead)
      : check('no-clipboard-read', 'pass', 'No clipboard read', 'Does not read the clipboard.'),
  );
  checks.push(
    clipWrite.length
      ? check(
          'no-clipboard-write-address',
          'warn',
          'Clipboard write',
          'Writes to the clipboard. A reviewer agent must check for address swaps.',
          clipWrite,
        )
      : check(
          'no-clipboard-write-address',
          'pass',
          'Clipboard write',
          'Does not write the clipboard.',
        ),
  );

  const declaredHosts = new Set(
    header.connect.filter((h) => h && h !== 'none').map((h) => h.toLowerCase()),
  );
  const undeclared = [...netHosts].filter((h) => !declaredHosts.has(h.toLowerCase()));
  const blocked = [...netHosts].filter((h) => block.has(h.toLowerCase()));
  if (dynamicNet.length || undeclared.length) {
    checks.push(
      check(
        'network-declared',
        'warn',
        'Declared network',
        `Outbound host is dynamic or not in @connect: ${[...undeclared, ...dynamicNet.map(() => '(dynamic)')].join(', ') || 'dynamic URL'}`,
        dynamicNet,
      ),
    );
  } else {
    checks.push(
      check(
        'network-declared',
        'pass',
        'Declared network',
        'Outbound calls are either absent or listed in @connect.',
      ),
    );
  }
  checks.push(
    netHosts.size
      ? check(
          'network-allowlist',
          blocked.length ? 'fail' : 'warn',
          'Network hosts',
          `Hosts: ${[...netHosts].join(', ')}`,
        )
      : check('network-allowlist', 'pass', 'Network hosts', 'No outbound hosts detected.'),
  );

  if (
    /querySelector\([^)]*(address|wallet|confirm|approve)/i.test(text) ||
    /(?:Confirm|Approve).{0,40}(?:textContent|innerText)/.test(text)
  ) {
    domHits.push(lineOf(text, text.search(/querySelector|textContent|innerText/)));
  }
  checks.push(
    domHits.length
      ? check(
          'no-dom-wallet-tamper',
          'warn',
          'DOM wallet tamper',
          'Selectors or text replacement touch address or confirm UI.',
          domHits,
        )
      : check(
          'no-dom-wallet-tamper',
          'pass',
          'DOM wallet tamper',
          'No wallet-popup or address-field tampering detected.',
        ),
  );

  const heavy = header.grant.filter((g) =>
    ['GM_cookie', 'GM_download', 'unsafeWindow'].includes(g),
  );
  checks.push(
    heavy.length
      ? check('grant-minimal', 'warn', 'Minimal grants', `Broad @grant: ${heavy.join(', ')}`)
      : check('grant-minimal', 'pass', 'Minimal grants', 'No broad @grant privileges.'),
  );
  checks.push(
    header.require.length
      ? check('deps', 'warn', 'Dependencies', `Requires: ${header.require.join(', ')}`)
      : check('deps', 'pass', 'Dependencies', 'No @require dependencies.'),
  );

  checks.push(...linkChecks(text, opts));
  void fileName;
  return { checks, declared };
}

function linkChecks(text: string, opts: ScanOptions): ScanCheck[] {
  const block = new Set((opts.blocklistHosts ?? []).map((h) => h.toLowerCase()));
  const urls = [...text.matchAll(/https?:\/\/[^\s'")\]]+/g)].map((m) => m[0] ?? '');
  if (!urls.length) return [check('links', 'pass', 'Links', 'No URLs found.')];
  const bad = urls.filter(
    (u) => u.startsWith('http://') || block.has((hostOf(u) ?? '').toLowerCase()),
  );
  return [
    bad.length
      ? check(
          'links',
          'warn',
          'Links',
          `Non-https or blocklisted URL: ${bad.slice(0, 5).join(', ')}`,
        )
      : check('links', 'pass', 'Links', 'URLs are https and not blocklisted.'),
  ];
}

function scanWalletList(text: string, opts: ScanOptions): ScanCheck[] {
  const checks: ScanCheck[] = [];
  const max = opts.maxWalletRows ?? 5000;
  let rows: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(json) ? json : [];
      if (!Array.isArray(json)) {
        checks.push(
          check('wl-schema', 'fail', 'Wallet list schema', 'JSON wallet lists must be an array.'),
        );
        checks.push(...linkChecks(text, opts));
        return checks;
      }
      for (const item of list) {
        if (typeof item === 'string') rows.push(item.trim());
        else if (item && typeof item === 'object' && 'address' in item)
          rows.push(String((item as { address: unknown }).address).trim());
        else rows.push('');
      }
    } catch {
      checks.push(check('wl-schema', 'fail', 'Wallet list schema', 'Invalid JSON.'));
      return checks;
    }
  } else {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const header = (lines[0] ?? '').split(',').map((s) => s.trim().toLowerCase());
    const idx = header.indexOf('address');
    if (idx < 0) {
      checks.push(check('wl-schema', 'fail', 'Wallet list schema', 'CSV needs an address column.'));
      return checks;
    }
    rows = lines.slice(1).map((line) => (line.split(',')[idx] ?? '').trim());
  }
  const invalid = rows.filter((r) => !isPubkey(r));
  const unique = new Set(rows.filter(Boolean));
  if (rows.length > max) {
    checks.push(
      check('wl-schema', 'fail', 'Wallet list schema', `${rows.length} rows exceeds ${max}.`),
    );
  } else if (invalid.length) {
    checks.push(
      check(
        'wl-schema',
        'fail',
        'Wallet list schema',
        `${invalid.length} value(s) are not 32-byte base58 pubkeys.`,
      ),
    );
  } else {
    checks.push(
      check(
        'wl-schema',
        'pass',
        'Wallet list schema',
        `${rows.length} rows, ${rows.length - unique.size} duplicates removed in the count.`,
      ),
    );
  }
  const programs = rows.filter(
    (r) => KNOWN_PROGRAM_IDS.has(r) || (opts.creatorWallet && r === opts.creatorWallet),
  );
  checks.push(
    programs.length
      ? check(
          'wl-no-programs',
          'warn',
          'Program ids',
          `List contains program ids or the creator wallet: ${programs.slice(0, 3).join(', ')}`,
        )
      : check('wl-no-programs', 'pass', 'Program ids', 'No known program ids in the list.'),
  );
  checks.push(...linkChecks(text, opts));
  return checks;
}

function scanFilter(text: string, opts: ScanOptions): ScanCheck[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [
      check('filter-schema', 'fail', 'Filter schema', 'Invalid JSON.'),
      ...linkChecks(text, opts),
    ];
  }
  const parsed = filterPresetSchema.safeParse(json);
  if (!parsed.success) {
    const onlyUnknown = parsed.error.issues.every((i) => i.code === 'unrecognized_keys');
    const keys = parsed.error.issues.flatMap((i) => ('keys' in i ? (i.keys as string[]) : []));
    return [
      check(
        'filter-schema',
        onlyUnknown ? 'warn' : 'fail',
        'Filter schema',
        onlyUnknown
          ? `Unknown keys: ${keys.join(', ')}`
          : parsed.error.issues.map((i) => i.message).join('; '),
      ),
      ...linkChecks(text, opts),
    ];
  }
  return [
    check('filter-schema', 'pass', 'Filter schema', 'Matches the terminal filter schema.'),
    ...linkChecks(text, opts),
  ];
}

function scanDoc(name: string, bytes: Uint8Array, opts: ScanOptions): ScanCheck[] {
  const lower = name.toLowerCase();
  if (
    lower.endsWith('.pdf') ||
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
  ) {
    const text = decodeText(bytes);
    if (bytes[0] !== 0x25)
      return [
        check('doc-safe', 'fail', 'Document', 'File claims to be a PDF but has no %PDF header.'),
      ];
    if (/\/JavaScript|\/JS[\s(<]|\/Launch|\/EmbeddedFile/.test(text)) {
      return [
        check(
          'doc-safe',
          'fail',
          'Document',
          'PDF contains JavaScript, a launch action, or an embedded file.',
        ),
      ];
    }
    return [
      check(
        'doc-safe',
        'pass',
        'Document',
        'PDF has no JavaScript, launch action, or embedded file.',
      ),
      ...linkChecks(text, opts),
    ];
  }
  const text = decodeText(bytes);
  if (text.includes('\0'))
    return [check('doc-safe', 'fail', 'Document', 'Markdown file contains binary data.')];
  return [
    check('doc-safe', 'pass', 'Document', 'Markdown is plain text.'),
    ...linkChecks(text, opts),
  ];
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', arrayBufferOf(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extCategory(name: string, fallback: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.user.js') || lower.endsWith('.js')) return 'userscript';
  if (lower.endsWith('.csv')) return 'wallet_list';
  if (lower.endsWith('.md') || lower.endsWith('.pdf')) return 'strategy';
  if (lower.endsWith('.json')) return fallback === 'wallet_list' ? 'wallet_list' : 'filter';
  return fallback;
}

export async function scan(
  file: { name: string; bytes: Uint8Array },
  category: string,
  opts: ScanOptions = {},
): Promise<ScanOutput> {
  if (category === 'setup' || file.name.toLowerCase().endsWith('.zip')) {
    return scanZip(file, opts);
  }
  const text = decodeText(file.bytes);
  if (category === 'wallet_list') {
    const checks = scanWalletList(text, opts);
    return { engineVer: ENGINE_VER, checks, declared: emptyDeclared(), summary: summarize(checks) };
  }
  if (category === 'filter') {
    const checks = scanFilter(text, opts);
    return { engineVer: ENGINE_VER, checks, declared: emptyDeclared(), summary: summarize(checks) };
  }
  if (category === 'strategy') {
    const checks = scanDoc(file.name, file.bytes, opts);
    return { engineVer: ENGINE_VER, checks, declared: emptyDeclared(), summary: summarize(checks) };
  }
  if (
    category === 'alerts' &&
    !file.name.toLowerCase().endsWith('.js') &&
    !file.name.toLowerCase().endsWith('.user.js')
  ) {
    const checks = [
      ...scanFilter(text, opts).filter((c) => c.ruleId !== 'filter-schema'),
      ...linkChecks(text, opts),
    ];
    const declared = emptyDeclared();
    return {
      engineVer: ENGINE_VER,
      checks: checks.length ? checks : [check('links', 'pass', 'Links', 'No code to scan.')],
      declared,
      summary: summarize(checks),
    };
  }
  const js = scanJs(text, file.name, opts);
  return {
    engineVer: ENGINE_VER,
    checks: js.checks,
    declared: js.declared,
    summary: summarize(js.checks),
  };
}

async function scanZip(
  file: { name: string; bytes: Uint8Array },
  opts: ScanOptions,
): Promise<ScanOutput> {
  const maxEntries = opts.maxZipEntries ?? 200;
  const maxBytes = opts.maxUncompressed ?? 26_214_400;
  const listed = listZip(file.bytes);
  const checks: ScanCheck[] = [];
  const declared = emptyDeclared();
  if ('error' in listed) {
    checks.push(check('zip-safe', 'fail', 'Archive', listed.error));
    return { engineVer: ENGINE_VER, checks, declared, summary: 'fail' };
  }
  if (listed.length > maxEntries) {
    checks.push(
      check('zip-safe', 'fail', 'Archive', `${listed.length} entries exceeds ${maxEntries}.`),
    );
    return { engineVer: ENGINE_VER, checks, declared, summary: 'fail' };
  }
  const uncompressed = listed.reduce((s, e) => s + e.uncompressedSize, 0);
  if (uncompressed > maxBytes) {
    checks.push(
      check(
        'zip-safe',
        'fail',
        'Archive',
        `Uncompressed size ${uncompressed} exceeds ${maxBytes}.`,
      ),
    );
    return { engineVer: ENGINE_VER, checks, declared, summary: 'fail' };
  }
  const bad = listed.find(
    (e) =>
      unsafeZipPath(e.name) ||
      e.name.toLowerCase().endsWith('.zip') ||
      (e.isUnix && unixModeIsSymlink(e.unixMode)),
  );
  if (bad) {
    const why = unsafeZipPath(bad.name)
      ? 'path traversal'
      : bad.name.toLowerCase().endsWith('.zip')
        ? 'nested archive'
        : 'symlink';
    checks.push(check('zip-safe', 'fail', 'Archive', `${bad.name}: ${why}`));
    return { engineVer: ENGINE_VER, checks, declared, summary: 'fail' };
  }
  checks.push(
    check(
      'zip-safe',
      'pass',
      'Archive',
      `${listed.length} entries, no traversal, symlinks, or nested archives.`,
    ),
  );
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(file.bytes);
  } catch (err) {
    checks.push(check('zip-safe', 'fail', 'Archive', `Unzip failed: ${(err as Error).message}`));
    return { engineVer: ENGINE_VER, checks, declared, summary: 'fail' };
  }
  declared.files = [];
  for (const entry of listed) {
    if (entry.name.endsWith('/')) continue;
    const bytes = files[entry.name];
    if (!bytes) continue;
    const hash = await sha256(bytes);
    declared.files.push({ path: entry.name, sha256: hash, size: bytes.length });
    const child = await scan({ name: entry.name, bytes }, extCategory(entry.name, 'filter'), opts);
    for (const c of child.checks) {
      checks.push({
        ...c,
        ruleId: `zip:${entry.name}:${c.ruleId}`,
        detail: `${entry.name}: ${c.detail}`,
      });
    }
  }
  return { engineVer: ENGINE_VER, checks, declared, summary: summarize(checks) };
}

export function markSymlink(zip: Uint8Array): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  for (let i = 0; i < copy.length - 46; i++) {
    if (copy[i] === 0x50 && copy[i + 1] === 0x4b && copy[i + 2] === 0x01 && copy[i + 3] === 0x02) {
      copy[i + 5] = 3;
      const mode = 0o120777;
      view.setUint32(i + 38, mode << 16, true);
      break;
    }
  }
  return copy;
}

export type { ZipEntryMeta };
