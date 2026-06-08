import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  useDraggable,
  useDroppable,
  pointerWithin,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Type, Square, Image, Eye, EyeOff, Lock, LockOpen, Trash2, Folder, FolderPlus } from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { Layer, LayerGroup, RootStackEntry } from '../../core/schema';
import { normalizeStack } from '../../core/stackOrder';

const ROW_PAD_BASE = 24;
const INDENT_STEP = 12;

type ItemKind = 'layer' | 'group';

interface DropHint {
  type: 'insert' | 'into';
  parentId: string | null;
  index: number;
  groupId?: string;
}

function itemId(kind: ItemKind, id: string): string {
  return `item:${kind}:${id}`;
}

function parseItemId(id: string): { kind: ItemKind; id: string } | null {
  if (id.startsWith('item:layer:')) return { kind: 'layer', id: id.slice(11) };
  if (id.startsWith('item:group:')) return { kind: 'group', id: id.slice(11) };
  return null;
}

function insertDropId(parentId: string | null, index: number): string {
  return `drop:insert:${parentId ?? 'root'}:${index}`;
}

function parseDropId(id: string): DropHint | null {
  if (id.startsWith('drop:into:')) {
    const groupId = id.slice(10);
    return { type: 'into', parentId: groupId, index: 0, groupId };
  }
  if (id.startsWith('drop:insert:')) {
    const [, , parentRaw, indexRaw] = id.split(':');
    const index = Number(indexRaw);
    if (!Number.isFinite(index)) return null;
    return {
      type: 'insert',
      parentId: parentRaw === 'root' ? null : parentRaw,
      index,
    };
  }
  return null;
}

function rowPadding(indent: number): number {
  return ROW_PAD_BASE + indent * INDENT_STEP;
}

function LayerIcon({ type }: { type: string }) {
  if (type === 'text') return <Type size={11} />;
  if (type === 'rect') return <Square size={11} />;
  if (type === 'image') return <Image size={11} />;
  return null;
}

function InsertDropZone({
  parentId,
  index,
  active,
}: {
  parentId: string | null;
  index: number;
  active: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: insertDropId(parentId, index) });
  return (
    <div ref={setNodeRef} className="absolute left-0 top-0 bottom-0 w-[48%] z-10">
      {active && <div className="absolute left-2 right-1 top-0 h-0.5 bg-accent-400 rounded-full shadow-[0_0_6px_rgba(99,102,241,0.9)]" />}
    </div>
  );
}

function GroupDropZone({ groupId, active }: { groupId: string; active: boolean }) {
  const { setNodeRef } = useDroppable({ id: `drop:into:${groupId}` });
  return (
    <div
      ref={setNodeRef}
      className={`absolute right-0 top-0 bottom-0 w-[52%] z-10 rounded-sm ${active ? 'bg-amber-500/20 ring-1 ring-amber-400/70' : ''}`}
    />
  );
}

function DraggableRow({
  kind,
  id,
  disabled,
  children,
}: {
  kind: ItemKind;
  id: string;
  disabled?: boolean;
  children: (drag: ReturnType<typeof useDraggable>) => ReactNode;
}) {
  const drag = useDraggable({ id: itemId(kind, id), disabled });
  return <>{children(drag)}</>;
}

