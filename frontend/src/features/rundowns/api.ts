import { apiJson, apiSend, jsonRequest } from '../../core/http';
import type { RundownData, RundownSlot } from './types';

export function listRundowns(): Promise<RundownData[]> {
  return apiJson<RundownData[]>('/api/rundowns');
}

export function createRundown(input: { name?: string; slots?: RundownSlot[]; channelId?: string | null }): Promise<RundownData> {
  return apiJson<RundownData>('/api/rundowns', jsonRequest('POST', input));
}

export function updateRundown(id: string, patch: { name?: string; slots?: RundownSlot[]; channelId?: string | null }): Promise<{ ok: true }> {
  return apiJson<{ ok: true }>(`/api/rundowns/${id}`, jsonRequest('PUT', patch));
}

export function deleteRundown(id: string): Promise<void> {
  return apiSend(`/api/rundowns/${id}`, { method: 'DELETE' });
}

export function reorderRundowns(ids: string[]): Promise<{ ok: true }> {
  return apiJson<{ ok: true }>('/api/rundowns/reorder', jsonRequest('POST', { ids }));
}

export function getOnAir(): Promise<Record<string, string[]>> {
  return apiJson<Record<string, string[]>>('/api/onair');
}
