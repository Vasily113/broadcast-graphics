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
import { llmRouter } from './routes/llm.js';
import { initDb } from './db.js';
import { registerSockets, type WsCapableApp } from './ws/registerSockets.js';
import { getOnAirSummary } from './ws/onAirState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

registerSockets(app as unknown as WsCapableApp);

app.get('/api/onair', (_req, res) => {
  return res.json(getOnAirSummary());
});

app.use('/api/templates', templateRouter);
app.use('/api/control', controlRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/rundowns', rundownRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/channels', channelRouter);
app.use('/api/llm', llmRouter);
app.use('/uploads', express.static(path.resolve(__dirname, '../../data/uploads')));
app.use(express.static(path.resolve(__dirname, '../public')));

initDb().then(() => {
  const port = Number(process.env.PORT) || 4001;
  app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`);
  });
});
