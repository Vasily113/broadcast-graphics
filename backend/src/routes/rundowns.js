import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';

export const rundownRouter = Router();

// List all rundowns (full data including slots) — in stored order
rundownRouter.get('/', async (req, res) => {
  const db = getDb();
  res.json(db.data.rundowns ?? []);
});

// Reorder rundowns
rundownRouter.post('/reorder', async (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const map = Object.fromEntries((db.data.rundowns ?? []).map(r => [r.id, r]));
  db.data.rundowns = ids.map(id => map[id]).filter(Boolean);
  await db.write();
  res.json({ ok: true });
});

// Get one rundown
rundownRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = (db.data.rundowns ?? []).find(r => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Create rundown
rundownRouter.post('/', async (req, res) => {
  const db = getDb();
  if (!db.data.rundowns) db.data.rundowns = [];
  const id = uuidv4();
  const { name, slots = [], channelId = null } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const rundown = { id, name: name || 'Rundown', slots, channelId, created_at: now, updated_at: now };
  db.data.rundowns.push(rundown);
  await db.write();
  res.json(rundown);
});

// Update rundown (partial: name and/or slots)
rundownRouter.put('/:id', async (req, res) => {
  const db = getDb();
  if (!db.data.rundowns) db.data.rundowns = [];
  const { name, slots, channelId } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const idx = db.data.rundowns.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const updated = { ...db.data.rundowns[idx], updated_at: now };
  if (name      !== undefined) updated.name      = name;
  if (slots     !== undefined) updated.slots     = slots;
  if (channelId !== undefined) updated.channelId = channelId;
  db.data.rundowns[idx] = updated;
  await db.write();
  res.json({ ok: true });
});

// Delete rundown
rundownRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  if (!db.data.rundowns) db.data.rundowns = [];
  db.data.rundowns = db.data.rundowns.filter(r => r.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});
