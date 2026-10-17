/** USD display only. Ledger rows stay in lamports. */
export function parseUsdCents(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const parts = trimmed.split('.');
  const whole = parts[0] ?? '0';
  const frac = (parts[1] ?? '').slice(0, 2).padEnd(2, '0');
  return BigInt(whole) * 100n + BigInt(frac || '0');
}

export function lamportsToUsdCents(lamports: bigint, centsPerSol: bigint): bigint {
  if (centsPerSol < 0n || lamports < 0n) throw new Error('amounts must be >= 0');
  return (lamports * centsPerSol) / 1_000_000_000n;
}

export function moneyView(lamports: bigint, centsPerSol: bigint | null, sol: string) {
  const usdCents = centsPerSol === null ? null : lamportsToUsdCents(lamports, centsPerSol);
  return {
    lamports: lamports.toString(),
    sol,
    usdCents: usdCents === null ? null : usdCents.toString(),
  };
}
