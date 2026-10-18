import { lamportsToUsdCents } from '@trenchmart/shared/price';

const LAMPORTS = 1_000_000_000n;

/** Display-only: exact SOL with at least 2 decimals. The shared formatSol truncates to 3. */
export function solExact(lamports: string | number | bigint): string {
  const value = BigInt(lamports);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  let frac = (abs % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '−' : ''}${abs / LAMPORTS}.${frac}`;
}

export function solText(lamports: string | number | bigint): string {
  return `${solExact(lamports)} SOL`;
}

/** "≈ $1,234.56", "< $0.01" below a cent, "" when there is no rate. */
export function usdText(cents: string | null | undefined, lamports?: string | bigint): string {
  if (cents == null || cents === '') return '';
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (abs === 0n && lamports !== undefined && BigInt(lamports) !== 0n) return '< $0.01';
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `≈ ${negative ? '−' : ''}$${dollars}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function moneyText(lamports: string, cents?: string | null): string {
  const dollars = usdText(cents, lamports);
  return dollars ? `${solText(lamports)} · ${dollars}` : solText(lamports);
}

export function usdFor(lamports: string | bigint, centsPerSol: string | null): string | null {
  if (!centsPerSol) return null;
  const value = BigInt(lamports);
  const cents = lamportsToUsdCents(value < 0n ? -value : value, BigInt(centsPerSol));
  return (value < 0n ? -cents : cents).toString();
}
