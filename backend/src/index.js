import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { templateRouter } from './routes/templates.js';
import { controlRouter } from './routes/control.js';
import { uploadsRouter } from './routes/uploads.js';
import { rundownRouter } from './routes/rundowns.js';
import { initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const rendererClients = new Set();
const controlClients = new Set();

// Tracks currently on-air templates: templateId -> last take command (with latest variables)
const onAirState = new Map();

app.ws('/ws/renderer', (ws) => {
  console.log('Renderer connected');
  rendererClients.add(ws);

  // Replay current on-air state so late-connecting renderers (e.g. OBS) get the full picture
  onAirState.forEach((cmd) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(cmd));
  });

  ws.on('close', () => rendererClients.delete(ws));
});

app.ws('/ws/control', (ws) => {
  console.log('Control client connected');
  controlClients.add(ws);
  ws.on('message', (msg) => {
    const command = JSON.parse(msg);

    // Maintain on-air state
    if (command.type === 'take') {
      onAirState.set(command.templateId, command);
    } else if (command.type === 'clear') {
      onAirState.delete(command.templateId);
    } else if (command.type === 'update') {
      const existing = onAirState.get(command.templateId);
      if (existing) onAirState.set(command.templateId, { ...existing, variables: command.variables });
    }

    rendererClients.forEach(client => {
      if (client.readyState === 1) client.send(JSON.stringify(command));
    });
  });
  ws.on('close', () => controlClients.delete(ws));
});

app.use('/api/templates', templateRouter);
app.use('/api/control', controlRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/rundowns', rundownRouter);
app.use('/uploads', express.static(path.resolve(__dirname, '../../data/uploads')));
app.use(express.static(path.resolve(__dirname, '../public')));

// Запускаем после инициализации БД
initDb().then(() => {
  app.listen(3001, () => {
    console.log('Backend running on http://localhost:3001');
  });
});