import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { useEditorStore, selectIsDirty } from '../../core/store';
import { toast } from '../../ui/toast';
import {
  MousePointer2, Type, Square, Image, Clock, Film, Undo2, Redo2, Save, ArrowLeft, Download,
  AlignLeft, AlignCenter, AlignRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  Grid2x2,
} from 'lucide-react';
import { NumericInput } from './NumericInput';

export function EditorToolbar({ templateId }: { templateId: string }) {
  const { tool, setTool, template, markSaved, setTemplateName, selectedLayerIds, alignLayers, snapToGrid, gridSize, setSnapToGrid, setGridSize } = useEditorStore();
  const isDirty = useEditorStore(selectIsDirty);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const { undo, redo, pastStates, futureStates } = useStore(useEditorStore.temporal);
  const navigate = useNavigate();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${template.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const save = async () => {
    await fetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: template.name, data: template }),
    });
    markSaved();
    toast('Сохранено!');
  };

  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Выбор (V)' },
    { id: 'text',   icon: Type,          label: 'Текст (T)' },
    { id: 'rect',   icon: Square,        label: 'Прямоугольник (R)' },
    { id: 'image',  icon: Image,         label: 'Изображение (I)' },
    { id: 'clock',  icon: Clock,         label: 'Часы/Таймер (K)' },
    { id: 'video',  icon: Film,          label: 'Видео (F)' },
  ] as const;

  return (
    <div className="h-12 bg-surface-800 border-b border-surface-700 flex items-center px-3 gap-2 flex-shrink-0">
      <button onClick={() => navigate('/templates')} className="p-1.5 hover:bg-surface-700 rounded text-gray-400">
        <ArrowLeft size={16} />
      </button>
      <div className="w-px h-5 bg-surface-600 mx-1" />

      {tools.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          title={label}
          onClick={() => setTool(id as any)}
          className={`p-1.5 rounded transition-colors ${tool === id ? 'bg-accent-500 text-white' : 'hover:bg-surface-700 text-gray-400'}`}
        >
          <Icon size={16} />
        </button>
      ))}

      <div className="w-px h-5 bg-surface-600 mx-1" />

      <button
        onClick={() => undo()}
        disabled={pastStates.length === 0}
        className="p-1.5 hover:bg-surface-700 rounded text-gray-400 disabled:opacity-30"
        title="Отменить (Ctrl+Z)"
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={() => redo()}
        disabled={futureStates.length === 0}
        className="p-1.5 hover:bg-surface-700 rounded text-gray-400 disabled:opacity-30"
        title="Повторить (Ctrl+Y)"
      >
        <Redo2 size={16} />
      </button>

      {selectedLayerIds.length >= 2 && (
        <>
          <div className="w-px h-5 bg-surface-600 mx-1" />
          {([
            { type: 'left',       icon: AlignLeft,                        title: 'По левому краю' },
            { type: 'hcenter',    icon: AlignCenter,                      title: 'По горизонтальному центру' },
            { type: 'right',      icon: AlignRight,                       title: 'По правому краю' },
            { type: 'hdistribute',icon: AlignHorizontalDistributeCenter,  title: 'Распределить по горизонтали' },
            { type: 'top',        icon: AlignStartVertical,               title: 'По верхнему краю' },
            { type: 'vcenter',    icon: AlignCenterVertical,              title: 'По вертикальному центру' },
            { type: 'bottom',     icon: AlignEndVertical,                 title: 'По нижнему краю' },
            { type: 'vdistribute',icon: AlignVerticalDistributeCenter,    title: 'Распределить по вертикали' },
          ] as const).map(({ type, icon: Icon, title }) => (
            <button
              key={type}
              onClick={() => alignLayers(type)}
              title={title}
              className="p-1.5 hover:bg-surface-700 rounded text-gray-400 hover:text-white transition-colors"
            >
              <Icon size={15} />
            </button>
          ))}
        </>
      )}

      <div className="flex-1 flex justify-center">
        {editingName ? (
          <input
            ref={nameRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { if (nameDraft.trim()) setTemplateName(nameDraft.trim()); setEditingName(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { if (nameDraft.trim()) setTemplateName(nameDraft.trim()); setEditingName(false); }
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="bg-surface-700 border border-accent-500 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none w-48"
          />
        ) : (
          <button
            onDoubleClick={() => { setNameDraft(template.name); setEditingName(true); setTimeout(() => nameRef.current?.select(), 0); }}
            className="text-sm text-gray-400 font-medium hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-surface-700"
            title="Двойной клик для переименования"
          >
            {template.name}
          </button>
        )}
      </div>

      {/* Snap to grid */}
      <button
        onClick={() => setSnapToGrid(!snapToGrid)}
        title={snapToGrid ? 'Сетка вкл. (Shift = отключить при перетаскивании)' : 'Включить привязку к сетке'}
        className={`p-1.5 rounded transition-colors ${snapToGrid ? 'bg-accent-500/30 text-accent-400' : 'hover:bg-surface-700 text-gray-400'}`}
      >
        <Grid2x2 size={15} />
      </button>
      {snapToGrid && (
        <NumericInput
          value={gridSize}
          min={4}
          max={200}
          onChange={(v) => setGridSize(Math.round(v))}
          className="w-12 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white text-center focus:outline-none focus:border-accent-500 cursor-ew-resize"
          title="Размер ячейки сетки (px)"
        />
      )}

      <div className="w-px h-5 bg-surface-600 mx-1" />
      <button
        onClick={exportJson}
        className="p-1.5 hover:bg-surface-700 rounded text-gray-400 transition-colors"
        title="Экспортировать JSON"
      >
        <Download size={16} />
      </button>
      <button
        onClick={save}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded text-sm font-medium transition-colors relative"
        title={isDirty ? 'Есть несохранённые изменения' : 'Сохранено'}
      >
        <Save size={14} /> Сохранить
        {isDirty && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full" />
        )}
      </button>
    </div>
  );
}