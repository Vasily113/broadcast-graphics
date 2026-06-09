import { Router } from 'express';
import { getDb } from '../db.js';

export const settingsRouter = Router();

const DEFAULTS = { display_mode: 'HD1080i50', keyer_mode: 'external', device_index: 0 };

settingsRouter.get('/', (req, res) => {
  const db = getDb();
  res.json({ ...DEFAULTS, ...db.data.settings });
});

settingsRouter.put('/', async (req, res) => {
  const db = getDb();
  const { display_mode, keyer_mode, device_index } = req.body;
  db.data.settings = {
    ...DEFAULTS,
    ...db.data.settings,
    ...(display_mode  !== undefined && { display_mode }),
    ...(keyer_mode    !== undefined && { keyer_mode   }),
    ...(device_index  !== undefined && { device_index: Number(device_index) }),
  };
  await db.write();
  res.json(db.data.settings);
});
