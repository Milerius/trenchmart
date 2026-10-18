// Monitoring and alerting (docs/ops/monitoring.md).
// opsCheck() runs on every cron tick (5 min) and on GET /internal/ops. Each alert is logged as
// `ALERT {...}` (Workers Logs). deliverAlerts() persists open/resolved state in ops_alerts
// (once on open, again every 6 h while open, once on resolve). Push channels (ntfy/email/
// Telegram/webhook) are disabled: the owner's assistant polls every 10 min and relays in chat.
import bs58 from 'bs58';
import { parseSecretKey, publicKeyOf } from '@trenchmart/chain';
import type { Deps } from './logic';
import { resolverOf } from './escrow';

export type OpsLevel = 'warn' | 'critical';
export type OpsAlert = { level: OpsLevel; code: string; message: string };

/** Every alert code with its runbook anchor in docs/ops/monitoring.md. */
export const ALERT_CODES = [
  'DB_ERROR',
  'R2_ERROR',
  'RPC_DOWN',
  'WEB_DOWN',
  'LOW_BALANCE',
  'RESOLVER_MISCONFIGURED',
  'UPGRADE_AUTHORITY_CHANGED',
  'RELEASE_STUCK',
  'CRON_FAILED',
  'WEBHOOK_FAILED',
  'SCAN_ERRORS',
  'SCAN_STUCK',
  'HTTP_5XX_SPIKE',
  'DISPUTE_SPIKE',
  'DISPUTES_WAITING',
  'PAYOUTS_WAITING',
  'CHECKOUT_PAUSED',
] as const;

export const OPS_THRESHOLDS = {
  /** Lamports below which a hot wallet can no longer pay for its transactions reliably. */
  lowBalanceLamports: 50_000_000n,
  releaseGraceMs: 15 * 60_000,
  scanStuckMs: 30 * 60_000,
  errorWindowMs: 15 * 60_000,
  http5xxPerWindow: 10,
  disputesPerHour: 5,
  renotifyMs: 6 * 3_600_000,
};

export type OpsEventKind = '5xx' | 'webhook_error' | 'scan_error' | 'cron_failed' | 'r2_error';

/** Best-effort error counter. Never throws: monitoring must not break the request. */
export async function recordOpsEvent(
  deps: Pick<Deps, 'sql'>,
  kind: OpsEventKind,
  detail: string,
): Promise<void> {
  try {
    await deps.sql`insert into ops_events (kind, detail) values (${kind}, ${detail.slice(0, 500)})`;
  } catch {
    // The DB itself may be what failed; the ALERT log line still goes to Workers Logs.
  }
}

function fetchOf(deps: Deps): typeof fetch {
  return deps.opsFetch ?? fetch;
}

