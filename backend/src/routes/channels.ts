import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CreateChannelRequestSchema, DisplayModeSchema, UpdateChannelRequestSchema } from '@broadcast-graphics/shared';
import { getDb } from '../db.js';
import { sendValidationError } from '../http/validation.js';

export const channelRouter = Router();

function normalizeDisplayMode(displayMode: unknown) {
  const parsed = DisplayModeSchema.safeParse(displayMode);
  return parsed.success ? parsed.data : 'HD1080i50';
}

function normalizeChannel<T extends { display_mode: unknown; show_fps?: unknown }>(channel: T) {
  return {
    ...channel,
    display_mode: normalizeDisplayMode(channel.display_mode),
    show_fps: Boolean(channel.show_fps),
  };
}

channelRouter.get('/', (_req, res) => {
  const db = getDb();
  return res.json((db.data.channels ?? []).map(normalizeChannel).sort((a, b) => a.created_at - b.created_at));
});

channelRouter.get('/:id', (req, res) => {
  const db = getDb();
  const ch = (db.data.channels ?? []).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  return res.json(normalizeChannel(ch));
});

channelRouter.post('/', async (req, res) => {
  const db = getDb();
  const parsed = CreateChannelRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  db.data.channels ??= [];
  if (db.data.channels.length >= 8) return res.status(400).json({ error: 'Max 8 channels' });

  const channel = {
    id: uuidv4(),
    name: parsed.data.name || `Channel ${db.data.channels.length + 1}`,
    device_index: parsed.data.device_index ?? 0,
    display_mode: parsed.data.display_mode ?? 'HD1080i50',
    keyer_mode: parsed.data.keyer_mode ?? 'external',
    show_fps: parsed.data.show_fps ?? false,
    created_at: Math.floor(Date.now() / 1000),
  };
  db.data.channels.push(channel);
  await db.write();
  return res.json(channel);
});

channelRouter.put('/:id', async (req, res) => {
  const db = getDb();
  const parsed = UpdateChannelRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const idx = (db.data.channels ?? []).findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const updated = { ...db.data.channels[idx] };
  if (parsed.data.name !== undefined) updated.name = parsed.data.name;
  if (parsed.data.device_index !== undefined) updated.device_index = parsed.data.device_index;
  if (parsed.data.display_mode !== undefined) updated.display_mode = parsed.data.display_mode;
  if (parsed.data.keyer_mode !== undefined) updated.keyer_mode = parsed.data.keyer_mode;
  if (parsed.data.show_fps !== undefined) updated.show_fps = parsed.data.show_fps;
  db.data.channels[idx] = updated;
  await db.write();
  return res.json(updated);
});

channelRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  db.data.channels = (db.data.channels ?? []).filter((c) => c.id !== req.params.id);
  await db.write();
  return res.json({ ok: true });
});
