import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';

export const templateRouter = Router();

// Список шаблонов
templateRouter.get('/', async (req, res) => {
  const db = getDb();
  const list = db.data.templates.map(({ id, name, created_at, updated_at }) => ({
    id, name, created_at, updated_at
  }));
  res.json(list.sort((a, b) => b.updated_at - a.updated_at));
});

// Один шаблон
templateRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.data.templates.find(t => t.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Создать шаблон
templateRouter.post('/', async (req, res) => {
  const db = getDb();
  const id = uuidv4();
  const { name, data } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const template = { id, name, data, created_at: now, updated_at: now };
  db.data.templates.push(template);
  await db.write();
  res.json({ id, name });
});

// Обновить шаблон
templateRouter.put('/:id', async (req, res) => {
  const db = getDb();
  const { name, data } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const idx = db.data.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.data.templates[idx] = { ...db.data.templates[idx], name, data, updated_at: now };
  await db.write();
  res.json({ ok: true });
});

// Удалить шаблон
templateRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  db.data.templates = db.data.templates.filter(t => t.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});