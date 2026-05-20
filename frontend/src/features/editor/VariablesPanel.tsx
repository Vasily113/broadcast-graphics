import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { Variable } from '../../core/schema';

const TYPE_LABELS: Record<Variable['type'], string> = {
  text:  'Текст',
  image: 'Изображение',
  number: 'Число',
  color: 'Цвет',
  video: 'Видео',
};

const TYPE_COLORS: Record<Variable['type'], string> = {
  text:  'text-blue-400',
  image: 'text-green-400',
  number: 'text-yellow-400',
  color: 'text-pink-400',
  video: 'text-purple-400',
};

const EMPTY_FORM: Partial<Variable> = { name: '', label: '', type: 'text', defaultValue: '' };

function VariableForm({
  initial,
  takenNames,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Partial<Variable>;
  takenNames: string[];
  submitLabel: string;
  onSubmit: (v: Partial<Variable>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<Variable>>(initial);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const name = form.name?.trim();
    if (!name) { setError('Введите имя переменной'); return; }
    if (takenNames.includes(name)) { setError('Имя уже занято'); return; }
    onSubmit({ ...form, name });
  };

  return (
    <div className="p-2 border-b border-surface-700 bg-surface-800 space-y-1.5">
      <input
        autoFocus
        type="text"
        placeholder="Имя переменной (name)"
        value={form.name}
        onChange={(e) => { setForm((s) => ({ ...s, name: e.target.value })); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
        className="w-full bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-500"
      />
      <input
        type="text"
        placeholder="Метка (label) — необязательно"
        value={form.label}
        onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
        className="w-full bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-500"
      />
      <div className="flex gap-1.5">
        <select
          value={form.type}
          onChange={(e) => setForm((s) => ({ ...s, type: e.target.value as Variable['type'] }))}
          className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-500"
        >
          {(Object.entries(TYPE_LABELS) as [Variable['type'], string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type={form.type === 'color' ? 'color' : form.type === 'number' ? 'number' : 'text'}
          placeholder="Значение по умолчанию"
          value={String(form.defaultValue ?? '')}
          onChange={(e) => setForm((s) => ({ ...s, defaultValue: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
          className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-500"
        />
      </div>
      {error && <p className="text-red-400 text-xs px-1">{error}</p>}
      <div className="flex gap-1.5">
        <button
          onClick={handleSubmit}
          disabled={!form.name?.trim()}
          className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded py-1 text-xs text-white transition-colors"
        >
          {submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-surface-700 hover:bg-surface-600 rounded py-1 text-xs text-gray-400 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

export function VariablesPanel() {
  const { template, addVariable, updateVariable, deleteVariable } = useEditorStore();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const takenNames = template.variables.map((v) => v.name);

  return (
    <div className="border-t border-surface-700 flex flex-col flex-shrink-0" style={{ maxHeight: '45%' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 border-b border-surface-700 flex items-center justify-between w-full hover:bg-surface-700/40 transition-colors"
      >
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          Переменные {template.variables.length > 0 && <span className="text-gray-600 normal-case">({template.variables.length})</span>}
        </span>
        <div className="flex items-center gap-1">
          {open && (
            <span
              className="text-gray-500 hover:text-white"
              onClick={(e) => { e.stopPropagation(); setAdding(true); setEditingId(null); }}
              title="Добавить переменную"
            >
              <Plus size={13} />
            </span>
          )}
          {open ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
        </div>
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto">
          {adding && (
            <VariableForm
              initial={EMPTY_FORM}
              takenNames={takenNames}
              submitLabel="Добавить"
              onSubmit={(form) => {
                addVariable({
                  id: crypto.randomUUID(),
                  name: form.name!,
                  label: form.label?.trim() || form.name!,
                  type: (form.type as Variable['type']) ?? 'text',
                  defaultValue: form.defaultValue ?? '',
                });
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}

          {template.variables.length === 0 && !adding ? (
            <div className="text-center py-6 text-gray-600 text-xs">
              <p>Нет переменных</p>
              <button
                onClick={() => setAdding(true)}
                className="mt-2 text-accent-400 hover:text-accent-300 transition-colors"
              >
                + Добавить
              </button>
            </div>
          ) : (
            template.variables.map((v) =>
              editingId === v.id ? (
                <VariableForm
                  key={v.id}
                  initial={{ name: v.name, label: v.label, type: v.type, defaultValue: v.defaultValue }}
                  takenNames={takenNames.filter((n) => n !== v.name)}
                  submitLabel="Сохранить"
                  onSubmit={(form) => {
                    updateVariable(v.id, {
                      name: form.name!,
                      label: form.label?.trim() || form.name!,
                      type: form.type as Variable['type'],
                      defaultValue: form.defaultValue ?? '',
                    });
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-700 group border-b border-surface-700/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium ${TYPE_COLORS[v.type]}`}>
                        {TYPE_LABELS[v.type][0]}
                      </span>
                      <span className="text-xs text-white truncate">{v.label || v.name}</span>
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {v.name}{v.defaultValue !== '' && v.defaultValue !== undefined ? ` = ${String(v.defaultValue)}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => { setEditingId(v.id); setAdding(false); }}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-gray-500 hover:text-white transition-opacity"
                    title="Редактировать"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => deleteVariable(v.id)}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-gray-500 hover:text-red-400 transition-opacity"
                    title="Удалить"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            )
          )}
        </div>
      )}
    </div>
  );
}
