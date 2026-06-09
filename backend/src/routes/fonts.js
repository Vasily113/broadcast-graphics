import { Router } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { FONTS_DIR, importFontFile, listFonts } from '../fontsStore.js';
import { isFontExtension } from '../../../shared/fonts/registry.js';

const upload = multer({
  dest: path.join(os.tmpdir(), 'bgv13-font-upload'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (isFontExtension(ext)) cb(null, true);
    else cb(new Error('Only .ttf, .otf and .ttc font files are allowed'));
  },
});

export const fontsRouter = Router();

fontsRouter.get('/', async (_req, res) => {
  try {
    const fonts = await listFonts();
    res.json({ fonts });
  } catch (err) {
    console.error('[fonts] list failed:', err);
    res.status(500).json({ error: err.message || 'Failed to list fonts' });
  }
});

fontsRouter.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const { entry, created } = await importFontFile(req.file, {
      family: req.body?.family,
      variant: req.body?.variant === 'bold' ? 'bold' : 'regular',
      entryId: req.body?.entryId,
    });
    res.json({
      ok: true,
      created,
      font: {
        id: entry.id,
        family: entry.family,
        regularUrl: `/fonts/${entry.regular}`,
        boldUrl: entry.bold ? `/fonts/${entry.bold}` : null,
      },
    });
  } catch (err) {
    console.error('[fonts] import failed:', err);
    res.status(400).json({ error: err.message || 'Import failed' });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});

fontsRouter.get('/dir', (_req, res) => {
  res.json({ dir: FONTS_DIR });
});