function SortableLayerRow({
  layer,
  parentId,
  index,
  indent,
  activeHint,
  isSelected,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onDelete,
}: {
  layer: Layer;
  parentId: string | null;
  index: number;
  indent: number;
  activeHint: DropHint | null;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const insertActive =
    activeHint?.type === 'insert' && activeHint.parentId === parentId && activeHint.index === index;

  return (
    <DraggableRow kind="layer" id={layer.id} disabled={layer.locked}>
      {({ attributes, listeners, setNodeRef, transform, isDragging }) => (
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Translate.toString(transform),
            opacity: isDragging ? 0.4 : 1,
            paddingLeft: rowPadding(indent),
          }}
          onClick={(e) => !layer.locked && onSelect(layer.id, e.shiftKey)}
          className={`relative flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer group text-xs border-l-2 ${
            isSelected ? 'bg-accent-500/20 border-accent-500' : 'hover:bg-surface-700 border-transparent'
          }`}
        >
          <InsertDropZone parentId={parentId} index={index} active={insertActive} />
          <div {...attributes} {...listeners} className="relative z-20 text-gray-600 hover:text-gray-400 cursor-grab flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <GripVertical size={11} />
          </div>
          <span className={`relative z-20 flex-shrink-0 ${isSelected ? 'text-accent-400' : 'text-gray-500'}`}><LayerIcon type={layer.type} /></span>
          <span className={`relative z-20 flex-1 truncate ${isSelected ? 'text-white' : 'text-gray-300'}`}>{layer.name}</span>
          <button onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id, !layer.visible); }} className="relative z-20 opacity-0 group-hover:opacity-100 text-gray-500">
            {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id, !layer.locked); }} className={`relative z-20 ${layer.locked ? 'text-yellow-500' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
            {layer.locked ? <Lock size={11} /> : <LockOpen size={11} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); if (!layer.locked) onDelete(layer.id); }} className="relative z-20 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400">
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </DraggableRow>
  );
}

function GroupRow({
  group,
  parentId,
  index,
  indent,
  activeHint,
  isSelected,
  onSelect,
  onDelete,
  onToggleVisible,
  onToggleLock,
  onRename,
}: {
  group: LayerGroup;
  parentId: string | null;
  index: number;
  indent: number;
  activeHint: DropHint | null;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onDelete: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const insertActive =
    activeHint?.type === 'insert' && activeHint.parentId === parentId && activeHint.index === index;
  const intoActive = activeHint?.type === 'into' && activeHint.groupId === group.id;

  const commitRename = () => {
    const name = draftName.trim() || group.name;
    onRename(group.id, name);
    setDraftName(name);
    setRenaming(false);
  };

  return (
    <DraggableRow kind="group" id={group.id} disabled={group.locked}>
      {({ attributes, listeners, setNodeRef, transform, isDragging }) => (
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Translate.toString(transform),
            opacity: isDragging ? 0.4 : 1,
            paddingLeft: rowPadding(indent),
          }}
          onClick={(e) => onSelect(group.id, e.shiftKey)}
          className={`relative flex items-center gap-1.5 pr-2 py-1.5 text-xs cursor-pointer group border-l-2 ${
            isSelected ? 'bg-amber-500/15 border-amber-500' : 'hover:bg-surface-700 border-transparent'
          } ${intoActive ? 'bg-amber-500/15 ring-1 ring-amber-400/60' : ''}`}
        >
          <InsertDropZone parentId={parentId} index={index} active={insertActive} />
          <GroupDropZone groupId={group.id} active={intoActive} />
          <div {...attributes} {...listeners} className="relative z-20 cursor-grab text-gray-600 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <GripVertical size={11} />
          </div>
          <Folder size={11} className="relative z-20 text-amber-500/80 flex-shrink-0" />
          {renaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setDraftName(group.name); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 flex-1 min-w-0 bg-surface-700 border border-accent-500/50 rounded px-1 py-0 text-gray-100 text-xs"
            />
          ) : (
            <span
              className="relative z-20 flex-1 truncate text-gray-200"
              onDoubleClick={(e) => { e.stopPropagation(); setDraftName(group.name); setRenaming(true); }}
              title="Двойной клик — переименовать"
            >
              {group.name}
            </span>
          )}
          <button onClick={(e) => { e.stopPropagation(); onToggleVisible(group.id, !group.visible); }} className="relative z-20 opacity-0 group-hover:opacity-100 text-gray-500">
            {group.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onToggleLock(group.id, !group.locked); }} className={`relative z-20 ${group.locked ? 'text-yellow-500' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
            {group.locked ? <Lock size={11} /> : <LockOpen size={11} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(group.id); }} className="relative z-20 opacity-0 group-hover:opacity-100 text-red-400">
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </DraggableRow>
  );
}

