/**
 * Signature antivirus pass that runs inside a Worker (no native engine).
 *
 * What it does: exact SHA-256 matches against a blocklist (EICAR plus any hashes the
 * operator supplies), byte/string signatures for the EICAR test file, native executables
 * (PE, ELF, Mach-O) and well known JS malware families that target crypto users
 * (wallet drainer kits, in-browser miners), plus a warning for well known exfiltration
 * channels. Optionally it also asks a ClamAV service (see `ClamAvClient`).
 *
 * What it does not do: it is not a full antivirus. It has no heuristics engine, no
 * unpacking, no emulation and only a small, curated signature set; a novel or repacked
 * sample will not match. The static rules, the QuickJS sandbox and the AI review are the
 * main defence for scripts; this pass catches known-bad payloads cheaply and early.
 */

export type AvVerdict = 'clean' | 'infected' | 'error';

export type AvServiceResult = { status: AvVerdict; signature?: string; detail?: string };

/** A remote scanner, e.g. a ClamAV REST service. Must never throw on a clean file. */
export type ClamAvClient = (file: { name: string; bytes: Uint8Array }) => Promise<AvServiceResult>;

export type AvFinding = { signature: string; severity: 'fail' | 'warn'; offset?: number };

export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** SHA-256 of files that are always rejected. */
export const BLOCKED_SHA256 = new Map<string, string>([
  ['275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f', 'EICAR-Test-File'],
  ['131f95c51cc819465fa1797f6ccacf9d494aaaff46fa3eac73ae63ffbdfd8267', 'EICAR-Test-File'],
  ['8b3f191819931d1f2cef7289239b5f77c00b079847b9c2636e56854d1e5eff71', 'EICAR-Test-File'],
]);

type Signature = { name: string; pattern: RegExp; severity: 'fail' | 'warn' };

const SIGNATURES: Signature[] = [
  {
    name: 'EICAR-Test-File',
    pattern: /X5O!P%@AP\[4\\PZX54\(P\^\)7CC\)7\}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H\+H\*/,
    severity: 'fail',
  },
  // Wallet drainer kits sold to phishing crews; names appear in configs and panels.
  { name: 'Drainer.InfernoDrainer', pattern: /inferno[\s_-]?drainer/i, severity: 'fail' },
  { name: 'Drainer.AngelDrainer', pattern: /angel[\s_-]?drainer/i, severity: 'fail' },
  { name: 'Drainer.PinkDrainer', pattern: /pink[\s_-]?drainer/i, severity: 'fail' },
  { name: 'Drainer.MonkeyDrainer', pattern: /monkey[\s_-]?drainer/i, severity: 'fail' },
  { name: 'Drainer.VenomDrainer', pattern: /venom[\s_-]?drainer/i, severity: 'fail' },
  { name: 'Drainer.MSDrainer', pattern: /\bms[\s_-]drainer\b/i, severity: 'fail' },
  { name: 'Drainer.CLINKSINK', pattern: /clinksink/i, severity: 'fail' },
  // In-browser cryptominers.
  {
    name: 'Miner.CoinHive',
    pattern: /coin-?hive(\.min)?\.js|CoinHive\.(Anonymous|User|Token)|coinhive\.com/i,
    severity: 'fail',
  },
  {
    name: 'Miner.CryptoLoot',
    pattern: /crypto-?loot\.(com|pro)|CRLT\.Anonymous/i,
    severity: 'fail',
  },
  { name: 'Miner.WebMinePool', pattern: /webminepool\.com|WMP\.Anonymous/i, severity: 'fail' },
  { name: 'Miner.Stratum', pattern: /stratum\+(tcp|ssl):\/\//i, severity: 'fail' },
  { name: 'Miner.CryptoNightWasm', pattern: /cryptonight(_hash|\.wasm)/i, severity: 'fail' },
  // Channels stealers commonly exfiltrate to. Legit alert tools can use them too: warn.
  { name: 'Exfil.TelegramBotApi', pattern: /api\.telegram\.org\/bot/i, severity: 'warn' },
  {
    name: 'Exfil.DiscordWebhook',
    pattern: /discord(app)?\.com\/api\/webhooks\//i,
    severity: 'warn',
  },
];

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

function nativeExecutable(bytes: Uint8Array): string | null {
  if (bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const peOffset = bytes[60]! | (bytes[61]! << 8) | (bytes[62]! << 16) | (bytes[63]! << 24);
    if (peOffset > 0 && peOffset + 4 <= bytes.length) {
      if (
        bytes[peOffset] === 0x50 &&
        bytes[peOffset + 1] === 0x45 &&
        bytes[peOffset + 2] === 0 &&
        bytes[peOffset + 3] === 0
      )
        return 'Executable.PE';
    }
  }
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)
    return 'Executable.ELF';
  const magic =
    bytes.length >= 4
      ? ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
      : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) return 'Executable.MachO';
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Local signature pass. Pure, deterministic, no network. */
export async function signatureScan(
  bytes: Uint8Array,
  extraBlockedSha256: Iterable<string> = [],
): Promise<AvFinding[]> {
  const findings: AvFinding[] = [];
  const hash = await sha256Hex(bytes);
  const extra = new Set([...extraBlockedSha256].map((h) => h.toLowerCase()));
  const known = BLOCKED_SHA256.get(hash);
  if (known) findings.push({ signature: `${known} (sha256)`, severity: 'fail' });
  else if (extra.has(hash))
    findings.push({ signature: 'Blocklisted file (sha256)', severity: 'fail' });
  const exe = nativeExecutable(bytes);
  if (exe) findings.push({ signature: exe, severity: 'fail', offset: 0 });
  const text = latin1(bytes);
  for (const sig of SIGNATURES) {
    const match = sig.pattern.exec(text);
    if (match) findings.push({ signature: sig.name, severity: sig.severity, offset: match.index });
  }
  return findings;
}

/**
 * Client for a ClamAV REST wrapper that accepts the raw file as the POST body and answers
 * JSON `{ "infected": boolean, "signature"?: string }` (for example a clamd sidecar behind
 * a small HTTP shim). Any transport or format problem is reported as `error`, never clean.
 */
export function clamAvHttpClient(
  url: string,
  options: { token?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): ClamAvClient {
  const doFetch = options.fetchImpl ?? fetch;
  return async (file) => {
    try {
      const body = new Uint8Array(file.bytes.length);
      body.set(file.bytes);
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (!res.ok) return { status: 'error', detail: `ClamAV service answered ${res.status}` };
      const json = (await res.json()) as { infected?: unknown; signature?: unknown };
      if (typeof json.infected !== 'boolean')
        return { status: 'error', detail: 'ClamAV service returned an unexpected body' };
      return json.infected
        ? {
            status: 'infected',
            signature: typeof json.signature === 'string' ? json.signature : 'unknown',
          }
        : { status: 'clean' };
    } catch (err) {
      return { status: 'error', detail: `ClamAV service unreachable: ${(err as Error).name}` };
    }
  };
}
