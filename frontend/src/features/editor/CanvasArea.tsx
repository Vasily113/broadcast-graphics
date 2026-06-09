import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../core/store';
import { TemplateRenderer } from '../../core/renderer';
import { getEditorDisplayTemplate } from '../../core/timeline';
import { Layer, createDefaultTransform, TextLayer, RectLayer, ImageLayer, ClockLayer, VideoLayer } from '../../core/schema';
import { fetchFontCatalog, getDefaultProjectFontFamily } from '../../core/fonts';

const textFill = (fill: TextLayer['style']['fill']): string =>
  typeof fill === 'string' ? fill : '#ffffff';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState   { id: string; startX: number; startY: number; origX: number; origY: number; }
interface ResizeState { id: string; handle: ResizeHandle; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number; }
interface RotateState { id: string; centerXScreen: number; centerYScreen: number; startAngle: number; origRotation: number; }

const HANDLES: { handle: ResizeHandle; style: React.CSSProperties; cursor: string }[] = [
  { handle: 'nw', style: { top: -5,              left: -5              }, cursor: 'nw-resize' },
  { handle: 'n',  style: { top: -5,              left: 'calc(50% - 4px)' }, cursor: 'n-resize'  },
  { handle: 'ne', style: { top: -5,              right: -5             }, cursor: 'ne-resize' },
  { handle: 'e',  style: { top: 'calc(50% - 4px)', right: -5           }, cursor: 'e-resize'  },
  { handle: 'se', style: { bottom: -5,           right: -5             }, cursor: 'se-resize' },
  { handle: 's',  style: { bottom: -5,           left: 'calc(50% - 4px)' }, cursor: 's-resize'  },
  { handle: 'sw', style: { bottom: -5,           left: -5              }, cursor: 'sw-resize' },
  { handle: 'w',  style: { top: 'calc(50% - 4px)', left: -5            }, cursor: 'w-resize'  },
];

const MIN_SIZE = 20;

