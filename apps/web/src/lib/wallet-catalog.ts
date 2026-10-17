import { renderSVG } from 'uqr';

/** Remembered wallet id. The picker never connects this wallet on its own. */
export const LAST_WALLET_KEY = 'tm.last-wallet';

export type CatalogKind = 'wallet' | 'walletconnect' | 'deeplink';

export type CatalogEntry = {
  id: string;
  name: string;
  installUrl: string | null;
  popular: boolean;
  kind: CatalogKind;
};

/** Roman's list, in the order the picker shows when nothing is installed. */
export const WALLET_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'phantom',
    name: 'Phantom',
    installUrl: 'https://phantom.com/download',
    popular: true,
    kind: 'wallet',
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    installUrl: null,
    popular: false,
    kind: 'walletconnect',
  },
  {
    id: 'solflare',
    name: 'Solflare',
    installUrl: 'https://solflare.com/download',
    popular: false,
    kind: 'wallet',
  },
  {
    id: 'trust',
    name: 'Trust',
    installUrl: 'https://trustwallet.com/download',
    popular: false,
    kind: 'wallet',
  },
  {
    id: 'glow',
    name: 'Glow',
    installUrl: 'https://glow.app/download',
    popular: false,
    kind: 'wallet',
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    installUrl: 'https://www.coinbase.com/wallet/downloads',
    popular: false,
    kind: 'wallet',
  },
  {
    id: 'backpack',
    name: 'Backpack',
    installUrl: 'https://backpack.app/download',
    popular: false,
    kind: 'wallet',
  },
  {
    id: 'open-phantom',
    name: 'Open in Phantom',
    installUrl: null,
    popular: false,
    kind: 'deeplink',
  },
  {
    id: 'open-solflare',
    name: 'Open in Solflare',
    installUrl: null,
    popular: false,
    kind: 'deeplink',
  },
  {
    id: 'open-trust',
    name: 'Open in Trust',
    installUrl: null,
    popular: false,
    kind: 'deeplink',
  },
  {
    id: 'open-backpack',
    name: 'Open in Backpack',
    installUrl: null,
    popular: false,
    kind: 'deeplink',
  },
];

const NAME_MATCHES: readonly [string, string][] = [
  ['wallet connect', 'walletconnect'],
  ['walletconnect', 'walletconnect'],
  ['phantom', 'phantom'],
  ['solflare', 'solflare'],
  ['backpack', 'backpack'],
  ['coinbase', 'coinbase'],
  ['trust', 'trust'],
  ['glow', 'glow'],
];

export type DetectedWalletInfo = {
  id: string;
  name: string;
  icon?: string | null;
};

export type WalletChoice = {
  id: string;
  name: string;
  installed: boolean;
  popular: boolean;
  installUrl: string | null;
  icon: string | null;
  kind: CatalogKind;
};

/** Map a Wallet Standard name onto a catalog id. Unknown wallets stay unknown. */
export function catalogIdFor(name: string): string | null {
  const normalized = name.toLowerCase();
  for (const [needle, id] of NAME_MATCHES) {
    if (normalized.includes(needle)) return id;
  }
  return null;
}

/** Wallet Standard icons are data URIs. Drop anything that is not an image. */
export function safeWalletIcon(icon: string | undefined | null): string | null {
  if (!icon || icon.length > 200_000) return null;
  if (/^data:image\/svg/i.test(icon)) {
    const payload = icon.slice(icon.indexOf(',') + 1);
    let text: string;
    try {
      text = /;base64/i.test(icon) ? atob(payload) : decodeURIComponent(payload);
    } catch {
      return null;
    }
    if (/<script|javascript:|on\w+=/i.test(text)) return null;
    return icon;
  }
  if (/^data:image\/(png|jpe?g|webp|gif);/i.test(icon)) return icon;
  try {
    const url = new URL(icon);
    if (url.protocol === 'https:') return url.href;
  } catch {
    return null;
  }
  return null;
}

export function detectedIdFor(name: string): string {
  return catalogIdFor(name) ?? `other:${name.toLowerCase()}`;
}

/**
 * Installed wallets first (last-used at the front of that group), then every
 * catalog wallet that is not installed. Search hides rows whose name does not match.
 */
export function buildWalletChoices(input: {
  detected: readonly DetectedWalletInfo[];
  query: string;
  lastUsedId: string | null;
  /** When false, the WalletConnect row is omitted. Deep links stay. */
  walletConnect?: boolean;
}): WalletChoice[] {
  const catalog =
    input.walletConnect === false
      ? WALLET_CATALOG.filter((entry) => entry.kind !== 'walletconnect')
      : WALLET_CATALOG;
  const byId = new Map(input.detected.map((item) => [item.id, item]));
  const rows: WalletChoice[] = catalog.map((entry) => {
    const found = byId.get(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      installed: Boolean(found),
      popular: entry.popular,
      installUrl: entry.installUrl,
      icon: found?.icon ?? null,
      kind: entry.kind,
    };
  });
  for (const extra of input.detected) {
    if (catalog.some((entry) => entry.id === extra.id)) continue;
    rows.push({
      id: extra.id,
      name: extra.name,
      installed: true,
      popular: false,
      installUrl: null,
      icon: extra.icon ?? null,
      kind: 'wallet',
    });
  }
  const query = input.query.trim().toLowerCase();
  const filtered = query ? rows.filter((row) => row.name.toLowerCase().includes(query)) : rows;
  return filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.installed !== b.row.installed) return a.row.installed ? -1 : 1;
      if (a.row.installed && b.row.installed) {
        if (a.row.id === input.lastUsedId) return -1;
        if (b.row.id === input.lastUsedId) return 1;
      }
      return a.index - b.index;
    })
    .map((item) => item.row);
}

/**
 * Read `localStorage` itself inside the try. Evaluating `window.localStorage`
 * throws SecurityError when storage is blocked, before getItem or setItem run.
 */
export function safeLocalStorage(scope: object | null | undefined): Storage | null {
  try {
    if (!scope) return null;
    return (scope as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readLastWallet(
  storage: { getItem(key: string): string | null } | null,
): string | null {
  try {
    return storage?.getItem(LAST_WALLET_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLastWallet(
  storage: { setItem(key: string, value: string): void } | null,
  id: string,
): void {
  try {
    storage?.setItem(LAST_WALLET_KEY, id);
  } catch {
    /* private mode */
  }
}

/** SVG QR for the WalletConnect step. Rejects anything that is not a plain svg. */
export function walletConnectQr(url: string): string | null {
  const svg = renderSVG(url, {
    ecc: 'M',
    border: 2,
    pixelSize: 4,
    blackColor: '#0A0B0A',
    whiteColor: '#FFFFFF',
  });
  if (!svg.startsWith('<svg') || /<script/i.test(svg)) return null;
  return svg;
}
