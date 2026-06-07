import { Router } from 'express';
import { UpdateSettingsRequestSchema } from '@broadcast-graphics/shared';
import { getDb } from '../db.js';
import { sendValidationError } from '../http/validation.js';

export const settingsRouter = Router();

const DEFAULTS = { display_mode: 'HD1080i50' as const, keyer_mode: 'external' as const, device_index: 0 };

settingsRouter.get('/', (_req, res) => {
  const db = getDb();
  return res.json({ ...DEFAULTS, ...db.data.settings });
});

settingsRouter.put('/', async (req, res) => {
  const db = getDb();
  const parsed = UpdateSettingsRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  db.data.settings = {
    ...DEFAULTS,
    ...db.data.settings,
    ...parsed.data,
  };
  await db.write();
  return res.json(db.data.settings);
});