async function timed(f: typeof fetch, url: string, init: RequestInit = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Upgrade authority of an upgradeable BPF program, '' when immutable, null when unreadable. */
export async function upgradeAuthorityOf(deps: Deps, programId: string): Promise<string | null> {
  const chain = deps.escrowChain;
  if (!chain) return null;
  const program = await chain.account(programId);
  if (!program || program.data.length < 36) return null;
  const programData = bs58.encode(program.data.subarray(4, 36));
  const data = await chain.account(programData);
  if (!data || data.data.length < 13) return null;
  if (data.data[12] === 0) return '';
  return bs58.encode(data.data.subarray(13, 45));
}

async function count(deps: Deps, kind: OpsEventKind, since: Date): Promise<number> {
  const rows = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from ops_events where kind = ${kind} and created_at >= ${since}
  `;
  return rows[0]?.n ?? 0;
}

/** Read-only health and safety checks. Returns the open alerts. */
export async function opsCheck(deps: Deps): Promise<OpsAlert[]> {
  const alerts: OpsAlert[] = [];
  const add = (level: OpsLevel, code: string, message: string) =>
    alerts.push({ level, code, message });
  const now = deps.now();
  const t = OPS_THRESHOLDS;
  const f = fetchOf(deps);

  // Uptime: Solana RPC and the web app (the API answering this cron is itself up; an
  // external watchdog worker covers the API being down, see apps/watchdog).
  if (deps.env.rpcUrl) {
    try {
      const res = await timed(f, deps.env.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const body = (await res.json().catch(() => ({}))) as { result?: string };
      if (!res.ok || body.result !== 'ok')
        add(
          'critical',
          'RPC_DOWN',
          `RPC getHealth: HTTP ${res.status} ${body.result ?? ''}`.trim(),
        );
    } catch (err) {
      add('critical', 'RPC_DOWN', `RPC unreachable: ${(err as Error).message}`);
    }
  }
  if (deps.env.appUrl && !/localhost|127\.0\.0\.1/.test(deps.env.appUrl)) {
    try {
      const res = await timed(f, deps.env.appUrl, { method: 'GET', redirect: 'manual' });
      if (res.status >= 500)
        add('critical', 'WEB_DOWN', `${deps.env.appUrl} answered HTTP ${res.status}`);
    } catch (err) {
      add('critical', 'WEB_DOWN', `${deps.env.appUrl} unreachable: ${(err as Error).message}`);
    }
  }

  // Storage: R2 write, read back, delete.
  try {
    const key = 'ops/probe';
    const stamp = new TextEncoder().encode(now.toISOString());
    await deps.blob.put(key, stamp);
    const back = await deps.blob.get(key);
    if (!back || back.length !== stamp.length) throw new Error('read-back mismatch');
    await deps.blob.delete(key);
  } catch (err) {
    add('critical', 'R2_ERROR', `file storage probe failed: ${(err as Error).message}`);
  }

  // Hot wallets and program authority.
  if (deps.env.escrowProgramId && deps.escrowChain) {
    const wallets: [string, string][] = [];
    try {
      wallets.push(['resolver', resolverOf(deps.env).pubkey]);
    } catch {
      add(
        'critical',
        'RESOLVER_MISCONFIGURED',
        'escrow resolver is not set or does not match its secret',
      );
    }
    if (deps.env.escrowCrankSecret)
      wallets.push(['fee payer (crank)', publicKeyOf(parseSecretKey(deps.env.escrowCrankSecret))]);
    for (const [role, pubkey] of wallets) {
      try {
        const info = await deps.escrowChain.account(pubkey);
        const lamports = info?.lamports ?? 0n;
        if (lamports < t.lowBalanceLamports)
          add(
            'critical',
            'LOW_BALANCE',
            `${role} ${pubkey} holds ${Number(lamports) / 1e9} SOL; top it up so releases and refunds keep landing`,
          );
      } catch (err) {
        add('critical', 'RPC_DOWN', `balance read failed: ${(err as Error).message}`);
      }
    }
    if (deps.env.expectedUpgradeAuthority) {
      try {
        const authority = await upgradeAuthorityOf(deps, deps.env.escrowProgramId);
        if (authority !== null && authority !== deps.env.expectedUpgradeAuthority)
          add(
            'critical',
            'UPGRADE_AUTHORITY_CHANGED',
            `escrow program upgrade authority is ${authority || 'none (immutable)'}, expected ${deps.env.expectedUpgradeAuthority}`,
          );
      } catch (err) {
        add('warn', 'RPC_DOWN', `upgrade authority read failed: ${(err as Error).message}`);
      }
    }
  }

  // Database-backed business and safety checks. A failing query is itself an alert.
  try {
    const since = new Date(now.getTime() - t.errorWindowMs);
    const [stuck] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from orders o
      where o.status = 'paid' and o.escrow_until < ${new Date(now.getTime() - t.releaseGraceMs)}
        and not exists (select 1 from disputes d where d.order_id = o.id and d.status = 'open')
    `;
    if ((stuck?.n ?? 0) > 0)
      add(
        'critical',
        'RELEASE_STUCK',
        `${stuck!.n} paid order(s) are more than 15 min past their escrow window and not released`,
      );
    const cron = await count(deps, 'cron_failed', since);
    if (cron > 0)
      add(
        'critical',
        'CRON_FAILED',
        `${cron} cron job failure(s) in the last 15 min (see Workers Logs: ALERT CRON_FAILED)`,
      );
    const hooks = await count(deps, 'webhook_error', since);
    if (hooks > 0)
      add(
        'critical',
        'WEBHOOK_FAILED',
        `${hooks} payment webhook failure(s) in the last 15 min; payments may not be credited`,
      );
    const scans = await count(deps, 'scan_error', since);
    if (scans > 0)
      add('warn', 'SCAN_ERRORS', `${scans} scan/review pipeline error(s) in the last 15 min`);
    const r2 = await count(deps, 'r2_error', since);
    if (r2 > 0) add('critical', 'R2_ERROR', `${r2} file storage error(s) in the last 15 min`);
    const [scanning] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from versions
      where status = 'scanning' and created_at < ${new Date(now.getTime() - t.scanStuckMs)}
    `;
    if ((scanning?.n ?? 0) > 0)
      add('warn', 'SCAN_STUCK', `${scanning!.n} version(s) stuck in scanning for more than 30 min`);
    const errors = await count(deps, '5xx', since);
    if (errors >= t.http5xxPerWindow)
      add('critical', 'HTTP_5XX_SPIKE', `${errors} API 5xx responses in the last 15 min`);
    const [recent] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from disputes where created_at >= ${new Date(now.getTime() - 3_600_000)}
    `;
    if ((recent?.n ?? 0) >= t.disputesPerHour)
      add('critical', 'DISPUTE_SPIKE', `${recent!.n} disputes opened in the last hour`);
    const [waiting] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from disputes
      where status = 'open' and created_at < ${new Date(now.getTime() - 24 * 3_600_000)}
    `;
    if ((waiting?.n ?? 0) > 0)
      add(
        'warn',
        'DISPUTES_WAITING',
        `${waiting!.n} dispute(s) open for more than 24 h; the on-chain timeout refunds the buyer after 7 days`,
      );
    const [payouts] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from payouts
      where status in ('pending', 'proposed') and created_at < ${new Date(now.getTime() - 48 * 3_600_000)}
    `;
    if ((payouts?.n ?? 0) > 0)
      add(
        'warn',
        'PAYOUTS_WAITING',
        `${payouts!.n} vault payout line(s) waiting more than 48 h for the vault signature`,
      );
  } catch (err) {
    add('critical', 'DB_ERROR', `database check failed: ${(err as Error).message}`);
  }
  if (deps.env.checkoutPaused) add('warn', 'CHECKOUT_PAUSED', 'checkout kill switch is on');
  for (const alert of alerts) console.error('ALERT', JSON.stringify(alert));
  return alerts;
}

