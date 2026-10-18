/** Integer config field: finite number (or numeric string) rounded and clamped, else the fallback. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
