import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';

export const rundownRouter = Router();

// List all rundowns (full data including slots)
rundownRouter.get('/', async (req, res) => {
  const db = getDb();
  const list = (db.data.rundowns ?? []);
  res.json(list.sort((a, b) => b.updated_at - a.updated_at));
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
  const { name, slots = [] } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const rundown = { id, name: name || 'Rundown', slots, created_at: now, updated_at: now };
  db.data.rundowns.push(rundown);
  await db.write();
  res.json(rundown);
});

// Update rundown (partial: name and/or slots)
rundownRouter.put('/:id', async (req, res) => {
  const db = getDb();
  if (!db.data.rundowns) db.data.rundowns = [];
  const { name, slots } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const idx = db.data.rundowns.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const updated = { ...db.data.rundowns[idx], updated_at: now };
  if (name !== undefined) updated.name = name;
  if (slots !== undefined) updated.slots = slots;
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
