// Display helpers for creator profiles.

export const shortWallet = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

export function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d`;
  if (s < 60 * 86_400) return `${Math.round(s / (7 * 86_400))}w`;
  return `${Math.round(s / (30 * 86_400))}mo`;
}
