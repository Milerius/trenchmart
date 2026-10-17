'use client';

import { getWallets } from '@wallet-standard/app';
import { fromBase64, signLegacyTransaction, toBase64 } from '@trenchmart/chain';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
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
import { ConnectModal } from '@/components/connect-modal';
import {
  detectedIdFor,
  readLastWallet,
  safeWalletIcon,
  writeLastWallet,
  type DetectedWalletInfo,
} from './wallet-catalog';
import {
  isUsableSolanaWallet,
  NO_WALLET_MESSAGE,
  phantomBrowseUrl,
  readInjectedProvider,
  signerFromLegacyProvider,
  signerFromStandardWallet,
  signSignInMessage,
  walletErrorMessage,
  withTimeout,
  type Signer,
  type WalletList,
} from './wallet-detect';

type Session = { id: string; wallet: string; handle: string | null; roles: string[]; tier: string };

type WalletContextValue = {
  session: Session | null;
  busy: boolean;
  error: string;
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  signAndSend: (txBase64: string) => Promise<string>;
  refresh: () => Promise<void>;
};

/** Long enough to read and approve in the wallet; short enough that a dead extension does not spin forever. */
const WALLET_TIMEOUT_MS = 120_000;
const WALLET_TIMEOUT_MESSAGE = 'The wallet did not respond. Reload the page and try again.';

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

function signerFromSecret(secret: Uint8Array): Signer {
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
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);
  const signerRef = useRef<Signer | null>(null);
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
      try {
        setMobileUrl(phantomBrowseUrl(window.location.href));
      } catch {
        setMobileUrl(null);
      }
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

  async function refresh() {
    try {
      const me = await api<{
        user: { id: string; wallet: string; handle: string | null; roles: string[] };
        tier: string;
      }>('/me');
      setSession({ ...me.user, tier: me.tier });
    } catch {
      setSession(null);
    }
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
    await refresh();
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

  async function connect() {
    const secret = e2eSecret();
    if (!secret) {
      setError('');
      setLastUsedId(readLastWallet(window.localStorage));
      setPickerOpen(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const signer = signerFromSecret(secret);
      signerRef.current = signer;
      await finishSignIn(signer);
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
      signerRef.current = signer;
      writeLastWallet(window.localStorage, id);
      setLastUsedId(id);
      await finishSignIn(signer);
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

  async function signAndSend(txBase64: string): Promise<string> {
    let signer = signerRef.current;
    if (!signer) {
      const secret = e2eSecret();
      if (secret) signer = signerFromSecret(secret);
    }
    if (!signer) {
      const last = readLastWallet(window.localStorage);
      if (!last) throw new Error('Connect a wallet first.');
      signer = await signerFor(last, true);
      signerRef.current = signer;
    }
    const signed = await signer.signTransaction(fromBase64(txBase64));
    const sent = await api<{ signature: string }>('/tx/send', {
      method: 'POST',
      body: JSON.stringify({ txBase64: toBase64(signed) }),
    });
    return sent.signature;
  }

  const value = useMemo(
    () => ({ session, busy, error, connect, logout, signAndSend, refresh }),
    [session, busy, error],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <ConnectModal
        open={pickerOpen}
        busy={busy}
        error={error}
        detected={detected}
        lastUsedId={lastUsedId}
        mobileUrl={mobileUrl}
        onClose={() => {
          if (!busy) setPickerOpen(false);
        }}
        onConnect={(id) => void connectId(id)}
      />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider missing');
  return value;
}
