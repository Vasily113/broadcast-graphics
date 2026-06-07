import { ControlCommandSchema } from '@broadcast-graphics/shared';
import {
  addRendererClient,
  applyControlCommand,
  broadcastToRenderers,
  getState,
  removeRendererClient,
} from './onAirState.js';

export interface WsCapableApp {
  ws(path: string, handler: (ws: any, req: any) => void): void;
}

export function registerSockets(app: WsCapableApp) {
  app.ws('/ws/renderer', (ws, req) => {
    const channelId = String(req.query.channel || 'default');
    addRendererClient(channelId, ws);
    console.log(`Renderer connected [channel=${channelId}]`);

    getState(channelId).forEach((cmd) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(cmd));
    });

    ws.on('close', () => {
      removeRendererClient(channelId, ws);
      console.log(`Renderer disconnected [channel=${channelId}]`);
    });
  });

  app.ws('/ws/control', (ws) => {
    console.log('Control client connected');
    ws.on('message', (msg: Buffer | string) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(msg));
      } catch {
        return;
      }

      const parsed = ControlCommandSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn('[WS] Ignoring invalid control command:', parsed.error.issues);
        return;
      }

      const channelId = applyControlCommand(parsed.data);
      broadcastToRenderers(channelId, parsed.data);
    });
    ws.on('close', () => console.log('Control client disconnected'));
  });
}
