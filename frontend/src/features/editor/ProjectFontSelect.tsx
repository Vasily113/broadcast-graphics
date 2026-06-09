import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  fetchFontCatalog,
  getCachedFontCatalog,
  importFontFile,
  type ProjectFontEntry,
} from '../../core/fonts';

type Props = {
  value: string;
  onChange: (family: string) => void;
  className?: string;
};

export function ProjectFontSelect({ value, onChange, className = '' }: Props) {
  const [fonts, setFonts] = useState<ProjectFontEntry[]>(getCachedFontCatalog);
  const [loading, setLoading] = useState(!fonts.length);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchFontCatalog();
      setFonts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить шрифты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fonts.length) refresh();
  }, [fonts.length, refresh]);

  const onImportClick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['ttf', 'otf', 'ttc'].includes(ext)) {
      setError('Поддерживаются только .ttf, .otf и .ttc');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      const family = window.prompt('Название шрифта в проекте', name || 'Font')?.trim();
      const font = await importFontFile(file, family || undefined);
      setFonts((prev) => (prev.some((f) => f.id === font.id) ? prev : [...prev, font]));
      onChange(font.family);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Импорт не удался');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={`flex items-center gap-1 flex-1 min-w-0 ${className}`}>
      <select
        value={fonts.some((f) => f.family === value) ? value : value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
        style={{ fontFamily: value || 'inherit' }}
        disabled={loading && !fonts.length}
      >
        {value && !fonts.some((f) => f.family === value) && (
          <option value={value}>{value} (не в проекте)</option>
        )}
        {fonts.length === 0 && <option value="">— импортируйте шрифт —</option>}
        {fonts.map((f) => (
          <option key={f.id} value={f.family}>{f.family}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onImportClick}
        disabled={importing}
        title="Импорт шрифта (.ttf / .otf)"
        className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-white hover:bg-surface-700 disabled:opacity-50"
      >
        <Upload size={14} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf,.ttc,font/ttf,font/otf"
        className="hidden"
        onChange={onFile}
      />
      {error && <span className="text-[10px] text-red-400 truncate max-w-[80px]" title={error}>!</span>}
    </div>
  );
}
