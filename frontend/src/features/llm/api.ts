import { apiJson, jsonRequest } from '../../core/http';
import type { Template } from '../../core/schema';

export interface GenerateTemplateResult {
  template: Template;
  warnings: string[];
}

export function generateTemplate(prompt: string): Promise<GenerateTemplateResult> {
  return apiJson<GenerateTemplateResult>('/api/llm/generate-template', jsonRequest('POST', { prompt, provider: 'llamacpp' }));
}

export function editTemplate(prompt: string, template: Template): Promise<GenerateTemplateResult> {
  return apiJson<GenerateTemplateResult>('/api/llm/edit-template', jsonRequest('POST', { prompt, template, provider: 'llamacpp' }));
}
