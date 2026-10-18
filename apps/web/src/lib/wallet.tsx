'use client';

import { getWallets } from '@wallet-standard/app';
import { fromBase64, toBase64 } from './base64';
import bs58 from 'bs58';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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
import {
  commitAfterSignIn,
  isUserRejection,
  readSessionHint,
  sessionAfterVerify,
  SESSION_HINT_KEY,
  shortAddress,
  shouldRefreshSession,
  singleFlight,
  writeSessionHint,
  type SessionUser,
} from './wallet-session';
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

type Session = SessionUser;

/** `restoring`: shown from the local hint while /me confirms it. */
export type AuthStatus = 'restoring' | 'signed-in' | 'signed-out';
/** What the wallet flow is doing right now; `idle` when nothing is pending. */
export type WalletPhase = 'idle' | 'connecting' | 'signing' | 'verifying';

type WalletContextValue = {
  session: Session | null;
  status: AuthStatus;
  phase: WalletPhase;
  /** The wallet account the adapter is connected to (may differ from the session's). */
  walletAddress: string | null;
  /** Signed in as one wallet, while the extension now reports another account. */
  walletMismatch: boolean;
  busy: boolean;
  error: string;
  /** Opens the picker, or signs in with the already connected wallet. Never signs twice. */
  connect: () => Promise<void>;
  /** Signs in with the connected wallet's current account (one signature). */
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  signAndSend: (txBase64: string) => Promise<string>;
  /** Signs a plain-text message (free, no transaction); returns the base58 signature. */
  signMessage: (text: string) => Promise<string>;
  refresh: () => Promise<void>;
};

/** Long enough to read and approve in the wallet; short enough that a dead extension does not spin forever. */
const WALLET_TIMEOUT_MS = 120_000;
const WALLET_TIMEOUT_MESSAGE = 'The wallet did not respond. Reload the page and try again.';
const SIGN_DECLINED_MESSAGE =
  'You declined the sign-in request. Your wallet is connected but not signed in. Press Sign in to try again.';
