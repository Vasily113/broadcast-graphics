import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateRundownRequestSchema,
  ReorderRundownsRequestSchema,
  UpdateRundownRequestSchema,
} from '@broadcast-graphics/shared';
import { getDb } from '../db.js';
import { sendValidationError } from '../http/validation.js';

export const rundownRouter = Router();

rundownRouter.get('/', (_req, res) => {
  const db = getDb();
  return res.json(db.data.rundowns ?? []);
});

rundownRouter.post('/reorder', async (req, res) => {
  const db = getDb();
  const parsed = ReorderRundownsRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const map = Object.fromEntries((db.data.rundowns ?? []).map((r) => [r.id, r]));
  db.data.rundowns = parsed.data.ids.map((id) => map[id]).filter(Boolean);
  await db.write();
  return res.json({ ok: true });
});

rundownRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = (db.data.rundowns ?? []).find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  return res.json(row);
});

rundownRouter.post('/', async (req, res) => {
  const db = getDb();
  const parsed = CreateRundownRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  const rundown = {
    id,
    name: parsed.data.name || 'Rundown',
    slots: parsed.data.slots ?? [],
    channelId: parsed.data.channelId ?? null,
    created_at: now,
    updated_at: now,
  };
  db.data.rundowns ??= [];
  db.data.rundowns.push(rundown);
  await db.write();
  return res.json(rundown);
});

rundownRouter.put('/:id', async (req, res) => {
  const db = getDb();
  const parsed = UpdateRundownRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  db.data.rundowns ??= [];
  const idx = db.data.rundowns.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const now = Math.floor(Date.now() / 1000);
  const updated = { ...db.data.rundowns[idx], updated_at: now };
  if (parsed.data.name !== undefined) updated.name = parsed.data.name;
  if (parsed.data.slots !== undefined) updated.slots = parsed.data.slots;
  if (parsed.data.channelId !== undefined) updated.channelId = parsed.data.channelId;
  db.data.rundowns[idx] = updated;
  await db.write();
  return res.json({ ok: true });
});

rundownRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  db.data.rundowns = (db.data.rundowns ?? []).filter((r) => r.id !== req.params.id);
  await db.write();
  return res.json({ ok: true });
});
