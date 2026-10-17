'use client';

import { fromBase64, signLegacyTransaction, toBase64 } from '@trenchmart/chain';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

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

const WalletContext = createContext<WalletContextValue | null>(null);

type Phantom = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  signTransaction: (tx: {
    serialize: () => Uint8Array;
  }) => Promise<{ serialize: () => Uint8Array }>;
};

declare global {
  interface Window {
    __TRENCHMART_E2E_SECRET__?: string;
    solana?: Phantom;
  }
}

function e2eSecret(): Uint8Array | null {
  if (typeof window === 'undefined' || !window.__TRENCHMART_E2E_SECRET__) return null;
  return bs58.decode(window.__TRENCHMART_E2E_SECRET__);
}

async function signMessage(message: string): Promise<{ wallet: string; signature: string }> {
  const secret = e2eSecret();
  if (secret) {
    const pair = nacl.sign.keyPair.fromSecretKey(secret);
    const signature = nacl.sign.detached(new TextEncoder().encode(message), secret);
    return { wallet: bs58.encode(pair.publicKey), signature: bs58.encode(signature) };
  }
  const phantom = window.solana;
  if (!phantom) throw new Error('No wallet. Install Phantom, or run the test adapter.');
  const connected = await phantom.connect();
  const signed = await phantom.signMessage(new TextEncoder().encode(message), 'utf8');
  return {
    wallet: connected.publicKey.toString(),
    signature: bs58.encode(signed.signature),
  };
}

async function signTx(txBase64: string): Promise<string> {
  const secret = e2eSecret();
  const bytes = fromBase64(txBase64);
  if (secret) return toBase64(signLegacyTransaction(bytes, secret));
  const phantom = window.solana;
  if (!phantom) throw new Error('No wallet');
  const signed = await phantom.signTransaction({ serialize: () => bytes });
  return toBase64(signed.serialize());
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const probe = e2eSecret();
      const wallet = probe
        ? bs58.encode(nacl.sign.keyPair.fromSecretKey(probe).publicKey)
        : (await window.solana?.connect())?.publicKey.toString();
      if (!wallet) throw new Error('No wallet. Install Phantom, or run the test adapter.');
      const nonce = await api<{ message: string }>('/auth/nonce', {
        method: 'POST',
        body: JSON.stringify({ wallet }),
      });
      const signed = await signMessage(nonce.message);
      await api('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ wallet: signed.wallet, signature: signed.signature }),
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
    const signed = await signTx(txBase64);
    const sent = await api<{ signature: string }>('/tx/send', {
      method: 'POST',
      body: JSON.stringify({ txBase64: signed }),
    });
    return sent.signature;
  }

  const value = useMemo(
    () => ({ session, busy, error, connect, logout, signAndSend, refresh }),
    [session, busy, error],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider missing');
  return value;
}
