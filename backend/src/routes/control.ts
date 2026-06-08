import { Router } from 'express';

export const controlRouter = Router();

// Legacy REST status endpoint kept for compatibility with older clients.
const status = new Map<string, unknown>();

controlRouter.get('/', (_req, res) => {
  return res.json(Object.fromEntries(status));
});

controlRouter.post('/:id', (req, res) => {
  status.set(req.params.id, req.body);
  return res.json({ ok: true });
});

controlRouter.delete('/:id', (req, res) => {
  status.delete(req.params.id);
  return res.json({ ok: true });
});
