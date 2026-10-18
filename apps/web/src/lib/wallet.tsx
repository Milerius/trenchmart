'use client';

import { getWallets } from '@wallet-standard/app';
import { fromBase64, toBase64 } from './base64';
import bs58 from 'bs58';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import dynamic from 'next/dynamic';
import {
  detectedIdFor,
  readLastWallet,
  safeLocalStorage,
  safeWalletIcon,
  writeLastWallet,
  type DetectedWalletInfo,
} from './wallet-catalog';
import { commitAfterSignIn, sessionAfterVerify } from './wallet-session';
import {
  createWalletConnectProvider,
  signWalletConnectMessage,
  signWalletConnectTransaction,
  startWalletConnect,
  walletConnectProjectId,
  type WalletConnectSession,
  type WcProviderLike,
} from './walletconnect';
import {
  isUsableSolanaWallet,
  mobileBrowseUrl,
  NO_WALLET_MESSAGE,
  readInjectedProvider,
  signerFromLegacyProvider,
  signerFromStandardWallet,
  signSignInMessage,
  walletErrorMessage,
  withTimeout,
  type MobileWalletId,
  type Signer,
  type WalletList,
} from './wallet-detect';

// The wallet picker is code-split: it loads the first time someone opens Connect.
const ConnectModal = dynamic(
  () => import('@/components/connect-modal').then((m) => m.ConnectModal),
  {
    ssr: false,
  },
);

type Session = { id: string; wallet: string; handle: string | null; roles: string[]; tier: string };

type WalletContextValue = {
  session: Session | null;
  busy: boolean;
  error: string;
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  signAndSend: (txBase64: string) => Promise<string>;
  /** Signs a plain-text message (free, no transaction); returns the base58 signature. */
  signMessage: (text: string) => Promise<string>;
  refresh: () => Promise<void>;
};

/** Long enough to read and approve in the wallet; short enough that a dead extension does not spin forever. */
const WALLET_TIMEOUT_MS = 120_000;
const WALLET_TIMEOUT_MESSAGE = 'The wallet did not respond. Reload the page and try again.';
const MOBILE_WALLETS: readonly MobileWalletId[] = ['phantom', 'solflare', 'trust', 'backpack'];

const WalletContext = createContext<WalletContextValue | null>(null);

declare global {
  interface Window {
    /** Set only by tests. Never written by the production bundle. */
    __TRENCHMART_E2E_SECRET__?: string;
  }
}

function e2eSecret(): Uint8Array | null {
  if (typeof window === 'undefined' || !window.__TRENCHMART_E2E_SECRET__) return null;
  return bs58.decode(window.__TRENCHMART_E2E_SECRET__);
}

// Test-only signer. Crypto libs load on demand so they stay out of the shared bundle.
async function signerFromSecret(secret: Uint8Array): Promise<Signer> {
  const [{ default: nacl }, { signLegacyTransaction }] = await Promise.all([
    import('tweetnacl'),
    import('@trenchmart/chain'),
  ]);
  const address = bs58.encode(nacl.sign.keyPair.fromSecretKey(secret).publicKey);
  return {
    address,
    async signMessage(message: Uint8Array) {
      return nacl.sign.detached(message, secret);
    },
    async signTransaction(transaction: Uint8Array) {
      return signLegacyTransaction(transaction, secret);
    },
  };
}

