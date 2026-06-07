import { z } from 'zod';
import { TemplateSchema } from '../template/schema.js';

export const LlmProviderSchema = z.enum(['llamacpp', 'openai-compatible']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const GenerateTemplateRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  provider: LlmProviderSchema.default('llamacpp'),
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
});
export type GenerateTemplateRequest = z.infer<typeof GenerateTemplateRequestSchema>;

export const GenerateTemplateResponseSchema = z.object({
  template: TemplateSchema,
  warnings: z.array(z.string()).default([]),
});
export type GenerateTemplateResponse = z.infer<typeof GenerateTemplateResponseSchema>;

export const EditTemplateRequestSchema = z.object({
  prompt: z.string().min(1),
  template: TemplateSchema,
  model: z.string().optional(),
  provider: LlmProviderSchema.default('llamacpp'),
});
export type EditTemplateRequest = z.infer<typeof EditTemplateRequestSchema>;

export const EditTemplateResponseSchema = GenerateTemplateResponseSchema;
export type EditTemplateResponse = z.infer<typeof EditTemplateResponseSchema>;
