// Request-body schemas for reviews. Kept apart from ./social so web code that only needs
// the review rules/formatting does not bundle zod.
import { z } from 'zod';
import { REVIEW_REPORT_REASONS } from './social';

export const reviewPostBody = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().min(1).max(5000),
  versionId: z.string().uuid(),
  terminal: z.string().max(40).nullable().optional(),
  signature: z.string().min(64).max(120),
});
export const replyBody = z.object({ body: z.string().min(1).max(2000) });
export const reviewVoteBody = z.object({ helpful: z.boolean().nullable() });
export const reviewReportBody = z.object({ reason: z.enum(REVIEW_REPORT_REASONS) });
