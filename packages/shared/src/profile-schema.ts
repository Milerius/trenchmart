// Profile request-body schema, apart from ./profile so the web profile UI does not bundle zod.
import { z } from 'zod';

export const profileBody = z
  .object({
    handle: z.string().max(40).optional(),
    displayName: z.string().max(200).optional(),
    bio: z.string().max(2000).optional(),
    socials: z
      .object({
        telegram: z.string().max(200).optional(),
        discord: z.string().max(200).optional(),
        website: z.string().max(400).optional(),
        github: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    contact: z
      .object({
        enabled: z.boolean(),
        channels: z
          .array(
            z
              .object({
                kind: z.enum(['telegram', 'discord', 'email']),
                value: z.string().max(200),
                audience: z.enum(['everyone', 'buyers']),
              })
              .strict(),
          )
          .max(3),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ProfileInput = z.infer<typeof profileBody>;
