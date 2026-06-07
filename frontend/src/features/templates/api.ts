import { apiJson, apiSend, jsonRequest } from '../../core/http';
import type { FullTemplate, TemplateItem } from './types';
import type { Template } from '../../core/schema';

export async function listTemplates(): Promise<TemplateItem[]> {
  const payload = await apiJson<unknown>('/api/templates');
  return Array.isArray(payload) ? payload as TemplateItem[] : [];
}

export function getTemplate(id: string): Promise<FullTemplate> {
  return apiJson<FullTemplate>(`/api/templates/${id}`);
}

export function createTemplate(name: string, data: Template): Promise<{ id: string; name: string }> {
  return apiJson<{ id: string; name: string }>('/api/templates', jsonRequest('POST', { name, data }));
}

export function deleteTemplate(id: string): Promise<void> {
  return apiSend(`/api/templates/${id}`, { method: 'DELETE' });
}
