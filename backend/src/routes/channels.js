import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';

export const channelRouter = Router();

const ALLOWED_DISPLAY_MODES = new Set(['HD1080i50', 'HD1080p50']);

function normalizeDisplayMode(displayMode) {
  return ALLOWED_DISPLAY_MODES.has(displayMode) ? displayMode : 'HD1080i50';
}

function normalizeChannel(channel) {
  return {
    ...channel,
    display_mode: normalizeDisplayMode(channel.display_mode),
    show_fps: Boolean(channel.show_fps),
  };
}

channelRouter.get('/', (req, res) => {
  const db = getDb();
  res.json((db.data.channels ?? []).map(normalizeChannel).sort((a, b) => a.created_at - b.created_at));
});

channelRouter.get('/:id', (req, res) => {
  const db = getDb();
  const ch = (db.data.channels ?? []).find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  res.json(normalizeChannel(ch));
});

channelRouter.post('/', async (req, res) => {
  const db = getDb();
  if (!db.data.channels) db.data.channels = [];
  if (db.data.channels.length >= 8) return res.status(400).json({ error: 'Max 8 channels' });
  const { name, device_index = 0, display_mode = 'HD1080i50', keyer_mode = 'external', show_fps = false } = req.body;
  const channel = {
    id: uuidv4(),
    name: name || `Channel ${db.data.channels.length + 1}`,
    device_index: Number(device_index),
    display_mode: normalizeDisplayMode(display_mode),
    keyer_mode,
    show_fps: Boolean(show_fps),
    created_at: Math.floor(Date.now() / 1000),
  };
  db.data.channels.push(channel);
  await db.write();
  res.json(channel);
});

channelRouter.put('/:id', async (req, res) => {
  const db = getDb();
  const idx = (db.data.channels ?? []).findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { name, device_index, display_mode, keyer_mode, show_fps } = req.body;
  const updated = { ...db.data.channels[idx] };
  if (name         !== undefined) updated.name         = name;
  if (device_index !== undefined) updated.device_index = Number(device_index);
  if (display_mode !== undefined) updated.display_mode = normalizeDisplayMode(display_mode);
  if (keyer_mode   !== undefined) updated.keyer_mode   = keyer_mode;
  if (show_fps     !== undefined) updated.show_fps     = Boolean(show_fps);
  db.data.channels[idx] = updated;
  await db.write();
  res.json(updated);
});

channelRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  db.data.channels = (db.data.channels ?? []).filter(c => c.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});
