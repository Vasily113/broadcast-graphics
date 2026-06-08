import { z } from 'zod';
import { IdSchema } from '../common/id.js';
import { TemplateSchema } from '../template/schema.js';

export const TakeCommandSchema = z.object({
  type: z.literal('take'),
  templateId: IdSchema,
  template: TemplateSchema,
  variables: z.record(z.string()),
  channelId: IdSchema.optional(),
});
export type TakeCommand = z.infer<typeof TakeCommandSchema>;

export const ClearCommandSchema = z.object({
  type: z.literal('clear'),
  templateId: IdSchema,
  channelId: IdSchema.optional(),
});
export type ClearCommand = z.infer<typeof ClearCommandSchema>;

export const UpdateCommandSchema = z.object({
  type: z.literal('update'),
  templateId: IdSchema,
  variables: z.record(z.string()),
  channelId: IdSchema.optional(),
});
export type UpdateCommand = z.infer<typeof UpdateCommandSchema>;

export const ControlCommandSchema = z.discriminatedUnion('type', [
  TakeCommandSchema,
  ClearCommandSchema,
  UpdateCommandSchema,
]);
export type ControlCommand = z.infer<typeof ControlCommandSchema>;