function standardWallets(): WalletList {
  const api = getWallets();
  return {
    get: () => api.get(),
    on: (event, listener) => api.on(event, () => listener()),
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detected, setDetected] = useState<DetectedWalletInfo[]>([]);
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  const [deeplinks, setDeeplinks] = useState<Partial<Record<MobileWalletId, string>>>({});
  const [walletConnectEnabled, setWalletConnectEnabled] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const signerRef = useRef<Signer | null>(null);
  const wcGen = useRef(0);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    // getWallets() dispatches wallet-standard:app-ready. Extensions that injected
    // earlier register synchronously here, so this must not run at module scope
    // during SSR (there is no window listener on the server).
    const wallets = standardWallets();
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const found: DetectedWalletInfo[] = [];
      const seen = new Set<string>();
      for (const wallet of wallets.get()) {
        if (!isUsableSolanaWallet(wallet)) continue;
        const id = detectedIdFor(wallet.name);
        if (seen.has(id)) continue;
        seen.add(id);
        found.push({ id, name: wallet.name, icon: safeWalletIcon(wallet.icon) });
      }
      if (!seen.has('phantom') && readInjectedProvider(window)) {
        found.push({ id: 'phantom', name: 'Phantom', icon: null });
      }
      setDetected(found);
      const links: Partial<Record<MobileWalletId, string>> = {};
      for (const id of MOBILE_WALLETS) {
        try {
          links[id] = mobileBrowseUrl(id, window.location.href);
        } catch {
          /* this page is not safe to open in a wallet browser */
        }
      }
      setDeeplinks(links);
    };
    syncRef.current = sync;
    const offRegister = wallets.on('register', sync);
    const offUnregister = wallets.on('unregister', sync);
    window.addEventListener('phantom#initialized', sync);
    sync();
    const poll = window.setInterval(sync, 100);
    const stopPoll = window.setTimeout(() => window.clearInterval(poll), 8_000);
    return () => {
      stopped = true;
      syncRef.current = () => {};
      offRegister();
      offUnregister();
      window.removeEventListener('phantom#initialized', sync);
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    syncRef.current();
    const poll = window.setInterval(() => syncRef.current(), 250);
    return () => window.clearInterval(poll);
  }, [pickerOpen]);

  async function refresh(requireSuccess = false) {
    try {
      const me = await api<{
        user: { id: string; wallet: string; handle: string | null; roles: string[] };
        tier: string;
      }>('/me');
      setSession({ ...me.user, tier: me.tier });
    } catch (err) {
      setSession(null);
      if (requireSuccess) throw err;
    }
  }

  async function rollbackSignIn() {
    signerRef.current = null;
    setSession(null);
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  }

  async function finishSignIn(signer: Signer) {
    const nonce = await api<{ message: string }>('/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ wallet: signer.address }),
    });
    const signature = await withTimeout(
      signSignInMessage(signer, nonce.message),
      WALLET_TIMEOUT_MS,
      WALLET_TIMEOUT_MESSAGE,
    );
    await api('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ wallet: signer.address, signature: bs58.encode(signature) }),
    });
    await sessionAfterVerify({
      load: () => refresh(true),
      rollback: rollbackSignIn,
    });
  }

  function rememberSigner(signer: Signer, id: string) {
    signerRef.current = signer;
    writeLastWallet(safeLocalStorage(window), id);
    setLastUsedId(id);
  }

  /** The wallet the person clicked. Never the first one in the list. */
  async function signerFor(id: string, silent: boolean): Promise<Signer> {
    for (const wallet of standardWallets().get()) {
      if (!isUsableSolanaWallet(wallet)) continue;
      if (detectedIdFor(wallet.name) !== id) continue;
      return signerFromStandardWallet(wallet, { silent });
    }
    if (id === 'phantom') {
      const provider = readInjectedProvider(window);
      if (provider) {
        const signer = await signerFromLegacyProvider(provider);
        return { ...signer, name: 'Phantom' };
      }
    }
    throw new Error(NO_WALLET_MESSAGE);
  }

  function signerFromWalletConnect(
    provider: WcProviderLike,
    session: WalletConnectSession,
  ): Signer {
    return {
      address: session.address,
      name: 'WalletConnect',
      signMessage: (message) => signWalletConnectMessage(provider, session, message),
      signTransaction: (transaction) =>
        signWalletConnectTransaction(provider, session, transaction),
    };
  }

  function cancelWalletConnect() {
    wcGen.current += 1;
    setWcUri(null);
  }

  async function beginWalletConnect() {
    const projectId = walletConnectProjectId();
    if (!projectId) return;
    const generation = ++wcGen.current;
    setWcUri(null);
    setError('');
    try {
      const provider = await createWalletConnectProvider(projectId);
      if (generation !== wcGen.current) return;
      const started = startWalletConnect(provider);
      const uri = await started.uri;
      if (generation !== wcGen.current) return;
      setWcUri(uri);
      const session = await started.session;
      if (generation !== wcGen.current) return;
      const signer = signerFromWalletConnect(provider, session);
      setBusy(true);
      await commitAfterSignIn({
        finish: () => finishSignIn(signer),
        commit: () => rememberSigner(signer, 'walletconnect'),
      });
      setPickerOpen(false);
    } catch (err) {
      if (generation !== wcGen.current) return;
      console.error('[trenchmart] sign-in failed', err);
      setError(err instanceof ApiError ? err.message : walletErrorMessage(err, 'WalletConnect'));
    } finally {
      if (generation === wcGen.current) setBusy(false);
    }
  }

  async function connect() {
    const secret = e2eSecret();
    if (!secret) {
      setError('');
      setLastUsedId(readLastWallet(safeLocalStorage(window)));
      setWalletConnectEnabled(Boolean(walletConnectProjectId()));
      setWcUri(null);
      wcGen.current += 1;
      setPickerOpen(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const signer = await signerFromSecret(secret);
      await commitAfterSignIn({
        finish: () => finishSignIn(signer),
        commit: () => {
          signerRef.current = signer;
        },
      });
    } catch (err) {
      console.error('[trenchmart] sign-in failed', err);
      setError(err instanceof ApiError ? err.message : walletErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function connectId(id: string) {
    setBusy(true);
    setError('');
    let walletName: string | undefined;
    try {
      const signer = await withTimeout(
        signerFor(id, false),
        WALLET_TIMEOUT_MS,
        WALLET_TIMEOUT_MESSAGE,
      );
      walletName = signer.name;
      await commitAfterSignIn({
        finish: () => finishSignIn(signer),
        commit: () => rememberSigner(signer, id),
      });
      setPickerOpen(false);
    } catch (err) {
      console.error('[trenchmart] sign-in failed', err);
      setError(err instanceof ApiError ? err.message : walletErrorMessage(err, walletName));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    signerRef.current = null;
    setSession(null);
  }

  /** The signed-in wallet's signer, reconnected silently after a reload. */
  async function activeSigner(): Promise<Signer> {
    let signer = signerRef.current;
    if (!signer) {
      const secret = e2eSecret();
      if (secret) signer = await signerFromSecret(secret);
    }
    if (!signer) {
      const last = readLastWallet(safeLocalStorage(window));
      if (!last) throw new Error('Connect a wallet first.');
      signer = await signerFor(last, true);
      signerRef.current = signer;
    }
    return signer;
  }

  async function signMessage(text: string): Promise<string> {
    const signer = await activeSigner();
    if (session && signer.address !== session.wallet)
      throw new Error('Your wallet switched accounts. Reconnect the wallet you signed in with.');
    try {
      const signature = await withTimeout(
        signer.signMessage(new TextEncoder().encode(text)),
        WALLET_TIMEOUT_MS,
        WALLET_TIMEOUT_MESSAGE,
      );
      return bs58.encode(signature);
    } catch (err) {
      throw new Error(walletRejectionMessage(err), { cause: err });
    }
  }

  async function signAndSend(txBase64: string): Promise<string> {
    const signer = await activeSigner();
    let signed: Uint8Array;
    try {
      signed = await signer.signTransaction(fromBase64(txBase64));
    } catch (err) {
      throw new Error(walletRejectionMessage(err), { cause: err });
    }
    const sent = await api<{ signature: string }>('/tx/send', {
      method: 'POST',
      body: JSON.stringify({ txBase64: toBase64(signed) }),
    });
    return sent.signature;
  }

  const value = useMemo(
    () => ({ session, busy, error, connect, logout, signAndSend, signMessage, refresh }),
    [session, busy, error],
  );

  // Mount (and download) the picker only once it has been opened.
  const pickerUsed = useRef(false);
  if (pickerOpen) pickerUsed.current = true;

  return (
    <WalletContext.Provider value={value}>
      {children}
      {pickerUsed.current ? (
        <ConnectModal
          open={pickerOpen}
          busy={busy}
          error={error}
          detected={detected}
          lastUsedId={lastUsedId}
          walletConnect={walletConnectEnabled}
          deeplinks={deeplinks}
          wcUri={wcUri}
          onClose={() => {
            if (!busy) {
              cancelWalletConnect();
              setPickerOpen(false);
            }
          }}
          onConnect={(id) => void connectId(id)}
          onWalletConnect={() => void beginWalletConnect()}
          onLeaveWalletConnect={cancelWalletConnect}
        />
      ) : null}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider missing');
  return value;
}

/**
 * A wallet that simulates on mainnet cannot predict a devnet transaction and flags it
 * ("This dApp could be malicious"). Most "rejections" on devnet are that, so say how to fix it.
 */
export const DEVNET_WALLET_HINT =
  'TrenchMart runs on Solana devnet. Switch your wallet to devnet first (Phantom: Settings → Developer Settings → Testnet Mode → Solana Devnet), then try again.';

export function walletRejectionMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 4001 || /reject|denied|declin|cancel/i.test(text)) {
    return `You declined in the wallet. ${DEVNET_WALLET_HINT}`;
  }
  return text || 'The wallet could not sign this transaction.';
}
