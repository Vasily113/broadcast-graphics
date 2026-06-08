import { z } from 'zod';
import { IdSchema, TimestampSecondsSchema } from '../common/id.js';

export const DisplayModeSchema = z.enum(['HD1080i50', 'HD1080p50']);
export type DisplayMode = z.infer<typeof DisplayModeSchema>;

export const KeyerModeSchema = z.enum(['external', 'internal', 'fill_only']);
export type KeyerMode = z.infer<typeof KeyerModeSchema>;

export const ChannelSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  device_index: z.number().int(),
  display_mode: DisplayModeSchema,
  keyer_mode: KeyerModeSchema,
  show_fps: z.boolean().default(false),
  created_at: TimestampSecondsSchema,
});
export type Channel = z.infer<typeof ChannelSchema>;

export const ChannelSettingsSchema = z.object({
  display_mode: DisplayModeSchema,
  keyer_mode: KeyerModeSchema,
  device_index: z.number().int(),
});
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

export const CreateChannelRequestSchema = z.object({
  name: z.string().optional(),
  device_index: z.coerce.number().int().optional(),
  display_mode: DisplayModeSchema.optional(),
  keyer_mode: KeyerModeSchema.optional(),
  show_fps: z.boolean().optional(),
});
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

export const UpdateChannelRequestSchema = CreateChannelRequestSchema.partial();
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequestSchema>;

export const UpdateSettingsRequestSchema = ChannelSettingsSchema.partial();
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