export function CanvasArea() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TemplateRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    template, zoom, setZoom, tool, selectLayer, selectedLayerIds, addLayer, updateLayer,
    updateLayerTransform, snapToGrid, gridSize, timelineDirectorPlayheads,
  } = useEditorStore();
  const displayTemplate = useMemo(
    () => getEditorDisplayTemplate(template, timelineDirectorPlayheads),
    [template, timelineDirectorPlayheads],
  );
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [rotating, setRotating] = useState<RotateState | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const [defaultFontFamily, setDefaultFontFamily] = useState('Arial');
  useEffect(() => {
    fetchFontCatalog()
      .then(() => setDefaultFontFamily(getDefaultProjectFontFamily()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      const renderer = new TemplateRenderer(canvasRef.current, template.canvas.width, template.canvas.height);
      rendererRef.current = renderer;
      return () => { renderer.destroy(); rendererRef.current = null; };
    } catch (e) {
      console.error('PixiJS renderer failed to initialize:', e);
      setRendererError(true);
    }
  }, []);

  useEffect(() => {
    rendererRef.current?.resize(template.canvas.width, template.canvas.height);
  }, [template.canvas.width, template.canvas.height]);

  useEffect(() => {
    try {
      const preview = getEditorDisplayTemplate(template, timelineDirectorPlayheads);
      rendererRef.current?.syncTemplate(preview);
    } catch (e) {
      console.error('syncTemplate failed:', e);
    }
  }, [template, timelineDirectorPlayheads]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.min(2, Math.max(0.1, Math.round((zoomRef.current + delta) * 10) / 10));
      setZoom(next);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [setZoom]);

  const canvasWidth = template.canvas.width * zoom;
  const canvasHeight = template.canvas.height * zoom;

  const handleCanvasDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropTarget(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / zoom);
    const y = Math.round((e.clientY - rect.top) / zoom);

    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      const { url } = await r.json();

      const id = crypto.randomUUID();
      const layer: ImageLayer = {
        id, name: file.name.replace(/\.[^.]+$/, ''), type: 'image',
        visible: true, locked: false, opacity: 1, blendMode: 'normal', groupId: null,
        transform: { ...createDefaultTransform(x, y), width: 300, height: 200 },
        src: url, cornerRadius: 0, fit: 'stretch',
      };
      addLayer(layer);
      selectLayer(id);
    } catch (err) {
      console.error('Drop upload failed:', err);
    }
  }, [zoom, addLayer, selectLayer]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (tool === 'select') {
      selectLayer(null);
      return;
    }
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / zoom);
    const y = Math.round((e.clientY - rect.top) / zoom);

    const id = crypto.randomUUID();
    let layer: Layer;

    if (tool === 'text') {
      layer = {
        id, name: 'Текст', type: 'text', visible: true, locked: false, opacity: 1, blendMode: 'normal', groupId: null,
        transform: { ...createDefaultTransform(x, y), width: 300, height: 80 },
        content: 'Текст',
        style: {
          fontFamily: defaultFontFamily, fontSize: 48, fontWeight: 'normal', fill: '#ffffff',
          align: 'left', lineHeight: 1.2, letterSpacing: 0,
          strokeColor: '#000000', strokeWidth: 0,
          dropShadow: false, dropShadowBlur: 4, dropShadowColor: '#000000', dropShadowDistance: 4,
        },
      } as TextLayer;
    } else if (tool === 'rect') {
      layer = {
        id, name: 'Прямоугольник', type: 'rect', visible: true, locked: false, opacity: 1, blendMode: 'normal', groupId: null,
        transform: { ...createDefaultTransform(x, y), width: 300, height: 80 },
        fill: '#3a3a3a', cornerRadius: 0, borderColor: '#ffffff', borderWidth: 0,
      } as RectLayer;
    } else if (tool === 'image') {
      layer = {
        id, name: 'Изображение', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', groupId: null,
        transform: { ...createDefaultTransform(x, y), width: 300, height: 200 },
        src: '', cornerRadius: 0, fit: 'stretch',
      } as ImageLayer;
    } else if (tool === 'clock') {
      layer = {
        id, name: 'Часы', type: 'clock', visible: true, locked: false, opacity: 1, blendMode: 'normal', groupId: null,
        transform: { ...createDefaultTransform(x, y), width: 400, height: 90 },
        mode: 'clock', format: 'HH:mm:ss',
        style: {
          fontFamily: defaultFontFamily, fontSize: 64, fontWeight: 'normal', fill: '#ffffff',
          align: 'left', lineHeight: 1.2, letterSpacing: 0,
          strokeColor: '#000000', strokeWidth: 0,
          dropShadow: false, dropShadowBlur: 4, dropShadowColor: '#000000', dropShadowDistance: 4,
        },
      } as ClockLayer;
    } else if (tool === 'video') {
      layer = {
        id, name: 'Видео', type: 'video', visible: true, locked: false, opacity: 1, blendMode: 'normal', groupId: null,
        transform: { ...createDefaultTransform(x, y), width: 480, height: 270 },
        src: '', loop: true, fit: 'stretch',
      } as VideoLayer;
    } else {
      return;
    }

    addLayer(layer);
    selectLayer(id);
  }, [tool, zoom, addLayer, selectLayer]);

  const handleLayerMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    if (editingLayerId === id) return; // let textarea handle its own events
    const layer = displayTemplate.layers.find((l) => l.id === id);
    if (!layer || layer.locked) return;
    selectLayer(id, e.shiftKey);
    setDragging({ id, startX: e.clientX, startY: e.clientY, origX: layer.transform.x, origY: layer.transform.y });
  }, [tool, displayTemplate.layers, selectLayer, editingLayerId]);

  const handleLayerDoubleClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    const layer = template.layers.find(l => l.id === id);
    if (!layer || layer.locked || layer.type !== 'text') return;
    if (typeof (layer as TextLayer).content !== 'string') return; // variable binding
    setEditingLayerId(id);
    setDragging(null);
  }, [tool, template.layers]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, id: string, handle: ResizeHandle) => {
    e.stopPropagation();
    const layer = displayTemplate.layers.find((l) => l.id === id);
    if (!layer || layer.locked) return;
    const { x, y, width, height } = layer.transform;
    setResizing({ id, handle, startX: e.clientX, startY: e.clientY, origX: x, origY: y, origW: width, origH: height });
  }, [displayTemplate.layers]);

  const handleRotateMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const layer = displayTemplate.layers.find((l) => l.id === id);
    if (!layer || layer.locked) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const t = layer.transform;
    const centerXScreen = containerRect.left + (t.x + t.width / 2) * zoom;
    const centerYScreen = containerRect.top + (t.y + t.height / 2) * zoom;
    const startAngle = Math.atan2(e.clientY - centerYScreen, e.clientX - centerXScreen) * (180 / Math.PI);
    setRotating({ id, centerXScreen, centerYScreen, startAngle, origRotation: t.rotation });
  }, [displayTemplate.layers, zoom]);

  const snapVal = useCallback((v: number) => {
    if (!snapToGrid) return v;
    return Math.round(v / gridSize) * gridSize;
  }, [snapToGrid, gridSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (rotating) {
      const angle = Math.atan2(e.clientY - rotating.centerYScreen, e.clientX - rotating.centerXScreen) * (180 / Math.PI);
      let newRotation = rotating.origRotation + (angle - rotating.startAngle);
      if (e.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
      const layer = template.layers.find(l => l.id === rotating.id);
      if (layer) updateLayerTransform(rotating.id, { rotation: newRotation });
      return;
    }

    if (resizing) {
      const { handle, origX, origY, origW, origH, startX, startY, id } = resizing;
      const layer = template.layers.find(l => l.id === id);
      if (!layer) return;

      const rawDx = (e.clientX - startX) / zoom;
      const rawDy = (e.clientY - startY) / zoom;

      let x = origX, y = origY, w = origW, h = origH;

      switch (handle) {
        case 'nw': x = origX + rawDx; y = origY + rawDy; w = origW - rawDx; h = origH - rawDy; break;
        case 'n':  y = origY + rawDy; h = origH - rawDy; break;
        case 'ne': w = origW + rawDx; y = origY + rawDy; h = origH - rawDy; break;
        case 'e':  w = origW + rawDx; break;
        case 'se': w = origW + rawDx; h = origH + rawDy; break;
        case 's':  h = origH + rawDy; break;
        case 'sw': x = origX + rawDx; w = origW - rawDx; h = origH + rawDy; break;
        case 'w':  x = origX + rawDx; w = origW - rawDx; break;
      }

      // Shift = preserve aspect ratio for corner handles
      if (e.shiftKey && (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se')) {
        const ar = origW / origH;
        const dw = Math.abs(w - origW);
        const dh = Math.abs(h - origH);
        if (dw >= dh * ar) {
          h = w / ar;
          if (handle === 'nw' || handle === 'ne') y = origY + origH - h;
        } else {
          w = h * ar;
          if (handle === 'nw' || handle === 'sw') x = origX + origW - w;
        }
      }

      // Enforce minimum size
      if (w < MIN_SIZE) {
        if (handle === 'nw' || handle === 'w' || handle === 'sw') x = origX + origW - MIN_SIZE;
        w = MIN_SIZE;
      }
      if (h < MIN_SIZE) {
        if (handle === 'nw' || handle === 'n' || handle === 'ne') y = origY + origH - MIN_SIZE;
        h = MIN_SIZE;
      }

      // Snap to grid (skip when Shift held — aspect ratio mode)
      const snap = !e.shiftKey;
      updateLayerTransform(id, {
        x: Math.round(snap ? snapVal(x) : x),
        y: Math.round(snap ? snapVal(y) : y),
        width: Math.round(snap ? snapVal(w) : w),
        height: Math.round(snap ? snapVal(h) : h),
      });
      return;
    }

    if (dragging) {
      const dx = Math.round((e.clientX - dragging.startX) / zoom);
      const dy = Math.round((e.clientY - dragging.startY) / zoom);
      const layer = template.layers.find(l => l.id === dragging.id);
      if (!layer) return;
      // Shift temporarily disables snap
      const newX = e.shiftKey ? dragging.origX + dx : snapVal(dragging.origX + dx);
      const newY = e.shiftKey ? dragging.origY + dy : snapVal(dragging.origY + dy);
      updateLayerTransform(dragging.id, { x: newX, y: newY });
    }
  }, [rotating, resizing, dragging, zoom, template.layers, updateLayerTransform, snapVal]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
    setRotating(null);
  }, []);

  const activeCursor = rotating ? 'crosshair'
    : resizing ? (HANDLES.find(h => h.handle === resizing.handle)?.cursor ?? 'default')
    : dragging ? 'grabbing' : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-900">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-surface-700 text-xs text-gray-400 flex-shrink-0">
        <button onClick={() => setZoom(Math.max(0.1, Math.round((zoom - 0.1) * 10) / 10))} className="px-2 py-0.5 hover:bg-surface-700 rounded">−</button>
        <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))} className="px-2 py-0.5 hover:bg-surface-700 rounded">+</button>
        <button onClick={() => setZoom(0.5)} className="px-2 py-0.5 hover:bg-surface-700 rounded ml-1 text-gray-500 hover:text-white">Fit</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto" style={activeCursor ? { cursor: activeCursor } : undefined}>
        <div className="flex items-start justify-start p-8 min-h-full min-w-full">
          <div
            ref={containerRef}
            style={{
              width: canvasWidth, height: canvasHeight, position: 'relative', flexShrink: 0,
              outline: dropTarget ? '2px dashed #6366f1' : undefined,
            }}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDragOver={(e) => { e.preventDefault(); setDropTarget(true); }}
            onDragLeave={() => setDropTarget(false)}
            onDrop={handleCanvasDrop}
          >
            {/* Canvas background */}
            {template.canvas.background === 'transparent' ? (
              <div
                style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  backgroundImage: 'linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                }}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: template.canvas.background }} />
            )}

            {/* Grid overlay */}
            {snapToGrid && (
              <div
                style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  backgroundImage: `linear-gradient(to right, rgba(99,102,241,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.15) 1px, transparent 1px)`,
                  backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                }}
              />
            )}

            {rendererError && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ color: '#4a4a4a', fontSize: 13 }}>Предпросмотр недоступен (WebGL/Canvas не поддерживается)</span>
              </div>
            )}

            <canvas
              ref={canvasRef}
              style={{ width: canvasWidth, height: canvasHeight, display: 'block', position: 'relative', cursor: tool === 'select' ? 'default' : 'crosshair' }}
            />

            {/* Selection + drag + resize overlays */}
            {tool === 'select' && displayTemplate.layers.map((layer) => {
              const t = layer.transform;
              const isSelected = selectedLayerIds.includes(layer.id);
              return (
                <div
                  key={layer.id}
                  onMouseDown={(e) => handleLayerMouseDown(e, layer.id)}
                  onDoubleClick={(e) => handleLayerDoubleClick(e, layer.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: t.x * zoom,
                    top: t.y * zoom,
                    width: t.width * zoom,
                    height: t.height * zoom,
                    transform: `rotate(${t.rotation}deg) scale(${t.scaleX ?? 1}, ${t.scaleY ?? 1})`,
                    transformOrigin: `${t.anchorX * 100}% ${t.anchorY * 100}%`,
                    border: `1px solid ${isSelected ? '#6366f1' : 'transparent'}`,
                    cursor: layer.type === 'text' && isSelected ? 'text' : dragging?.id === layer.id ? 'grabbing' : 'grab',
                    boxSizing: 'border-box',
                  }}
                >
                  {isSelected && HANDLES.map(({ handle, style, cursor }) => (
                    <div
                      key={handle}
                      onMouseDown={(e) => handleResizeMouseDown(e, layer.id, handle)}
                      style={{
                        position: 'absolute',
                        width: 8, height: 8,
                        background: '#fff',
                        border: '1.5px solid #6366f1',
                        borderRadius: 1,
                        cursor,
                        boxSizing: 'border-box',
                        ...style,
                      }}
                    />
                  ))}

                  {/* Rotation handle */}
                  {isSelected && <>
                    <div style={{
                      position: 'absolute',
                      top: -24, left: 'calc(50% - 0.5px)',
                      width: 1, height: 20,
                      background: '#6366f1',
                      pointerEvents: 'none',
                    }} />
                    <div
                      onMouseDown={(e) => handleRotateMouseDown(e, layer.id)}
                      title="Вращение (Shift = шаг 15°)"
                      style={{
                        position: 'absolute',
                        top: -33, left: 'calc(50% - 5px)',
                        width: 10, height: 10,
                        background: '#fff',
                        border: '1.5px solid #6366f1',
                        borderRadius: '50%',
                        cursor: 'crosshair',
                        boxSizing: 'border-box',
                      }}
                    />
                  </>}
                </div>
              );
            })}

            {/* Inline text editor */}
            {editingLayerId && (() => {
              const layer = template.layers.find(l => l.id === editingLayerId);
              if (!layer || layer.type !== 'text') return null;
              const tl = layer as TextLayer;
              if (typeof tl.content !== 'string') return null;
              const t = tl.transform;
              return (
                <textarea
                  autoFocus
                  value={tl.content}
                  onChange={(e) => updateLayer(editingLayerId, { content: e.target.value } as any)}
                  onBlur={() => setEditingLayerId(null)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') { e.preventDefault(); setEditingLayerId(null); }
                  }}
                  style={{
                    position: 'absolute',
                    left: t.x * zoom,
                    top: t.y * zoom,
                    width: t.width * zoom,
                    height: t.height * zoom,
                    transform: `rotate(${t.rotation}deg) scale(${t.scaleX ?? 1}, ${t.scaleY ?? 1})`,
                    transformOrigin: `${t.anchorX * 100}% ${t.anchorY * 100}%`,
                    fontFamily: tl.style.fontFamily,
                    fontSize: tl.style.fontSize * zoom,
                    color: textFill(tl.style.fill),
                    textAlign: tl.style.align,
                    lineHeight: tl.style.lineHeight,
                    letterSpacing: tl.style.letterSpacing * zoom,
                    background: 'rgba(15, 15, 30, 0.82)',
                    border: '1.5px solid #6366f1',
                    borderRadius: 2,
                    outline: 'none',
                    resize: 'none',
                    padding: 0,
                    margin: 0,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    cursor: 'text',
                    zIndex: 20,
                  }}
                />
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
