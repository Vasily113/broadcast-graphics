import type { ControlCommand } from '@broadcast-graphics/shared';

interface RendererClient {
  readyState: number;
  send(data: string): void;
}

const OPEN = 1;
const rendererClients = new Map<string, Set<RendererClient>>();
const onAirState = new Map<string, Map<string, ControlCommand>>();

export function getClients(channelId: string) {
  if (!rendererClients.has(channelId)) rendererClients.set(channelId, new Set());
  return rendererClients.get(channelId)!;
}

export function getState(channelId: string) {
  if (!onAirState.has(channelId)) onAirState.set(channelId, new Map());
  return onAirState.get(channelId)!;
}

export function addRendererClient(channelId: string, client: RendererClient) {
  getClients(channelId).add(client);
}

export function removeRendererClient(channelId: string, client: RendererClient) {
  getClients(channelId).delete(client);
}

export function applyControlCommand(command: ControlCommand) {
  const channelId = command.channelId || 'default';
  const state = getState(channelId);

  if (command.type === 'take') {
    state.set(command.templateId, command);
  } else if (command.type === 'clear') {
    state.delete(command.templateId);
  } else if (command.type === 'update') {
    const existing = state.get(command.templateId);
    if (existing && existing.type === 'take') {
      state.set(command.templateId, { ...existing, variables: command.variables });
    }
  }

  return channelId;
}

export function broadcastToRenderers(channelId: string, command: ControlCommand) {
  const payload = JSON.stringify(command);
  getClients(channelId).forEach((client) => {
    if (client.readyState === OPEN) client.send(payload);
  });
}

export function getOnAirSummary() {
  const result: Record<string, string[]> = {};
  onAirState.forEach((channelMap, channelId) => {
    if (channelMap.size > 0) result[channelId] = Array.from(channelMap.keys());
  });
  return result;
}
