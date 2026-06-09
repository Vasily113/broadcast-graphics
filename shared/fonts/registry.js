/** Shared font manifest helpers (editor backend + playoutd read the same manifest.json). */

export const FONTS_MANIFEST_VERSION = 1;

export const FONT_FILE_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc']);

export function emptyManifest() {
  return { version: FONTS_MANIFEST_VERSION, entries: [] };
}

export function slugFromName(name) {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'font';
}

export function humanizeFilename(stem) {
  return String(stem || 'Font')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isFontExtension(ext) {
  return FONT_FILE_EXTENSIONS.has(String(ext || '').toLowerCase());
}

export function normalizeManifest(data) {
  if (!data || typeof data !== 'object') return emptyManifest();
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return {
    version: FONTS_MANIFEST_VERSION,
    entries: entries
      .filter((e) => e && typeof e === 'object' && e.id && e.family && e.regular)
      .map((e) => ({
        id: String(e.id),
        family: String(e.family),
        regular: String(e.regular),
        bold: e.bold ? String(e.bold) : null,
      })),
  };
}

export function findEntryByFamily(manifest, family) {
  const want = String(family || '').trim().toLowerCase();
  if (!want) return null;
  return manifest.entries.find((e) => e.family.trim().toLowerCase() === want) ?? null;
}

export function findEntryById(manifest, id) {
  return manifest.entries.find((e) => e.id === id) ?? null;
}
