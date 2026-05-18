import { useCallback, useRef, useState } from 'react';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Type, Square, Image, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { Layer } from '../../core/schema';

function LayerIcon({ type }: { type: string }) {
  if (type === 'text') return <Type size={11} />;
  if (type === 'rect') return <Square size={11} />;
  if (type === 'image') return <Image size={11} />;
  return null;
}

function SortableLayer({ layer, isSelected, onSelect, onToggleVisible, onToggleLock, onDelete, onRename }: {
  layer: Layer;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    disabled: layer.locked,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(layer.name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commit = () => {
    const name = draft.trim();
    if (name && name !== layer.name) onRename(layer.id, name);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      onClick={(e) => !editing && !layer.locked && onSelect(layer.id, e.shiftKey)}
      className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer group text-xs border-l-2 ${
        isSelected
          ? 'bg-accent-500/20 border-accent-500'
          : 'hover:bg-surface-700 border-transparent'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={11} />
      </div>

      <span className={`flex-shrink-0 ${isSelected ? 'text-accent-400' : 'text-gray-500'}`}>
        <LayerIcon type={layer.type} />
      </span>

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-surface-600 text-white rounded px-1 outline-none"
          style={{ fontSize: 11 }}
        />
      ) : (
        <span
          className={`flex-1 truncate ${isSelected ? 'text-white' : 'text-gray-300'}`}
          onDoubleClick={startEdit}
        >
          {layer.name}
        </span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id, !layer.visible); }}
        className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-gray-500 hover:text-white transition-opacity"
        title={layer.visible ? 'Скрыть' : 'Показать'}
      >
        {layer.visible ? <Eye size={11} /> : <EyeOff size={11} className="text-gray-600" />}
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id, !layer.locked); }}
        className={`flex-shrink-0 transition-opacity ${layer.locked ? 'opacity-100 text-yellow-500' : 'opacity-0 group-hover:opacity-100 text-gray-500 hover:text-yellow-400'}`}
        title={layer.locked ? 'Разблокировать' : 'Заблокировать'}
      >
        {layer.locked ? <Lock size={11} /> : <LockOpen size={11} />}
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); if (!layer.locked) onDelete(layer.id); }}
        className={`flex-shrink-0 transition-opacity ${layer.locked ? 'opacity-20 cursor-not-allowed' : 'opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400'}`}
        title="Удалить слой"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

export function LayersPanel() {
  const { template, selectedLayerIds, selectLayer, updateLayer, deleteLayer, reorderLayers } = useEditorStore();

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = template.layers.findIndex((l) => l.id === active.id);
    const to = template.layers.findIndex((l) => l.id === over.id);
    if (from !== -1 && to !== -1) reorderLayers(from, to);
  }, [template.layers, reorderLayers]);

  return (
    <div className="w-48 flex-shrink-0 border-r border-surface-700 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide flex-shrink-0">
        Слои
      </div>

      <div className="flex-1 overflow-y-auto">
        {template.layers.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-xs">Нет слоёв</div>
        ) : (
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={template.layers.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              {template.layers.map((layer) => (
                <SortableLayer
                  key={layer.id}
                  layer={layer}
                  isSelected={selectedLayerIds.includes(layer.id)}
                  onSelect={selectLayer}
                  onToggleVisible={(id, visible) => updateLayer(id, { visible } as any)}
                  onToggleLock={(id, locked) => updateLayer(id, { locked } as any)}
                  onDelete={deleteLayer}
                  onRename={(id, name) => updateLayer(id, { name } as any)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
