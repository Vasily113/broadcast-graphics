import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  emptyManifest,
  findEntryByFamily,
  findEntryById,
  humanizeFilename,
  isFontExtension,
  normalizeManifest,
  slugFromName,
} from '../../shared/fonts/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = path.resolve(__dirname, '../../fonts');
const MANIFEST_PATH = path.join(FONTS_DIR, 'manifest.json');

async function ensureFontsDir() {
  await fs.mkdir(FONTS_DIR, { recursive: true });
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
    await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(emptyManifest(), null, 2)}\n`, 'utf8');
  }
}

export async function readManifest() {
  await ensureFontsDir();
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  return normalizeManifest(JSON.parse(raw));
}

async function writeManifest(manifest) {
  await ensureFontsDir();
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`, 'utf8');
}

export function fontFilePath(filename) {
  const base = path.basename(filename);
  if (base !== filename || base.includes('..')) throw new Error('Invalid font filename');
  return path.join(FONTS_DIR, base);
}

export async function listFonts() {
  const manifest = await readManifest();
  return manifest.entries.map((e) => ({
    id: e.id,
    family: e.family,
    regularUrl: `/fonts/${e.regular}`,
    boldUrl: e.bold ? `/fonts/${e.bold}` : null,
  }));
}

function uniqueId(manifest, baseId) {
  let id = baseId;
  let n = 2;
  while (findEntryById(manifest, id)) {
    id = `${baseId}-${n}`;
    n += 1;
  }
  return id;
}

function uniqueFamily(manifest, family) {
  let name = family;
  let n = 2;
  while (findEntryByFamily(manifest, name)) {
    name = `${family} (${n})`;
    n += 1;
  }
  return name;
}

/**
 * Import a .ttf/.otf/.ttc into fonts/ and update manifest.json.
 * @param {{ originalname: string, path: string }} file multer temp file
 * @param {{ family?: string, variant?: 'regular'|'bold', entryId?: string }} opts
 */
export async function importFontFile(file, opts = {}) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!isFontExtension(ext)) {
    throw new Error('Only TrueType (.ttf) and OpenType (.otf, .ttc) fonts are allowed');
  }

  const manifest = await readManifest();
  const variant = opts.variant === 'bold' ? 'bold' : 'regular';
  const stem = path.basename(file.originalname, ext);

  if (variant === 'bold' && opts.entryId) {
    const entry = findEntryById(manifest, opts.entryId);
    if (!entry) throw new Error('Font entry not found');
    const boldName = `${entry.id}-bold${ext}`;
    await fs.copyFile(file.path, fontFilePath(boldName));
    entry.bold = boldName;
    await writeManifest(manifest);
    return { entry, created: false };
  }

  const family = uniqueFamily(
    manifest,
    (opts.family && String(opts.family).trim()) || humanizeFilename(stem),
  );
  const id = uniqueId(manifest, slugFromName(family));
  const regularName = `${id}${ext}`;
  await fs.copyFile(file.path, fontFilePath(regularName));

  const entry = { id, family, regular: regularName, bold: null };
  manifest.entries.push(entry);
  await writeManifest(manifest);
  return { entry, created: true };
}