/**
 * Legacy ntfy helper (unused by notify — delivery is assistant chat only). Kept for unit tests
 * and optional one-off scripts. Email forwarding needs an ntfy account token; without it, or if
 * email is refused, posts as push only. Does nothing useful in production.
 */
export async function postNtfy(
  f: typeof fetch,
  env: {
    alertNtfyServer: string;
    alertNtfyTopic: string;
    alertEmail: string;
    alertNtfyToken: string;
  },
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  const url = `${env.alertNtfyServer}/${env.alertNtfyTopic}`;
  const auth: Record<string, string> = env.alertNtfyToken
    ? { Authorization: `Bearer ${env.alertNtfyToken}` }
    : {};
  if (env.alertEmail && env.alertNtfyToken) {
    const res = await timed(f, url, {
      method: 'POST',
      headers: { ...headers, ...auth, Email: env.alertEmail },
      body,
    });
    if (res.ok) return res;
    console.error('ALERT_DELIVERY', 'ntfy email refused', res.status);
  }
  return timed(f, url, { method: 'POST', headers: { ...headers, ...auth }, body });
}

export type Notice = {
  title: string;
  body: string;
  level: OpsLevel | 'resolved' | 'test';
  code?: string;
};

/**
 * Alert "delivery" for the owner: the assistant polls open alerts every 10 min and relays them
 * in chat. External push (ntfy / email / Telegram / webhook) is intentionally disabled so missing
 * credentials never log ALERT_DELIVERY errors. Returns ["assistant"] so callers treat the notice
 * as acknowledged for renotify bookkeeping.
 */
export async function notify(_deps: Deps, _notice: Notice): Promise<string[]> {
  return ['assistant'];
}

