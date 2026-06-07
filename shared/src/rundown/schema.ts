import { z } from 'zod';
import { IdSchema, TimestampSecondsSchema } from '../common/id.js';

export const RundownSlotSchema = z.object({
  slotId: IdSchema,
  templateId: IdSchema,
  name: z.string().min(1),
  vars: z.record(z.string()),
});
export type RundownSlot = z.infer<typeof RundownSlotSchema>;

export const RundownSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  slots: z.array(RundownSlotSchema),
  channelId: IdSchema.nullable(),
  created_at: TimestampSecondsSchema,
  updated_at: TimestampSecondsSchema,
});
export type Rundown = z.infer<typeof RundownSchema>;

export const CreateRundownRequestSchema = z.object({
  name: z.string().optional(),
  slots: z.array(RundownSlotSchema).optional(),
  channelId: IdSchema.nullable().optional(),
});
export type CreateRundownRequest = z.infer<typeof CreateRundownRequestSchema>;

export const UpdateRundownRequestSchema = z.object({
  name: z.string().optional(),
  slots: z.array(RundownSlotSchema).optional(),
  channelId: IdSchema.nullable().optional(),
});
export type UpdateRundownRequest = z.infer<typeof UpdateRundownRequestSchema>;

export const ReorderRundownsRequestSchema = z.object({
  ids: z.array(IdSchema),
});
export type ReorderRundownsRequest = z.infer<typeof ReorderRundownsRequestSchema>;
