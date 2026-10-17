import { formatSol, lamportsToUsdCents } from '@trenchmart/shared';

export function solText(lamports: string | number | bigint): string {
  return `${formatSol(BigInt(lamports))} SOL`;
}

export function usdText(cents: string | null | undefined): string {
  if (cents == null || cents === '') return '';
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}$${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function moneyText(lamports: string, cents?: string | null): string {
  const dollars = usdText(cents);
  return dollars ? `${solText(lamports)} · ${dollars}` : solText(lamports);
}

export function usdFor(lamports: string, centsPerSol: string | null): string | null {
  if (!centsPerSol) return null;
  return lamportsToUsdCents(BigInt(lamports), BigInt(centsPerSol)).toString();
}
