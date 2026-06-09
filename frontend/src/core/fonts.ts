/** Project font catalog — same files/manifest as playoutd (fonts/ + manifest.json). */

export type ProjectFontEntry = {
  id: string;
  family: string;
  regularUrl: string;
  boldUrl: string | null;
};

const SYSTEM_FONTS = new Set([
  'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman',
  'Courier New', 'sans-serif', 'serif', 'monospace',
]);

let catalogCache: ProjectFontEntry[] | null = null;
const injectedFamilies = new Set<string>();

export function isSystemFontFamily(family: string): boolean {
  return SYSTEM_FONTS.has(family);
}

export async function fetchFontCatalog(): Promise<ProjectFontEntry[]> {
  const res = await fetch('/api/fonts');
  if (!res.ok) throw new Error('Failed to load fonts');
  const data = await res.json();
  catalogCache = data.fonts ?? [];
  return catalogCache;
}

export function getCachedFontCatalog(): ProjectFontEntry[] {
  return catalogCache ?? [];
}

export function getDefaultProjectFontFamily(): string {
  const first = catalogCache?.[0];
  return first?.family ?? 'Arial';
}

function injectFontFace(family: string, url: string, weight: number) {
  const id = `bg-font-${slugForCss(family)}-${weight}`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `@font-face{font-family:${cssQuote(family)};src:url(${cssQuote(url)});font-weight:${weight};font-style:normal;font-display:swap;}`;
  document.head.appendChild(style);
}

function slugForCss(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

function cssQuote(s: string) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function entryForFamily(family: string): ProjectFontEntry | undefined {
  const want = family.trim().toLowerCase();
  return catalogCache?.find((e) => e.family.trim().toLowerCase() === want);
}

/** Load @font-face for project fonts used in a template (editor + DeckLink renderer). */
export async function ensureProjectFonts(families: string[]): Promise<boolean> {
  if (!catalogCache) {
    try { await fetchFontCatalog(); } catch { return false; }
  }
  const unique = [...new Set(families.filter(Boolean))];
  let added = false;
  for (const family of unique) {
    if (isSystemFontFamily(family) || injectedFamilies.has(family)) continue;
    const entry = entryForFamily(family);
    if (!entry) continue;
    injectFontFace(entry.family, entry.regularUrl, 400);
    if (entry.boldUrl) injectFontFace(entry.family, entry.boldUrl, 700);
    injectedFamilies.add(family);
    added = true;
  }
  if (!added) return false;
  await Promise.all(
    unique.map((f) => document.fonts.load(`16px ${cssQuote(f)}`).catch(() => {})),
  );
  return true;
}

export async function importFontFile(
  file: File,
  family?: string,
): Promise<ProjectFontEntry> {
  const body = new FormData();
  body.append('file', file);
  if (family?.trim()) body.append('family', family.trim());
  const res = await fetch('/api/fonts/import', { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Import failed');
  const font = data.font as ProjectFontEntry;
  if (catalogCache) catalogCache.push(font);
  else catalogCache = [font];
  injectFontFace(font.family, font.regularUrl, 400);
  if (font.boldUrl) injectFontFace(font.family, font.boldUrl, 700);
  injectedFamilies.add(font.family);
  await document.fonts.load(`16px ${cssQuote(font.family)}`).catch(() => {});
  return font;
}
