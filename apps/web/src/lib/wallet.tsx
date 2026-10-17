'use client';

import { getWallets } from '@wallet-standard/app';
import { fromBase64, signLegacyTransaction, toBase64 } from '@trenchmart/chain';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import {
  DISCOVERY_TIMEOUT_MS,
  discoverWallet,
  isLikelyMobile,
  NO_WALLET_MESSAGE,
  phantomBrowseUrl,
  pickSolanaWallet,
  readInjectedProvider,
  signerFromLegacyProvider,
  signerFromStandardWallet,
  type Signer,
  type WalletList,
} from './wallet-detect';

type Session = { id: string; wallet: string; handle: string | null; roles: string[]; tier: string };

type WalletContextValue = {
  session: Session | null;
  busy: boolean;
  error: string;
  /** Set on a phone when no wallet injected. The header renders this as a real link. */
  phantomHref: string | null;
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  signAndSend: (txBase64: string) => Promise<string>;
  refresh: () => Promise<void>;
};

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
  const [phantomHref, setPhantomHref] = useState<string | null>(null);

  useEffect(() => {
    // getWallets() dispatches wallet-standard:app-ready. Extensions that injected
    // earlier register synchronously here, so this must not run at module scope
    // during SSR (there is no window listener on the server).
    const wallets = standardWallets();
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const found = pickSolanaWallet(wallets.get()) ?? readInjectedProvider(window);
      const secret = e2eSecret();
      const mobile = isLikelyMobile(navigator.userAgent, navigator.maxTouchPoints);
      if (!found && !secret && mobile) setPhantomHref(phantomBrowseUrl(window.location.href));
      else setPhantomHref(null);
    };
    const offRegister = wallets.on('register', sync);
    const offUnregister = wallets.on('unregister', sync);
    window.addEventListener('phantom#initialized', sync);
    sync();
    const poll = window.setInterval(sync, 100);
    const stopPoll = window.setTimeout(() => window.clearInterval(poll), 8_000);
    return () => {
      stopped = true;
      offRegister();
      offUnregister();
      window.removeEventListener('phantom#initialized', sync);
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
    };
  }, []);

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

  async function obtainSigner(silent: boolean): Promise<Signer> {
    const secret = e2eSecret();
    if (secret) return signerFromSecret(secret);
    const found = await discoverWallet({
      standard: standardWallets(),
      injected: window,
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      mobile: isLikelyMobile(navigator.userAgent, navigator.maxTouchPoints),
      pageUrl: window.location.href,
    });
    if (found.kind === 'deeplink') {
      window.location.assign(found.url);
      throw new Error('Open this page in Phantom to approve the transaction.');
    }
    if (found.kind === 'none') throw new Error(NO_WALLET_MESSAGE);
    if (found.kind === 'standard') return signerFromStandardWallet(found.wallet, { silent });
    return signerFromLegacyProvider(found.provider);
  }

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const signer = await obtainSigner(false);
      const nonce = await api<{ message: string }>('/auth/nonce', {
        method: 'POST',
        body: JSON.stringify({ wallet: signer.address }),
      });
      const signature = await signer.signMessage(new TextEncoder().encode(nonce.message));
      await api('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ wallet: signer.address, signature: bs58.encode(signature) }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setSession(null);
  }

  async function signAndSend(txBase64: string): Promise<string> {
    const signer = await obtainSigner(true);
    const signed = await signer.signTransaction(fromBase64(txBase64));
    const sent = await api<{ signature: string }>('/tx/send', {
      method: 'POST',
      body: JSON.stringify({ txBase64: toBase64(signed) }),
    });
    return sent.signature;
  }

  const value = useMemo(
    () => ({ session, busy, error, phantomHref, connect, logout, signAndSend, refresh }),
    [session, busy, error, phantomHref],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider missing');
  return value;
}
