import { Router } from 'express';
import { EditTemplateRequestSchema, GenerateTemplateRequestSchema } from '@broadcast-graphics/shared';
import { sendValidationError } from '../http/validation.js';
import { editTemplateDraft, generateTemplateDraft } from '../services/llm/templateGenerator.js';

export const llmRouter = Router();

llmRouter.post('/generate-template', async (req, res) => {
  const parsed = GenerateTemplateRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const result = await generateTemplateDraft(parsed.data);
  return res.json(result);
});

llmRouter.post('/edit-template', async (req, res) => {
  const parsed = EditTemplateRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const result = await editTemplateDraft(parsed.data);
  return res.json(result);
});