export function LayersPanel() {
  const {
    template,
    selectedLayerIds,
    selectedGroupIds,
    selectLayer,
    selectGroup,
    updateLayer,
    deleteLayer,
    addGroup,
    deleteGroup,
    updateGroup,
    moveTreeItem,
  } = useEditorStore();

  const groups = template.groups ?? [];
  const [activeHint, setActiveHint] = useState<DropHint | null>(null);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const layerById = useMemo(() => new Map(template.layers.map((l) => [l.id, l])), [template.layers]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id ? String(event.over.id) : '';
    setActiveHint(parseDropId(overId));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const active = parseItemId(String(event.active.id));
    const hint = event.over?.id ? parseDropId(String(event.over.id)) : null;
    setActiveHint(null);
    if (!active || !hint) return;

    if (hint.type === 'into') {
      moveTreeItem(active.kind, active.id, hint.groupId!, 0);
      return;
    }

    moveTreeItem(active.kind, active.id, hint.parentId, hint.index);
  }, [moveTreeItem]);

  const handleDragCancel = useCallback(() => setActiveHint(null), []);

  const renderStack = (parentId: string | null, indent: number): ReactNode[] => {
    const stack = normalizeStack(template, parentId);
    const nodes: React.ReactNode[] = [];

    stack.forEach((entry: RootStackEntry, index) => {
      if (entry.kind === 'group') {
        const group = groupById.get(entry.id);
        if (!group) return;
        nodes.push(
          <GroupRow
            key={`group-${group.id}`}
            group={group}
            parentId={parentId}
            index={index}
            indent={indent}
            activeHint={activeHint}
            isSelected={selectedGroupIds.includes(group.id)}
            onSelect={selectGroup}
            onDelete={deleteGroup}
            onToggleVisible={(id, visible) => updateGroup(id, { visible })}
            onToggleLock={(id, locked) => updateGroup(id, { locked })}
            onRename={(id, name) => updateGroup(id, { name })}
          />,
        );
        nodes.push(...renderStack(group.id, indent + 1));
        return;
      }

      const layer = layerById.get(entry.id);
      if (!layer) return;
      nodes.push(
        <SortableLayerRow
          key={`layer-${layer.id}`}
          layer={layer}
          parentId={parentId}
          index={index}
          indent={indent}
          activeHint={activeHint}
          isSelected={selectedLayerIds.includes(layer.id)}
          onSelect={selectLayer}
          onToggleVisible={(id, v) => updateLayer(id, { visible: v } as Partial<Layer>)}
          onToggleLock={(id, l) => updateLayer(id, { locked: l } as Partial<Layer>)}
          onDelete={deleteLayer}
        />,
      );
    });

    const endActive =
      activeHint?.type === 'insert' && activeHint.parentId === parentId && activeHint.index === stack.length;
    nodes.push(
      <div key={`end-${parentId ?? 'root'}`} className="relative h-3">
        <div className="absolute left-0 top-0 bottom-0 w-[48%]" ref={undefined}>
          <EndDropZone parentId={parentId} index={stack.length} active={endActive} indent={indent} />
        </div>
      </div>,
    );

    return nodes;
  };

  return (
    <div className="w-48 flex-shrink-0 border-r border-surface-700 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-surface-700 flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Дерево</span>
        <button type="button" onClick={() => addGroup()} title="Новая группа" className="p-1 rounded hover:bg-surface-700 text-gray-400 hover:text-white">
          <FolderPlus size={14} />
        </button>
      </div>

      <DndContext
        collisionDetection={pointerWithin}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full py-1">
            {renderStack(null, 0)}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function EndDropZone({
  parentId,
  index,
  active,
  indent,
}: {
  parentId: string | null;
  index: number;
  active: boolean;
  indent: number;
}) {
  const { setNodeRef } = useDroppable({ id: insertDropId(parentId, index) });
  return (
    <div
      ref={setNodeRef}
      className="absolute inset-0"
      style={{ marginLeft: rowPadding(indent) - ROW_PAD_BASE }}
    >
      {active && <div className="absolute left-2 right-1 top-1 h-0.5 bg-accent-400 rounded-full shadow-[0_0_6px_rgba(99,102,241,0.9)]" />}
    </div>
  );
}