const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again to continue.';
const REVALIDATE_MS = 30_000;
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

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type MeResponse = {
  user: { id: string; wallet: string; handle: string | null; roles: string[] };
  tier: string;
  session?: { expiresAt?: string; refreshAfter?: string } | null;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('signed-out');
  const [phase, setPhase] = useState<WalletPhase>('idle');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detected, setDetected] = useState<DetectedWalletInfo[]>([]);
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  const [deeplinks, setDeeplinks] = useState<Partial<Record<MobileWalletId, string>>>({});
  const [walletConnectEnabled, setWalletConnectEnabled] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const signerRef = useRef<Signer | null>(null);
  const signerIdRef = useRef<string | null>(null);
  const offAccountRef = useRef<() => void>(() => {});
  const sessionRef = useRef<Session | null>(null);
  /** Bumped by every sign-in, logout and cross-tab change; stale /me answers are dropped. */
  const authGen = useRef(0);
  const flight = useRef(singleFlight<void>());
  const refreshedCookie = useRef(false);
  const lastValidated = useRef(0);
  const reconnectTried = useRef(new Set<string>());
  const wcGen = useRef(0);
  const syncRef = useRef<() => void>(() => {});
  const busy = phase !== 'idle';

  function storage() {
    return typeof window === 'undefined' ? null : safeLocalStorage(window);
  }

  /** The one place session state changes: React state, the ref, and the cross-tab hint. */
  function applySession(next: Session | null, nextStatus: AuthStatus, expiresAt?: string | null) {
    sessionRef.current = next;
    setSession(next);
    setStatus(nextStatus);
    if (nextStatus === 'restoring') return;
    writeSessionHint(storage(), next ? { user: next, expiresAt: expiresAt ?? null } : null);
  }

  // Optimistic restore before paint: read-only pages render signed-in from the hint,
  // without waiting on the wallet adapter or the network. /me confirms right after.
  useClientLayoutEffect(() => {
    const hint = readSessionHint(storage());
    if (hint) applySession(hint.user, 'restoring');
  }, []);

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
      setDetected((prev) =>
        prev.length === found.length && prev.every((w, i) => w.id === found[i]?.id) ? prev : found,
      );
      const links: Partial<Record<MobileWalletId, string>> = {};
      for (const id of MOBILE_WALLETS) {
        try {
          links[id] = mobileBrowseUrl(id, window.location.href);
        } catch {
          /* this page is not safe to open in a wallet browser */
        }
      }
      setDeeplinks((prev) => (JSON.stringify(prev) === JSON.stringify(links) ? prev : links));
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
    const gen = authGen.current;
    lastValidated.current = Date.now();
    try {
      const me = await api<MeResponse>('/me');
      if (gen !== authGen.current) return;
      applySession({ ...me.user, tier: me.tier }, 'signed-in', me.session?.expiresAt ?? null);
      if (!refreshedCookie.current && shouldRefreshSession(me.session)) {
        refreshedCookie.current = true;
        void api<MeResponse>('/auth/refresh', { method: 'POST' })
          .then((out) => {
            if (gen === authGen.current && sessionRef.current)
              writeSessionHint(storage(), {
                user: sessionRef.current,
                expiresAt: out.session?.expiresAt ?? null,
              });
          })
          .catch(() => undefined);
      }
    } catch (err) {
      if (requireSuccess) throw err;
      if (gen !== authGen.current) return;
      // A network blip keeps the optimistic session; only the server's "no" signs out.
      if (err instanceof ApiError && err.status === 401) {
        if (sessionRef.current) setError(SESSION_EXPIRED_MESSAGE);
        applySession(null, 'signed-out');
      } else if (!sessionRef.current) {
        applySession(null, 'signed-out');
      }
    }
  }

  // Confirm the session once on load, then again whenever the tab comes back.
  useEffect(() => {
    void refresh();
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastValidated.current < REVALIDATE_MS) return;
      if (sessionRef.current) void refresh();
    };
    // Another tab signed in, switched or logged out: follow it without a reload.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_HINT_KEY) return;
      authGen.current += 1;
      const hint = readSessionHint(storage());
      if (!hint) {
        sessionRef.current = null;
        setSession(null);
        setStatus('signed-out');
        return;
      }
      sessionRef.current = hint.user;
      setSession(hint.user);
      setStatus('signed-in');
    };
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('focus', revalidate);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function detachSigner() {
    offAccountRef.current();
    offAccountRef.current = () => {};
    signerRef.current = null;
    signerIdRef.current = null;
    setWalletAddress(null);
  }

  /** Track the connected account; Phantom/Backpack/Solflare announce switches via standard:events. */
  function attachSigner(signer: Signer, id: string | null) {
    offAccountRef.current();
    signerRef.current = signer;
    signerIdRef.current = id;
    setWalletAddress(signer.address);
    offAccountRef.current =
      signer.onAccountChange?.((address) => {
        if (signerRef.current !== signer) return;
        if (!address) {
          detachSigner();
          return;
        }
        if (address === signer.address) return;
        // Rebuild the signer for the new account without prompting; nothing is signed here.
        setWalletAddress(address);
        if (!id) return;
        void signerFor(id, { noPrompt: true })
          .then((next) => {
            if (signerRef.current === signer) attachSigner(next, id);
          })
          .catch(() => undefined);
      }) ?? (() => {});
  }

  async function rollbackSignIn() {
    applySession(null, 'signed-out');
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  }

  async function finishSignIn(signer: Signer) {
    authGen.current += 1;
    setPhase('signing');
    const nonce = await api<{ message: string }>('/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ wallet: signer.address }),
    });
    const signature = await withTimeout(
      signSignInMessage(signer, nonce.message),
      WALLET_TIMEOUT_MS,
      WALLET_TIMEOUT_MESSAGE,
    );
    setPhase('verifying');
    await api('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ wallet: signer.address, signature: bs58.encode(signature) }),
    });
    authGen.current += 1;
    await sessionAfterVerify({
      load: () => refresh(true),
      rollback: rollbackSignIn,
    });
  }

  /**
   * Sign in with this signer unless the session already belongs to it (then nothing is
   * signed: one signature per session). Concurrent callers share one prompt.
   */
  function signInWith(signer: Signer, id: string | null, walletName?: string): Promise<void> {
    return flight.current(async () => {
      const current = sessionRef.current;
      if (current && current.wallet === signer.address) {
        attachSigner(signer, id);
        if (id) rememberWallet(id);
        return;
      }
      try {
        await commitAfterSignIn({
          finish: () => finishSignIn(signer),
          commit: () => {
            attachSigner(signer, id);
            if (id) rememberWallet(id);
          },
        });
        setError('');
      } catch (err) {
        console.error('[trenchmart] sign-in failed', err);
        // Keep the wallet connected so one click retries the signature (no reconnect).
        if (!signerRef.current || signerRef.current.address !== signer.address)
          attachSigner(signer, id);
        setError(
          err instanceof ApiError
            ? err.message
            : isUserRejection(err)
              ? SIGN_DECLINED_MESSAGE
              : walletErrorMessage(err, walletName),
        );
        throw err;
      } finally {
        setPhase('idle');
      }
    });
  }

  function rememberWallet(id: string) {
    writeLastWallet(safeLocalStorage(window), id);
    setLastUsedId(id);
  }

  /** The wallet the person clicked. Never the first one in the list. */
  async function signerFor(
    id: string,
    options: { silent?: boolean; noPrompt?: boolean } = {},
  ): Promise<Signer> {
    for (const wallet of standardWallets().get()) {
      if (!isUsableSolanaWallet(wallet)) continue;
      if (detectedIdFor(wallet.name) !== id) continue;
      return signerFromStandardWallet(wallet, options);
    }
    if (id === 'phantom' && !options.noPrompt) {
      const provider = readInjectedProvider(window);
      if (provider) {
        const signer = await signerFromLegacyProvider(provider);
        return { ...signer, name: 'Phantom' };
      }
    }
    throw new Error(NO_WALLET_MESSAGE);
  }

  // A valid session with the wallet not yet reconnected: reconnect silently in the
  // background (never a prompt) so the header can tell whether the account still matches.
  useEffect(() => {
    if (!session || signerRef.current || e2eSecret()) return;
    const last = readLastWallet(safeLocalStorage(window));
    if (!last || last === 'walletconnect') return;
    if (!detected.some((w) => w.id === last) || reconnectTried.current.has(last)) return;
    reconnectTried.current.add(last);
    const gen = authGen.current;
    void signerFor(last, { silent: true, noPrompt: true })
      .then((signer) => {
        if (gen === authGen.current && !signerRef.current) attachSigner(signer, last);
      })
      .catch(() => undefined);
  }, [session, detected]);

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
    let signing = false;
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
      signing = true;
      await signInWith(signer, 'walletconnect', 'WalletConnect');
      setPickerOpen(false);
    } catch (err) {
      if (generation !== wcGen.current) return;
      if (!signing) {
        console.error('[trenchmart] WalletConnect failed', err);
        setError(err instanceof ApiError ? err.message : walletErrorMessage(err, 'WalletConnect'));
      }
    }
  }

  function openPicker() {
    setError('');
    setLastUsedId(readLastWallet(safeLocalStorage(window)));
    setWalletConnectEnabled(Boolean(walletConnectProjectId()));
    setWcUri(null);
    wcGen.current += 1;
    setPickerOpen(true);
  }

  async function signIn() {
    const secret = e2eSecret();
    const signer = signerRef.current ?? (secret ? await signerFromSecret(secret) : null);
    if (!signer) {
      openPicker();
      return;
    }
    setError('');
    await signInWith(signer, signerIdRef.current, signer.name).catch(() => undefined);
  }

  async function connect() {
    if (busy) return;
    if (signerRef.current || e2eSecret()) return signIn();
    openPicker();
  }

  async function connectId(id: string) {
    if (busy) return;
    setPhase('connecting');
    setError('');
    let walletName: string | undefined;
    try {
      const signer = await withTimeout(
        signerFor(id, { silent: false }),
        WALLET_TIMEOUT_MS,
        WALLET_TIMEOUT_MESSAGE,
      );
      walletName = signer.name;
      await signInWith(signer, id, walletName);
      setPickerOpen(false);
    } catch (err) {
      if (!walletName) {
        console.error('[trenchmart] connect failed', err);
        setError(err instanceof ApiError ? err.message : walletErrorMessage(err, walletName));
      }
    } finally {
      setPhase('idle');
    }
  }

  /** Signs out locally first (instant), then tells the wallet and the API. Never throws. */
  async function logout() {
    authGen.current += 1;
    const signer = signerRef.current;
    detachSigner();
    reconnectTried.current.clear();
    setError('');
    applySession(null, 'signed-out');
    await Promise.all([
      signer?.disconnect?.().catch(() => undefined),
      api('/auth/logout', { method: 'POST' }).catch(() => undefined),
    ]);
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
      signer = await signerFor(last, { silent: true });
      attachSigner(signer, last);
    }
    return signer;
  }

  function assertSameWallet(signer: Signer) {
    const current = sessionRef.current;
    if (current && signer.address !== current.wallet)
      throw new Error(
        `Your wallet switched to ${shortAddress(signer.address)}. Switch back to ${shortAddress(current.wallet)} or sign in again.`,
      );
  }

  async function signMessage(text: string): Promise<string> {
    const signer = await activeSigner();
    assertSameWallet(signer);
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
    assertSameWallet(signer);
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

  const walletMismatch = Boolean(session && walletAddress && walletAddress !== session.wallet);
  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      status,
      phase,
      walletAddress,
      walletMismatch,
      busy,
      error,
      connect,
      signIn,
      logout,
      clearError: () => setError(''),
      signAndSend,
      signMessage,
      refresh: () => refresh(),
    }),
    [session, status, phase, walletAddress, walletMismatch, busy, error],
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