/**
 * Turns the current alert set into notices: new alerts, still-open alerts every 6 h, resolved
 * alerts once. Alert state lives in ops_alerts; when the database is down every alert is sent.
 */
export async function deliverAlerts(deps: Deps, alerts: OpsAlert[]): Promise<Notice[]> {
  const now = deps.now();
  const notices: Notice[] = [];
  const dbDown = alerts.some((a) => a.code === 'DB_ERROR');
  if (dbDown) {
    for (const a of alerts)
      notices.push({
        title: `${a.level.toUpperCase()} ${a.code}`,
        body: a.message,
        level: a.level,
      });
  } else {
    const open = await deps.sql<{ code: string; notified_at: Date | null }[]>`
      select code, notified_at from ops_alerts where resolved_at is null
    `;
    const known = new Map(open.map((row) => [row.code, row.notified_at]));
    // Several alerts can share a code (for example two low wallets): merge their messages.
    const byCode = new Map<string, OpsAlert>();
    for (const a of alerts) {
      const prev = byCode.get(a.code);
      byCode.set(
        a.code,
        prev
          ? {
              ...prev,
              level: prev.level === 'critical' ? 'critical' : a.level,
              message: `${prev.message}\n${a.message}`,
            }
          : a,
      );
    }
    for (const a of byCode.values()) {
      const notified = known.get(a.code);
      const due =
        !known.has(a.code) ||
        !notified ||
        now.getTime() - new Date(notified).getTime() >= OPS_THRESHOLDS.renotifyMs;
      await deps.sql`
        insert into ops_alerts (code, level, message, first_at, last_at, notified_at, resolved_at)
        values (${a.code}, ${a.level}, ${a.message}, ${now}, ${now}, ${due ? now : null}, null)
        on conflict (code) do update set level = excluded.level, message = excluded.message,
          last_at = excluded.last_at,
          first_at = case when ops_alerts.resolved_at is null then ops_alerts.first_at else excluded.first_at end,
          notified_at = case when ${due} then excluded.last_at else ops_alerts.notified_at end,
          resolved_at = null
      `;
      if (due)
        notices.push({
          title: `${a.level.toUpperCase()} ${a.code}`,
          body: a.message,
          level: a.level,
          code: a.code,
        });
    }
    for (const code of known.keys()) {
      if (byCode.has(code)) continue;
      await deps.sql`update ops_alerts set resolved_at = ${now} where code = ${code}`;
      notices.push({
        title: `RESOLVED ${code}`,
        body: `${code} is no longer firing.`,
        level: 'resolved',
      });
    }
  }
  for (const notice of notices) await notify(deps, notice);
  return notices;
}


/** Open + recently resolved rows for the assistant poller (machine-readable). */
export async function opsAlertRows(deps: Deps) {
  const open = await deps.sql<Record<string, unknown>[]>`
    select code, level, message, first_at, last_at, notified_at, resolved_at
    from ops_alerts where resolved_at is null order by last_at desc
  `;
  const resolved = await deps.sql<Record<string, unknown>[]>`
    select code, level, message, first_at, last_at, notified_at, resolved_at
    from ops_alerts where resolved_at is not null order by resolved_at desc limit 20
  `;
  return { open, resolved };
}

/** Status for the admin dashboard: current checks, alert history, recent error counts. */
export async function opsStatus(deps: Deps) {
  const alerts = await opsCheck(deps);
  const history = await deps.sql<Record<string, unknown>[]>`
    select code, level, message, first_at, last_at, notified_at, resolved_at
    from ops_alerts order by last_at desc limit 50
  `;
  const events = await deps.sql<{ kind: string; n: number }[]>`
    select kind, count(*)::int as n from ops_events
    where created_at >= ${new Date(deps.now().getTime() - 24 * 3_600_000)} group by kind order by kind
  `;
  return {
    checkedAt: deps.now().toISOString(),
    ok: !alerts.some((a) => a.level === 'critical'),
    alerts,
    history,
    events24h: events,
    channels: {
      assistant: true, // owner assistant polls /internal/ops/alerts every 10 min
      ntfy: false,
      email: false,
      telegram: false,
      webhook: false,
    },
    codes: ALERT_CODES,
  };
}
