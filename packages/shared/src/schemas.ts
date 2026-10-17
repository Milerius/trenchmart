import { z } from 'zod';
import { CATEGORY_CODES } from './config';

export const walletSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid wallet');

export const txSigSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/, 'invalid signature');

export const nonceBody = z.object({ wallet: walletSchema });
export const verifyBody = z.object({
  wallet: walletSchema,
  signature: z.string().min(64).max(200),
});

export const quoteBody = z.object({ listingId: z.string().uuid() });
export const orderBody = z.object({ listingId: z.string().uuid() });
export const submittedBody = z.object({ txSig: txSigSchema });

export const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().min(1).max(5000),
});

export const disputeBody = z.object({
  reason: z.enum(['malicious', 'not_as_described', 'broken', 'other']),
  details: z.string().min(10).max(5000),
});

export const listingBody = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(280),
  description: z.string().min(1).max(20_000),
  category: z.enum(CATEGORY_CODES),
  terminals: z.array(z.string().min(1).max(40)).max(12).default([]),
  priceLamports: z.string().regex(/^\d+$/),
  license: z.enum(['single', 'multi3', 'subscription']).default('single'),
  subPeriodDays: z.number().int().positive().max(3650).optional(),
  holderOnlyHours: z.number().int().min(0).max(24 * 14).default(0),
  holderOnly: z.boolean().default(false),
});

export const listingPatch = listingBody.partial();

export const versionBody = z.object({
  semver: z.string().regex(/^\d+\.\d+\.\d+$/),
  changelog: z.string().max(10_000).default(''),
  fileName: z.string().min(1).max(180),
  fileSize: z.number().int().positive(),
});

export const explainBody = z.object({ note: z.string().min(1).max(5000) });

export const bondBody = z.object({ amount: z.string().regex(/^\d+$/) });

export const resolveDisputeBody = z.object({
  status: z.enum(['upheld', 'rejected']),
  resolution: z.string().min(1).max(5000),
  slashLamports: z.string().regex(/^\d+$/).optional(),
});

export const roleBody = z.object({
  roles: z.array(z.enum(['buyer', 'creator', 'admin'])).min(1),
});

export const devLinkBody = z.object({
  handle: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_]+$/),
});

export const verifyJsonBody = z.object({
  fileName: z.string().min(1).max(180),
  contentBase64: z.string().min(1),
});

export const reportBody = z.object({
  details: z.string().min(10).max(5000),
});

export const listingsQuery = z.object({
  q: z.string().max(200).optional(),
  category: z.enum(CATEGORY_CODES).optional(),
  terminal: z.string().max(40).optional(),
  sort: z.enum(['trending', 'new', 'price_asc', 'price_desc', 'rating']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
});

export const buybackBody = z.object({
  txSig: txSigSchema,
  solLamports: z.string().regex(/^\d+$/),
  note: z.string().max(500).default(''),
});

export const batchSentBody = z.object({ txSig: txSigSchema });

export const configValueBody = z.object({ value: z.unknown() });

export const filterPresetSchema = z
  .object({
    terminal: z.string().max(40).optional(),
    name: z.string().max(120).optional(),
    devHolding: z.string().max(40).optional(),
    top10: z.string().max(40).optional(),
    bundlers: z.string().max(40).optional(),
    migratedOnly: z.boolean().optional(),
    minLiquidity: z.string().max(40).optional(),
    minMarketCap: z.string().max(40).optional(),
    maxAgeSec: z.number().optional(),
    requireSocials: z.boolean().optional(),
  })
  .strict();

export const KNOWN_FILTER_KEYS = Object.keys(filterPresetSchema.shape);
