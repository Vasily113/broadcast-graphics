import { useEffect, useRef, useState } from 'react';
import { useParams, useBlocker } from 'react-router-dom';
import { useStore } from 'zustand';
import { EditorToolbar } from '../features/editor/EditorToolbar';
import { LayersPanel } from '../features/editor/LayersPanel';
import { CanvasArea } from '../features/editor/CanvasArea';
import { PropertiesPanel } from '../features/editor/PropertiesPanel';
import { VariablesPanel } from '../features/editor/VariablesPanel';
import { AnimationPanel } from '../features/editor/AnimationPanel';
import { useEditorStore, selectIsDirty } from '../core/store';
import { toast } from '../ui/toast';
import { Layer } from '../core/schema';

// ── Shortcuts overlay ─────────────────────────────────────────────────────────

const SHORTCUT_GROUPS = [
  {
    title: 'Инструменты',
    items: [
      { keys: ['V'], desc: 'Выделение' },
      { keys: ['T'], desc: 'Текст' },
      { keys: ['R'], desc: 'Прямоугольник' },
      { keys: ['I'], desc: 'Изображение' },
      { keys: ['F'], desc: 'Видео' },
    ],
  },
  {
    title: 'Слои',
    items: [
      { keys: ['Del'], desc: 'Удалить слой' },
      { keys: ['Ctrl', 'D'], desc: 'Дублировать' },
      { keys: ['Ctrl', 'C'], desc: 'Копировать' },
      { keys: ['Ctrl', 'V'], desc: 'Вставить' },
      { keys: ['Ctrl', '['], desc: 'Опустить вниз (Z-порядок)' },
      { keys: ['Ctrl', ']'], desc: 'Поднять вверх (Z-порядок)' },
      { keys: ['Esc'], desc: 'Снять выделение' },
    ],
  },
  {
    title: 'Позиция',
    items: [
      { keys: ['↑↓←→'], desc: 'Сдвинуть на 1 px' },
      { keys: ['Shift', '↑↓←→'], desc: 'Сдвинуть на 10 px' },
    ],
  },
  {
    title: 'Трансформации',
    items: [
      { keys: ['Shift', '+ресайз'], desc: 'Сохранить пропорции' },
      { keys: ['Shift', '+вращение'], desc: 'Шаг 15°' },
      { keys: ['Двойной клик'], desc: 'Редактировать текст' },
    ],
  },
  {
    title: 'Файл',
    items: [
      { keys: ['Ctrl', 'S'], desc: 'Сохранить' },
      { keys: ['Ctrl', 'Z'], desc: 'Отменить' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Повторить' },
    ],
  },
  {
    title: 'Вид',
    items: [
      { keys: ['Ctrl', 'Колесо'], desc: 'Зум' },
      { keys: ['?'], desc: 'Горячие клавиши' },
    ],
  },
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#1a1a2e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '28px 32px', width: 560, maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#fff', margin: 0 }}>Горячие клавиши</h2>
          <button onClick={onClose} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px' }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{group.title}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.items.map((item) => (
                  <div key={item.desc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>{item.desc}</span>
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                      {item.keys.map((k) => (
                        <kbd key={k} style={{
                          display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                          background: '#252540', border: '1px solid #3a3a5c',
                          fontSize: 11, color: '#e5e7eb', fontFamily: 'monospace', lineHeight: '18px',
                        }}>{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 20, fontSize: 11, color: '#4b5563', textAlign: 'center' }}>Нажмите <kbd style={{ padding: '1px 5px', borderRadius: 3, background: '#252540', border: '1px solid #3a3a5c', fontSize: 11, color: '#9ca3af' }}>?</kbd> или <kbd style={{ padding: '1px 5px', borderRadius: 3, background: '#252540', border: '1px solid #3a3a5c', fontSize: 11, color: '#9ca3af' }}>Esc</kbd> чтобы закрыть</p>
      </div>
    </div>
  );
}

// Module-level clipboard — не нужно в store/undo
let layerClipboard: Layer[] = [];

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const setTemplate = useEditorStore((s) => s.setTemplate);
  const setTool = useEditorStore((s) => s.setTool);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const addLayers = useEditorStore((s) => s.addLayers);
  const markSaved = useEditorStore((s) => s.markSaved);
  const isDirty = useEditorStore(selectIsDirty);
  const { undo, redo } = useStore(useEditorStore.temporal);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const blocker = useBlocker(isDirty);

  // Храним id в ref чтобы хендлер клавиш всегда видел актуальное значение
  const idRef = useRef(id);
  useEffect(() => { idRef.current = id; }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/templates/${id}`)
      .then((r) => r.json())
      .then((t) => setTemplate(t.data));
  }, [id]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            if (!isInput) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
            break;
          case 'y':
            if (!isInput) { e.preventDefault(); redo(); }
            break;
          case 's': {
            e.preventDefault();
            const { template } = useEditorStore.getState();
            const tid = idRef.current;
            if (!tid) break;
            await fetch(`/api/templates/${tid}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: template.name, data: template }),
            });
            markSaved();
            toast('Сохранено!');
            break;
          }
          case 'c':
            if (!isInput) {
              const { selectedLayerIds, template } = useEditorStore.getState();
              layerClipboard = template.layers.filter((l) => selectedLayerIds.includes(l.id));
            }
            break;
          case 'v':
            if (!isInput && layerClipboard.length > 0) {
              e.preventDefault();
              const copies = layerClipboard.map((l) => ({
                ...l,
                id: crypto.randomUUID(),
                name: `${l.name} (копия)`,
                transform: { ...l.transform, x: l.transform.x + 20, y: l.transform.y + 20 },
              }));
              addLayers(copies);
              // Выделяем вставленные слои
              copies.forEach((l, i) => selectLayer(l.id, i > 0));
            }
            break;
          case 'd':
            if (!isInput) {
              e.preventDefault();
              const { selectedLayerIds, template } = useEditorStore.getState();
              const dupes = template.layers
                .filter((l) => selectedLayerIds.includes(l.id))
                .map((l) => ({
                  ...l,
                  id: crypto.randomUUID(),
                  name: `${l.name} (копия)`,
                  transform: { ...l.transform, x: l.transform.x + 20, y: l.transform.y + 20 },
                }));
              if (dupes.length > 0) {
                addLayers(dupes);
                dupes.forEach((l, i) => selectLayer(l.id, i > 0));
              }
            }
            break;
        }
        return;
      }

      // Z-order: Ctrl+[ / Ctrl+] (allowed even in inputs they don't conflict)
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const { selectedLayerIds, shiftLayerOrder } = useEditorStore.getState();
        selectedLayerIds.forEach((lid) => shiftLayerOrder(lid, e.key === '[' ? 'down' : 'up'));
        return;
      }

      if (isInput) return;

      switch (e.key.toLowerCase()) {
        case '?': setShowShortcuts((v) => !v); return;
        case 'escape':
          setShowShortcuts((v) => { if (v) return false; selectLayer(null); return false; });
          return;
        case 'v': setTool('select'); break;
        case 't': setTool('text'); break;
        case 'r': setTool('rect'); break;
        case 'i': setTool('image'); break;
        case 'k': setTool('clock'); break;
        case 'f': setTool('video'); break;
        case 'delete':
        case 'backspace': {
          const { selectedLayerIds, template } = useEditorStore.getState();
          selectedLayerIds.forEach((lid) => {
            const layer = template.layers.find((l) => l.id === lid);
            if (layer && !layer.locked) deleteLayer(lid);
          });
          break;
        }
        case 'arrowup':
        case 'arrowdown':
        case 'arrowleft':
        case 'arrowright': {
          e.preventDefault();
          const delta = e.shiftKey ? 10 : 1;
          const { selectedLayerIds, template, updateLayer } = useEditorStore.getState();
          const dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
          const dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0;
          selectedLayerIds.forEach((lid) => {
            const layer = template.layers.find((l) => l.id === lid);
            if (!layer || layer.locked) return;
            updateLayer(lid, { transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy } });
          });
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setTool, deleteLayer, selectLayer, addLayers, markSaved, undo, redo]);

  return (
    <div className="h-screen flex flex-col bg-surface-900 overflow-hidden">
      <EditorToolbar templateId={id!} />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <LayersPanel />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <CanvasArea />
          <AnimationPanel />
        </div>
        <div className="flex flex-col w-64 border-l border-surface-700 flex-shrink-0">
          <PropertiesPanel />
          <VariablesPanel />
        </div>
      </div>

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {blocker.state === 'blocked' && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => blocker.reset()}
        >
          <div
            style={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '24px 28px', width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Есть несохранённые изменения</p>
              <p style={{ fontSize: 13, color: '#9ca3af' }}>Покинуть страницу? Изменения будут потеряны.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => blocker.reset()}
                style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, background: '#2a2a2a', color: '#d1d5db', border: '1px solid #3a3a3a', cursor: 'pointer' }}
              >
                Остаться
              </button>
              <button
                onClick={() => blocker.proceed()}
                style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Покинуть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
