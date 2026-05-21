import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { templateRouter } from './routes/templates.js';
import { controlRouter } from './routes/control.js';
import { uploadsRouter } from './routes/uploads.js';
import { rundownRouter } from './routes/rundowns.js';
import { settingsRouter } from './routes/settings.js';
import { channelRouter } from './routes/channels.js';
import { initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Channel-aware WebSocket state ───────────────────────────────────────────
// rendererClients: channelId → Set<WebSocket>
// onAirState:      channelId → Map<templateId, command>
const rendererClients = new Map();
const onAirState      = new Map();

function getClients(channelId) {
  if (!rendererClients.has(channelId)) rendererClients.set(channelId, new Set());
  return rendererClients.get(channelId);
}

function getState(channelId) {
  if (!onAirState.has(channelId)) onAirState.set(channelId, new Map());
  return onAirState.get(channelId);
}

// ── Renderer WS: each renderer registers with its channelId ────────────────
app.ws('/ws/renderer', (ws, req) => {
  const channelId = req.query.channel || 'default';
  const clients = getClients(channelId);
  clients.add(ws);
  console.log(`Renderer connected [channel=${channelId}]  total=${clients.size}`);

  // Replay current on-air state so late-connecting renderers get full picture
  getState(channelId).forEach((cmd) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(cmd));
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Renderer disconnected [channel=${channelId}]  total=${clients.size}`);
  });
});

// ── Control WS: routes commands to renderers of the matching channel ────────
app.ws('/ws/control', (ws) => {
  console.log('Control client connected');
  ws.on('message', (msg) => {
    let command;
    try { command = JSON.parse(msg); } catch { return; }

    const channelId = command.channelId || 'default';
    const state     = getState(channelId);

    // Maintain on-air state per channel
    if (command.type === 'take') {
      state.set(command.templateId, command);
    } else if (command.type === 'clear') {
      state.delete(command.templateId);
    } else if (command.type === 'update') {
      const existing = state.get(command.templateId);
      if (existing) state.set(command.templateId, { ...existing, variables: command.variables });
    }

    // Route to renderers on this channel only
    getClients(channelId).forEach((client) => {
      if (client.readyState === 1) client.send(JSON.stringify(command));
    });
  });
  ws.on('close', () => console.log('Control client disconnected'));
});

app.use('/api/templates', templateRouter);
app.use('/api/control',   controlRouter);
app.use('/api/uploads',   uploadsRouter);
app.use('/api/rundowns',  rundownRouter);
app.use('/api/settings',  settingsRouter);
app.use('/api/channels',  channelRouter);
app.use('/uploads', express.static(path.resolve(__dirname, '../../data/uploads')));
app.use(express.static(path.resolve(__dirname, '../public')));

initDb().then(() => {
  app.listen(3001, () => {
    console.log('Backend running on http://localhost:3001');
  });
});
