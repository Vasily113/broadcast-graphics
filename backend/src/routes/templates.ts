import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TemplateSchema } from '@broadcast-graphics/shared';
import { getDb } from '../db.js';
import { sendValidationError } from '../http/validation.js';

export const templateRouter = Router();

templateRouter.get('/', (_req, res) => {
  const db = getDb();
  const list = db.data.templates.map(({ id, name, created_at, updated_at }) => ({
    id,
    name,
    created_at,
    updated_at,
  }));
  res.json(list.sort((a, b) => b.updated_at - a.updated_at));
});

templateRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.data.templates.find((t) => t.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  return res.json(row);
});

templateRouter.post('/', async (req, res) => {
  const db = getDb();
  const id = uuidv4();
  const { name, data } = req.body as { name?: string; data?: unknown };
  const parsed = TemplateSchema.safeParse(data);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const now = Math.floor(Date.now() / 1000);
  const template = {
    id,
    name: name || parsed.data.name || 'Новый шаблон',
    data: parsed.data,
    created_at: now,
    updated_at: now,
  };
  db.data.templates.push(template);
  await db.write();
  return res.json({ id, name: template.name });
});

templateRouter.put('/:id', async (req, res) => {
  const db = getDb();
  const { name, data } = req.body as { name?: string; data?: unknown };
  const now = Math.floor(Date.now() / 1000);
  const idx = db.data.templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const updated = { ...db.data.templates[idx], updated_at: now };
  if (name !== undefined) updated.name = name;
  if (data !== undefined) {
    const parsed = TemplateSchema.safeParse(data);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    updated.data = parsed.data;
  }

  db.data.templates[idx] = updated;
  await db.write();
  return res.json({ ok: true });
});

templateRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  db.data.templates = db.data.templates.filter((t) => t.id !== req.params.id);
  await db.write();
  return res.json({ ok: true });
});
