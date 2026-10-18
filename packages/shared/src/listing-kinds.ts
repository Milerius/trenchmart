import { z } from 'zod';
import {
  BOT_RUNTIMES,
  BOT_SETTINGS,
  BOTS,
  BROWSERS,
  CADENCES,
  FILTER_TYPES,
  INDICATOR_LANGUAGES,
  INDICATOR_PLATFORMS,
  type ListingKind,
  SCRIPT_MANAGERS,
  TELEGRAM_FEATURES,
  WALLET_COLUMNS,
  WALLET_FORMATS,
} from './listing-kinds-display';

// Display data and helpers live in listing-kinds-display (no zod), so pages that only show
// specs do not ship the validator to the browser.
export * from './listing-kinds-display';

const HOST =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+(?:\/[A-Za-z0-9._~/-]{0,100})?$/;
const set = <T extends readonly [string, ...string[]]>(values: T, min = 0, message = '') =>
  z
    .array(z.enum(values))
    .min(min, message)
    .max(values.length * 2)
    .transform((list) => [...new Set(list)]);

export const scriptSpecs = z
  .object({
    managers: set(SCRIPT_MANAGERS),
    browsers: set(BROWSERS),
    readsPage: z.boolean(),
    network: z.enum(['none', 'terminal', 'hosts']),
    hosts: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(HOST, 'A host like api.example.com')
          .refine((h) => !h.startsWith('xn--') && !h.includes('.xn--'), 'No punycode hosts'),
      )
      .max(10)
      .default([]),
    tradeButtons: z.boolean(),
    storage: z.enum(['none', 'local', 'remote']),
  })
  .strict();

export const botSpecs = z
  .object({
    bots: set(BOTS, 1, 'Pick a bot'),
    settings: set(BOT_SETTINGS),
  })
  .strict();

// No wallet count here: the scan counts the wallets in the uploaded file and stores the
// verified count on the version (versions.wallet_count). A walletCount sent by an older client
// is dropped, never stored or shown.
export const walletSpecs = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { walletCount: _ignored, ...rest } = value as Record<string, unknown>;
    return rest;
  },
  z
    .object({
      chain: z.literal('solana'),
      formats: set(WALLET_FORMATS, 1, 'Pick a format'),
      cadence: z.enum(CADENCES),
      columns: set(WALLET_COLUMNS),
    })
    .strict(),
);

export const filterSpecs = z.object({ filterTypes: set(FILTER_TYPES) }).strict();

export const indicatorSpecs = z
  .object({ platform: z.enum(INDICATOR_PLATFORMS), language: z.enum(INDICATOR_LANGUAGES) })
  .strict();

export const telegramSpecs = z
  .object({ runtime: z.enum(BOT_RUNTIMES), features: set(TELEGRAM_FEATURES) })
  .strict();

export const otherSpecs = z.object({ what: z.string().trim().min(3).max(120) }).strict();

export const SPEC_SCHEMAS = {
  script: scriptSpecs,
  bot: botSpecs,
  wallet: walletSpecs,
  filter: filterSpecs,
  indicator: indicatorSpecs,
  telegram: telegramSpecs,
  other: otherSpecs,
} as const;

export type ListingSpecs = {
  script: z.infer<typeof scriptSpecs>;
  bot: z.infer<typeof botSpecs>;
  wallet: z.infer<typeof walletSpecs>;
  filter: z.infer<typeof filterSpecs>;
  indicator: z.infer<typeof indicatorSpecs>;
  telegram: z.infer<typeof telegramSpecs>;
  other: z.infer<typeof otherSpecs>;
};

/** Validates specs for a kind; the error names the first bad field. */
export function parseSpecs(
  kind: ListingKind,
  specs: unknown,
): { ok: true; specs: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = SPEC_SCHEMAS[kind].safeParse(specs);
  if (parsed.success) return { ok: true, specs: parsed.data as Record<string, unknown> };
  const issue = parsed.error.issues[0];
  const at = issue?.path.join('.') || 'specs';
  return { ok: false, error: `${at}: ${issue?.message ?? 'invalid'}` };
}
