import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Tv, Check, X, Copy, Upload } from 'lucide-react';
import { TemplateThumbnail } from '../features/templates/TemplateThumbnail';

interface TemplateItem { id: string; name: string; updated_at: number; }

export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('Новый шаблон');
  const inputRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const load = async () => {
    const r = await fetch('/api/templates');
    setTemplates(await r.json());
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (creating) setTimeout(() => { inputRef.current?.select(); }, 0);
  }, [creating]);

  const createNew = async () => {
    const name = newName.trim();
    if (!name) return;
    const defaultTemplate = {
      id: crypto.randomUUID(),
      name,
      canvas: { width: 1920, height: 1080, background: 'transparent' },
      variables: [], layers: [], tracks: [],
    };
    const r = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: defaultTemplate }),
    });
    const { id } = await r.json();
    navigate(`/editor/${id}`);
  };

  const remove = async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    setConfirmingId(null);
    load();
  };

  const importJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const name = data.name ?? file.name.replace(/\.json$/, '');
      const newData = { ...data, id: crypto.randomUUID() };
      await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: newData }),
      });
      load();
    } catch {
      alert('Ошибка импорта: неверный формат файла');
    } finally {
      e.target.value = '';
    }
  };

  const duplicate = async (t: TemplateItem) => {
    const r = await fetch(`/api/templates/${t.id}`);
    const { data } = (await r.json());
    const newData = { ...data, id: crypto.randomUUID(), name: `${t.name} (копия)` };
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newData.name, data: newData }),
    });
    load();
  };

  return (
    <div className="min-h-screen bg-surface-900 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Шаблоны графики</h1>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/control')}
              className="flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-sm transition-colors"
            >
              <Tv size={16} /> Control Panel
            </button>
            <button
              onClick={() => importRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-sm transition-colors"
              title="Импортировать шаблон из JSON"
            >
              <Upload size={16} /> Импорт
            </button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importJson} />
            {creating ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); createNew(); }}
              >
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
                  className="px-3 py-2 bg-surface-700 border border-accent-500 rounded-lg text-sm text-white focus:outline-none w-48"
                  placeholder="Название шаблона"
                />
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="p-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded-lg transition-colors"
                  title="Создать"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="p-2 bg-surface-700 hover:bg-surface-600 rounded-lg transition-colors text-gray-400"
                  title="Отмена"
                >
                  <X size={16} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setNewName('Новый шаблон'); setCreating(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus size={16} /> Новый шаблон
              </button>
            )}
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <p className="text-lg mb-2">Шаблонов пока нет</p>
            <p className="text-sm">Создайте первый шаблон</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="bg-surface-800 rounded-xl p-4 border border-surface-600 hover:border-accent-500 transition-colors group">
                <div className="aspect-video bg-surface-700 rounded-lg mb-3 overflow-hidden">
                  <TemplateThumbnail templateId={t.id} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1 mr-2">
                    <h3 className="font-medium text-white text-sm truncate">{t.name}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {new Date(t.updated_at * 1000).toLocaleDateString('ru-RU')}
                    </p>
                  </div>

                  {confirmingId === t.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-gray-400 mr-1">Удалить?</span>
                      <button
                        onClick={() => remove(t.id)}
                        className="p-1.5 bg-red-600 hover:bg-red-700 rounded transition-colors text-white"
                        title="Подтвердить"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="p-1.5 hover:bg-surface-600 rounded transition-colors text-gray-400"
                        title="Отмена"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => navigate(`/editor/${t.id}`)}
                        className="p-1.5 hover:bg-surface-600 rounded transition-colors"
                        title="Редактировать"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => duplicate(t)}
                        className="p-1.5 hover:bg-surface-600 rounded transition-colors text-gray-400"
                        title="Дублировать"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmingId(t.id)}
                        className="p-1.5 hover:bg-red-900 rounded transition-colors text-red-400"
                        title="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
