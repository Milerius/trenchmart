'use client';

import {
  API_SCOPES,
  DEFAULT_KEY_RATE,
  MAX_KEY_RATE,
  SCOPE_DESCRIPTIONS,
  type ApiScope,
} from '@trenchmart/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon } from '@/components/icons';
import { Button, ButtonLink, ErrorState, Skeleton, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

type Scope = ApiScope;
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  rateLimitPerMin: number;
  createdVia: 'studio' | 'challenge';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

const SCOPES = API_SCOPES;
const INPUT =
  'mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-accent-line focus:outline-none';
const NAME_RE = /^[A-Za-z0-9 _.-]{1,48}$/;

function when(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface">
      <div className="border-b border-line-soft px-5 py-4 sm:px-6">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p>
      </div>
      <div className="space-y-5 p-5 sm:p-6">{children}</div>
    </section>
  );
}

export default function ApiKeysPage() {
  const wallet = useWallet();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [maxActive, setMaxActive] = useState(10);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['read', 'trade']);
  const [rate, setRate] = useState(DEFAULT_KEY_RATE);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function load() {
    const data = await api<{ keys: ApiKey[]; maxActive: number }>('/agent/keys');
    setKeys(data.keys);
    setMaxActive(data.maxActive);
  }

  useEffect(() => {
    if (!wallet.session) return;
    setLoadError('');
    void load().catch((err: Error) => setLoadError(err.message));
  }, [wallet.session]);

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">API keys</h1>
        <p className="mt-3 text-ink-2">Connect a wallet to manage keys for your agents.</p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }
  if (loadError) return <ErrorState title="Could not load your API keys." body={loadError} />;

  const active =
    keys?.filter((k) => !k.revokedAt && !(k.expiresAt && new Date(k.expiresAt) < new Date())) ?? [];
  const nameOk = NAME_RE.test(name.trim());
  const canCreate =
    nameOk && scopes.length > 0 && rate >= 1 && rate <= MAX_KEY_RATE && active.length < maxActive;

  async function create() {
    setError('');
    setBusy('create');
    try {
      const minted = await api<ApiKey & { key: string }>('/agent/keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes, rateLimitPerMin: rate }),
      });
      setCreated({ key: minted.key, name: minted.name });
      setCopied(false);
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function revoke(id: string) {
    setError('');
    setBusy(`revoke:${id}`);
    try {
      await api(`/agent/keys/${id}`, { method: 'DELETE' });
      setConfirm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.key);
    setCopied(true);
  }

  return (
    <section data-testid="api-keys" className="pb-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/studio" className="text-sm text-muted hover:text-ink">
            ← Studio
          </Link>
          <h1 className="m-0 mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            API keys
          </h1>
          <p className="m-0 mt-1 max-w-2xl text-ink-2">
            Let an agent buy, sell and manage your account through the{' '}
            <Link href="/docs/agents" className="text-accent">
              agent API
            </Link>
            . Keys act as this wallet with the scopes you pick. Transactions are still signed by the
            agent&apos;s own keypair: a key never moves funds by itself. Devnet only.
          </p>
        </div>
        <ButtonLink href="/docs/agents" variant="secondary">
          Agent API docs
        </ButtonLink>
      </div>

      {created ? (
        <div
          role="status"
          data-testid="new-key"
          className="mb-6 rounded-panel border border-accent-line bg-accent-bg p-5"
        >
          <p className="m-0 text-sm font-semibold text-ink">
            Key “{created.name}” created. Copy it now: it is shown once and stored only as a hash.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-ctl border border-line bg-inset px-3 py-2.5 font-mono text-[13px] text-ink">
              {created.key}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? (
                <>
                  <CheckIcon className="h-3.5 w-3.5" /> Copied
                </>
              ) : (
                'Copy'
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
          <p className="m-0 mt-3 text-[13px] text-muted">
            Use it as <span className="font-mono">Authorization: Bearer tmk_…</span>. Agents can
            also mint their own key by signing a challenge with their wallet.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="m-0 mb-4 rounded-ctl border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Section
            title="Create a key"
            sub={`Up to ${maxActive} active keys. Rate limits count every request made with the key.`}
          >
            <div>
              <label htmlFor="key-name" className="text-[13px] font-medium text-ink-2">
                Name
              </label>
              <input
                id="key-name"
                className={INPUT}
                placeholder="e.g. sniper-bot"
                maxLength={48}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={name.length > 0 && !nameOk}
              />
              {name.length > 0 && !nameOk ? (
                <p className="m-0 mt-1 text-xs text-danger">
                  Letters, digits, spaces, dot, dash and underscore only.
                </p>
              ) : null}
            </div>
            <fieldset>
              <legend className="text-[13px] font-medium text-ink-2">Scopes</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SCOPES.map((scope) => {
                  const on = scopes.includes(scope);
                  return (
                    <label
                      key={scope}
                      className={`flex cursor-pointer gap-3 rounded-ctl border px-3 py-2.5 ${on ? 'border-accent-line bg-accent-bg' : 'border-line bg-inset'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-[var(--color-accent)]"
                        checked={on}
                        onChange={() =>
                          setScopes(on ? scopes.filter((s) => s !== scope) : [...scopes, scope])
                        }
                      />
                      <span>
                        <span className="font-mono text-[13px] text-ink">{scope}</span>
                        <span className="block text-[12px] text-muted">
                          {SCOPE_DESCRIPTIONS[scope]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="max-w-xs">
              <label htmlFor="key-rate" className="text-[13px] font-medium text-ink-2">
                Rate limit (requests per minute)
              </label>
              <input
                id="key-rate"
                type="number"
                min={1}
                max={MAX_KEY_RATE}
                className={INPUT}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </div>
            <Button disabled={!canCreate || busy === 'create'} onClick={() => void create()}>
              {busy === 'create' ? 'Creating…' : 'Create key'}
            </Button>
          </Section>

          <Section title="Your keys" sub="Revoking takes effect on the next request.">
            {keys === null ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : keys.length === 0 ? (
              <p className="m-0 text-sm text-muted">No keys yet.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line-soft p-0" data-testid="key-list">
                {keys.map((k) => {
                  const expired = Boolean(k.expiresAt && new Date(k.expiresAt) < new Date());
                  return (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{k.name}</span>
                          <span className="font-mono text-[12px] text-muted">{k.prefix}…</span>
                          {k.revokedAt ? (
                            <Tag tone="danger">REVOKED</Tag>
                          ) : expired ? (
                            <Tag tone="warn">EXPIRED</Tag>
                          ) : (
                            <Tag tone="ok">ACTIVE</Tag>
                          )}
                          {k.createdVia === 'challenge' ? (
                            <Tag tone="info">AGENT-MINTED</Tag>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <Tag key={s}>{s}</Tag>
                          ))}
                        </div>
                        <p className="m-0 mt-1 text-[12px] text-muted">
                          {k.rateLimitPerMin}/min · created {when(k.createdAt)} · last used{' '}
                          {when(k.lastUsedAt)}
                        </p>
                      </div>
                      {!k.revokedAt ? (
                        confirm === k.id ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy === `revoke:${k.id}`}
                              onClick={() => void revoke(k.id)}
                            >
                              {busy === `revoke:${k.id}` ? 'Revoking…' : 'Confirm revoke'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setConfirm(k.id)}>
                            Revoke
                          </Button>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="rounded-panel border border-line bg-surface p-5 text-sm">
            <h2 className="m-0 text-base font-semibold">How agents use a key</h2>
            <ol className="m-0 mt-3 list-decimal space-y-2 pl-5 text-ink-2">
              <li>Send it as a Bearer token to https://api.trenchmart.fun/api/v1.</li>
              <li>The API returns unsigned transactions; the agent signs them locally.</li>
              <li>The agent broadcasts through the validated endpoint (or its own RPC).</li>
            </ol>
            <pre className="m-0 mt-4 overflow-x-auto rounded-ctl border border-line bg-inset p-3 font-mono text-[12px] text-ink-2">
              {`npm i @trenchmart/sdk\n\nconst tm = new TrenchmartClient({\n  apiKey: process.env.TM_API_KEY,\n});`}
            </pre>
            <p className="m-0 mt-3 text-[13px] text-muted">
              Full reference:{' '}
              <Link href="/docs/agents" className="text-accent">
                agent docs
              </Link>
              ,{' '}
              <a href="/api/v1/openapi.json" className="text-accent">
                OpenAPI
              </a>
              ,{' '}
              <a href="/llms.txt" className="text-accent">
                llms.txt
              </a>
              .
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
