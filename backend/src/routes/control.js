import { Router } from 'express';

export const controlRouter = Router();

// Статус активных выводов (in-memory для MVP)
const activeGraphics = new Map();

controlRouter.get('/status', (req, res) => {
  res.json(Object.fromEntries(activeGraphics));
});