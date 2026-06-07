import { apiJson, apiSend, jsonRequest } from '../../core/http';
import type { Channel } from './types';

export function listChannels(): Promise<Channel[]> {
  return apiJson<Channel[]>('/api/channels');
}

export function createChannel(input: Partial<Pick<Channel, 'name' | 'device_index' | 'display_mode' | 'keyer_mode' | 'show_fps'>>): Promise<Channel> {
  return apiJson<Channel>('/api/channels', jsonRequest('POST', input));
}

export function updateChannel(id: string, patch: Partial<Pick<Channel, 'name' | 'device_index' | 'display_mode' | 'keyer_mode' | 'show_fps'>>): Promise<Channel> {
  return apiJson<Channel>(`/api/channels/${id}`, jsonRequest('PUT', patch));
}

export function deleteChannel(id: string): Promise<void> {
  return apiSend(`/api/channels/${id}`, { method: 'DELETE' });
}
