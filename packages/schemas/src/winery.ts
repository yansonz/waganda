import { z } from 'zod';
import { EntityId, entityMetaShape } from './common';

export const Winery = z.object({
  id: EntityId,
  type: z.literal('WINERY'),
  name: z.string().min(1).max(160),
  nameNormalized: z.string().min(1),
  regionId: EntityId.optional(),
  country: z.string().min(2).max(60).optional(),
  website: z.url().optional(),
  notes: z.string().max(2000).optional(),
  ...entityMetaShape,
});
export type Winery = z.infer<typeof Winery>;

export const WineryInput = z.object({
  name: z.string().min(1).max(160),
  regionId: EntityId.optional(),
  country: z.string().min(2).max(60).optional(),
  website: z.url().optional(),
  notes: z.string().max(2000).optional(),
});
export type WineryInput = z.infer<typeof WineryInput>;

export const WineryPatch = WineryInput.partial();
export type WineryPatch = z.infer<typeof WineryPatch>;
