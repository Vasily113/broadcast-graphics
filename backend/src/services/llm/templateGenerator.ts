import { v4 as uuidv4 } from 'uuid';
import {
  GenerateTemplateRequest,
  GenerateTemplateResponse,
  GenerateTemplateResponseSchema,
  EditTemplateRequest,
  EditTemplateResponse,
  Template,
  TemplateSchema,
  createDefaultTemplate,
  createDefaultTransform,
} from '@broadcast-graphics/shared';
import { requestLlamaCppJson } from './llamaCppClient.js';

function createFallbackTemplate(prompt: string): Template {
  const template = createDefaultTemplate(uuidv4(), 'AI draft');
  template.layers.push({
    id: uuidv4(),
    name: 'Generated title',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    groupId: null,
    transform: { ...createDefaultTransform(160, 160), width: 1200, height: 140 },
    content: prompt.slice(0, 80) || 'Generated title',
    style: {
      fontFamily: 'Arial',
      fontSize: 72,
      fontWeight: 'bold',
      fill: '#ffffff',
      align: 'left',
      lineHeight: 86,
      letterSpacing: 0,
      strokeColor: '#000000',
      strokeWidth: 0,
      dropShadow: true,
      dropShadowBlur: 8,
      dropShadowColor: '#000000',
      dropShadowDistance: 3,
    },
  });
  return template;
}

function systemPrompt() {
  return [
    'You generate JSON templates for a broadcast graphics editor.',
    'Return only JSON with shape: { "template": Template, "warnings": string[] }.',
    'Use 1920x1080 transparent canvas unless user requests otherwise.',
    'Keep templates simple and valid. Use text, rect, image, clock, or video layers.',
  ].join('\n');
}

export async function generateTemplateDraft(request: GenerateTemplateRequest): Promise<GenerateTemplateResponse> {
  try {
    const payload = await requestLlamaCppJson([
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: request.prompt },
    ], request.model);
    const parsed = GenerateTemplateResponseSchema.safeParse(payload);
    if (parsed.success) return parsed.data;
  } catch (error) {
    console.warn('[LLM] Falling back to local draft template:', error instanceof Error ? error.message : error);
  }

  return {
    template: createFallbackTemplate(request.prompt),
    warnings: ['LLM server unavailable or returned invalid JSON; generated a local fallback draft.'],
  };
}

export async function editTemplateDraft(request: EditTemplateRequest): Promise<EditTemplateResponse> {
  try {
    const payload = await requestLlamaCppJson([
      { role: 'system', content: systemPrompt() },
      {
        role: 'user',
        content: `Apply this edit to the template and return the full updated template.\nEdit: ${request.prompt}\nTemplate JSON: ${JSON.stringify(request.template)}`,
      },
    ], request.model);
    const parsed = GenerateTemplateResponseSchema.safeParse(payload);
    if (parsed.success) return parsed.data;
  } catch (error) {
    console.warn('[LLM] Returning original template after failed edit:', error instanceof Error ? error.message : error);
  }

  const template = TemplateSchema.parse(request.template);
  return {
    template,
    warnings: ['LLM edit unavailable or invalid; returned the original template unchanged.'],
  };
}
