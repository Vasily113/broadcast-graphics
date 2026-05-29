import { useRef, useState } from 'react';
import { Diamond, Upload } from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { NumericInput } from './NumericInput';
import {
  findKeyframeAtFrame,
  getGroupLocalTransformAtFrame,
  getGroupWorldTransformAtFrame,
  getLayerLocalTransformAtFrame,
  getLayerWorldTransformAtFrame,
} from '../../core/timeline';
import { TextLayer, RectLayer, ImageLayer, ClockLayer, VideoLayer, VariableBinding, Variable, PositionSizeProp } from '../../core/schema';

// в”Ђв”Ђ Primitive inputs в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function NumInput({ value, onChange, min, max, step = 1, wide = false }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; wide?: boolean;
}) {
  return (
    <NumericInput
      value={value}
      min={min} max={max} step={step}
      onChange={onChange}
      className={`${wide ? 'w-full' : 'flex-1 min-w-0'} bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500 cursor-ew-resize`}
    />
  );
}

function KeyButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1 rounded flex-shrink-0 ${
        active
          ? 'text-amber-300 bg-amber-500/15 hover:bg-amber-500/25'
          : 'text-gray-600 hover:text-amber-300 hover:bg-surface-700'
      }`}
      title="Создать ключ для этого параметра"
    >
      <Diamond size={11} className={active ? 'fill-amber-300' : ''} />
    </button>
  );
}

function ScaleLockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`absolute left-3 top-[27px] text-[10px] leading-none font-semibold tracking-wide ${
        locked ? 'text-gray-300' : 'text-gray-600 hover:text-gray-300'
      }`}
      title={locked ? 'Scale X и Scale Y связаны' : 'Scale X и Scale Y изменяются отдельно'}
    >
      LOCK
    </button>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0 flex-shrink-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
      />
    </div>
  );
}

// Field that can be a plain string or bound to a variable
function BindableField({ value, varFilter, onChange, placeholder = '' }: {
  value: string | VariableBinding;
  varFilter?: Variable[];
  onChange: (v: string | VariableBinding) => void;
  placeholder?: string;
}) {
  const vars = varFilter ?? [];

  if (typeof value === 'object' && value?.type === 'variable') {
    const name = vars.find((v) => v.id === value.variableId)?.name ?? value.variableId;
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-1 bg-accent-500/20 border border-accent-500/40 rounded px-1.5 py-0.5">
          <span className="text-accent-400 text-xs truncate">вљЎ {name}</span>
        </div>
        <button onClick={() => onChange('')} className="text-gray-500 hover:text-white text-xs px-1 flex-shrink-0" title="Отвязать">✕</button>
      </div>
    );
  }

  const str = typeof value === 'string' ? value : '';
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <input
        type="text"
        value={str}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
      />
      {vars.length > 0 && (
        <select
          value=""
          title="Привязать переменную"
          onChange={(e) => e.target.value && onChange({ type: 'variable', variableId: e.target.value })}
          className="w-6 flex-shrink-0 bg-surface-700 border border-surface-600 rounded text-xs text-gray-400 cursor-pointer focus:outline-none text-center"
        >
          <option value="">⚡</option>
          {vars.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  );
}

// Color field that also supports variable binding
function ColorBindableField({ value, vars, onChange }: {
  value: string | VariableBinding;
  vars: Variable[];
  onChange: (v: string | VariableBinding) => void;
}) {
  if (typeof value === 'object' && value?.type === 'variable') {
    const name = vars.find((v) => v.id === value.variableId)?.name ?? value.variableId;
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-1 bg-accent-500/20 border border-accent-500/40 rounded px-1.5 py-0.5">
          <span className="text-accent-400 text-xs truncate">вљЎ {name}</span>
        </div>
        <button onClick={() => onChange('#ffffff')} className="text-gray-500 hover:text-white text-xs px-1 flex-shrink-0" title="Отвязать">✕</button>
      </div>
    );
  }

  const str = typeof value === 'string' ? value : '#ffffff';
  const colorVars = vars.filter((v) => v.type === 'color');
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <ColorInput value={str} onChange={onChange} />
      {colorVars.length > 0 && (
        <select
          value=""
          title="Привязать переменную"
          onChange={(e) => e.target.value && onChange({ type: 'variable', variableId: e.target.value })}
          className="w-6 flex-shrink-0 bg-surface-700 border border-surface-600 rounded text-xs text-gray-400 cursor-pointer focus:outline-none text-center"
        >
          <option value="">⚡</option>
          {colorVars.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  );
}

// в”Ђв”Ђ Layout helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-surface-700">
      <div className="px-3 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide bg-surface-800/60">
        {title}
      </div>
      <div className="py-0.5">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 px-3 py-1">{children}</div>;
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-500 text-xs w-14 flex-shrink-0">{children}</span>;
}

// в”Ђв”Ђ Font input в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const POPULAR_FONTS = [
  'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman',
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald', 'Raleway', 'Poppins',
  'Source Sans Pro', 'Ubuntu', 'Nunito', 'Inter', 'Playfair Display',
  'Merriweather', 'PT Sans', 'Noto Sans', 'Anton', 'Bebas Neue',
];

const loadedFonts = new Set<string>();

function loadGoogleFont(family: string) {
  if (loadedFonts.has(family)) return;
  const safe = ['Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman'];
  if (safe.includes(family)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`;
  document.head.appendChild(link);
  loadedFonts.add(family);
}

function FontInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input
        list="font-list"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          loadGoogleFont(e.target.value);
        }}
        onBlur={(e) => loadGoogleFont(e.target.value)}
        className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
        style={{ fontFamily: value }}
      />
      <datalist id="font-list">
        {POPULAR_FONTS.map((f) => <option key={f} value={f} />)}
      </datalist>
    </>
  );
}

// в”Ђв”Ђ Image upload в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function ImageUploadRow({ value, variables, onChange }: {
  value: string | VariableBinding;
  variables: Variable[];
  onChange: (v: string | VariableBinding) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      const { url } = await r.json();
      onChange(url);
    } catch (err) {
      console.error('Image upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  const src = typeof value === 'string' ? value : '';

  return (
    <>
      <Row>
        <Lbl>URL</Lbl>
        <div className="flex gap-1 flex-1">
          <BindableField value={value} varFilter={variables} onChange={onChange} placeholder="https://..." />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Загрузить файл"
            className="flex-shrink-0 px-1.5 bg-surface-600 hover:bg-surface-500 disabled:opacity-40 rounded text-gray-300 transition-colors"
          >
            <Upload size={11} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
      </Row>

      {/* Drop zone + preview */}
      <div className="px-3 pb-2">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !src && fileRef.current?.click()}
          style={{
            position: 'relative',
            height: src ? 80 : 52,
            borderRadius: 6,
            border: `1.5px dashed ${dragOver ? '#6366f1' : src ? 'transparent' : '#3a3a5c'}`,
            background: src ? 'transparent' : '#1a1a2e',
            cursor: src ? 'default' : 'pointer',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'border-color 0.15s',
          }}
        >
          {uploading ? (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Загрузка...</span>
          ) : src ? (
            <img
              src={src}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <span style={{ fontSize: 11, color: dragOver ? '#6366f1' : '#4b5563' }}>
              {dragOver ? 'Отпустите файл' : 'Перетащите файл или нажмите'}
            </span>
          )}
          {src && (
            <button
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              style={{
                position: 'absolute', top: 4, right: 4,
                background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 4,
                color: '#9ca3af', cursor: 'pointer', fontSize: 11, padding: '1px 5px', lineHeight: 1.4,
              }}
              title="Убрать изображение"
            >✕</button>
          )}
        </div>
      </div>
    </>
  );
}

// в”Ђв”Ђ Video upload в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function VideoUploadRow({ value, onChange }: { value: string | VariableBinding; onChange: (v: string | VariableBinding) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      const { url } = await r.json();
      onChange(url);
    } catch (err) {
      console.error('Video upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-1 flex-1">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-surface-700 hover:bg-surface-600 disabled:opacity-40 text-gray-300 transition-colors"
      >
        {uploading ? 'Загрузка...' : '↑ Выбрать .webm'}
      </button>
      {typeof value === 'string' && value && (
        <span className="text-xs text-green-400 truncate flex-1" title={value}>✓ {value.split('/').pop()}</span>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/webm,video/mp4"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
      />
    </div>
  );
}

// в”Ђв”Ђ Main component в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export function PropertiesPanel() {
  const [scaleLockByTarget, setScaleLockByTarget] = useState<Record<string, boolean>>({});
  const {
    template,
    selectedLayerIds,
    selectedGroupIds,
    transformSpace,
    setTransformSpace,
    updateLayer,
    updateCanvas,
    updateLayerTransform,
    updateGroup,
    updateGroupTransform,
    addTimelineKeyframeAtPlayhead,
    timelinePlayhead,
    timelineDirectorPlayheads,
    selectedTimelineKeyframeId,
    selectedTimelineActionId,
    updateTimelineAction,
  } = useEditorStore();

  const timeline = template.timeline;
  const selectedAction = selectedTimelineActionId
    ? timeline.actions.find((action) => action.id === selectedTimelineActionId)
    : null;
  const baseLayer = selectedLayerIds.length === 1
    ? template.layers.find((l) => l.id === selectedLayerIds[0])
    : null;
  const baseGroup = selectedGroupIds.length === 1
    ? (template.groups ?? []).find((g) => g.id === selectedGroupIds[0])
    : null;

  const keyAtPlayhead = findKeyframeAtFrame(timeline, timelinePlayhead);
  const editingKeyframe =
    selectedTimelineKeyframeId && keyAtPlayhead?.id === selectedTimelineKeyframeId;

  const layerLocal = baseLayer
    ? getLayerLocalTransformAtFrame(baseLayer, timeline, timelineDirectorPlayheads)
    : null;
  const layerWorld = baseLayer
    ? getLayerWorldTransformAtFrame(baseLayer, template, timelineDirectorPlayheads)
    : null;
  const layerT = transformSpace === 'world' ? layerWorld : layerLocal;

  const groupLocal = baseGroup
    ? getGroupLocalTransformAtFrame(baseGroup, timeline, timelineDirectorPlayheads)
    : null;
  const groupWorld = baseGroup
    ? getGroupWorldTransformAtFrame(baseGroup, template, timelineDirectorPlayheads)
    : null;
  const groupT = transformSpace === 'world' ? groupWorld : groupLocal;
  const scaleLockKey = baseLayer
    ? `layer:${baseLayer.id}`
    : baseGroup
      ? `group:${baseGroup.id}`
      : null;
  const scaleLocked = scaleLockKey ? scaleLockByTarget[scaleLockKey] ?? true : true;
  const toggleScaleLock = () => {
    if (!scaleLockKey) return;
    setScaleLockByTarget((prev) => ({
      ...prev,
      [scaleLockKey]: !(prev[scaleLockKey] ?? true),
    }));
  };

  const upd = (patch: object) => baseLayer && updateLayer(baseLayer.id, patch as any);
  const updT = (patch: object) => baseLayer && updateLayerTransform(baseLayer.id, patch as any);
  const updGT = (patch: object) => baseGroup && updateGroupTransform(baseGroup.id, patch as any);
  const scalePropsForKey = (prop: PositionSizeProp): PositionSizeProp[] =>
    scaleLocked && (prop === 'scaleX' || prop === 'scaleY') ? ['scaleX', 'scaleY'] : [prop];

  const addLayerPropKey = (prop: PositionSizeProp) =>
    baseLayer && addTimelineKeyframeAtPlayhead({ kind: 'layer', targetId: baseLayer.id, props: scalePropsForKey(prop) });
  const addGroupPropKey = (prop: PositionSizeProp) =>
    baseGroup && addTimelineKeyframeAtPlayhead({ kind: 'group', targetId: baseGroup.id, props: scalePropsForKey(prop) });
  const updLayerScaleX = (v: number) => updT(scaleLocked ? { scaleX: v, scaleY: v } : { scaleX: v });
  const updLayerScaleY = (v: number) => updT(scaleLocked ? { scaleX: v, scaleY: v } : { scaleY: v });
  const updGroupScaleX = (v: number) => updGT(scaleLocked ? { scaleX: v, scaleY: v } : { scaleX: v });
  const updGroupScaleY = (v: number) => updGT(scaleLocked ? { scaleX: v, scaleY: v } : { scaleY: v });

  if (selectedAction) {
    return (
      <div className="flex-1 overflow-y-auto text-white">
        <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide">
          Action
        </div>
        <Section title="Action">
          <Row>
            <Lbl>Команда</Lbl>
            <select
              value={selectedAction.command}
              onChange={(e) => updateTimelineAction(selectedAction.id, { command: e.target.value as typeof selectedAction.command })}
              className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white min-w-0"
            >
              <option value="startDirector">Запустить директор</option>
              <option value="stopDirector">Остановить директор</option>
            </select>
          </Row>
          <Row>
            <Lbl>Параметр</Lbl>
            <select
              value={selectedAction.targetDirectorId ?? ''}
              onChange={(e) => updateTimelineAction(selectedAction.id, { targetDirectorId: e.target.value || null })}
              className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white min-w-0"
            >
              <option value="">Выберите director</option>
              {timeline.directors.map((director) => (
                <option key={director.id} value={director.id}>
                  {director.name}
                </option>
              ))}
            </select>
          </Row>
        </Section>
      </div>
    );
  }

  const TransformSpaceToggle = () => (
    <Row>
      <Lbl>Коорд.</Lbl>
      <div className="flex gap-1 flex-1">
        {(['local', 'world'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setTransformSpace(mode)}
            className={`flex-1 py-0.5 rounded text-xs ${transformSpace === mode ? 'bg-accent-500 text-white' : 'bg-surface-700 text-gray-400'}`}
          >
            {mode === 'local' ? 'Относит.' : 'Абсолют.'}
          </button>
        ))}
      </div>
    </Row>
  );

  // в”Ђв”Ђ Multiselect panel в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (selectedLayerIds.length > 1) {
    const selected = template.layers.filter((l) => selectedLayerIds.includes(l.id));
    const minX = Math.min(...selected.map((l) => l.transform.x));
    const minY = Math.min(...selected.map((l) => l.transform.y));
    const opacities = selected.map((l) => l.opacity);
    const sharedOpacity = opacities.every((o) => o === opacities[0]) ? Math.round(opacities[0] * 100) : null;

    const moveAll = (dx: number, dy: number) => {
      selected.forEach((l) => {
        if (!l.locked) updateLayer(l.id, { transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } } as any);
      });
    };
    const setGroupPos = (newX: number, newY: number) => moveAll(newX - minX, newY - minY);
    const setAllOpacity = (v: number) => {
      selected.forEach((l) => { if (!l.locked) updateLayer(l.id, { opacity: v / 100 } as any); });
    };

    return (
      <div className="flex-1 overflow-y-auto text-white">
        <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide">
          {selectedLayerIds.length} СЃР»РѕС‘РІ
        </div>
        <Section title="Положение группы">
          <Row>
            <Lbl>X</Lbl>
            <NumInput value={minX} onChange={(v) => setGroupPos(v, minY)} wide />
          </Row>
          <Row>
            <Lbl>Y</Lbl>
            <NumInput value={minY} onChange={(v) => setGroupPos(minX, v)} wide />
          </Row>
          <Row>
            <Lbl>Прозр.</Lbl>
            <NumInput
              value={sharedOpacity ?? 100}
              min={0} max={100}
              onChange={setAllOpacity}
              wide
            />
            {sharedOpacity === null && <span className="text-xs text-gray-500 ml-1">mixed</span>}
          </Row>
        </Section>
      </div>
    );
  }

  // в”Ђв”Ђ Group properties в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (baseGroup && !baseLayer) {
    const t = groupT!;
    const groupKeyAtPlayhead = keyAtPlayhead?.groups[baseGroup.id];
    return (
      <div className="flex-1 overflow-y-auto text-white">
        <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide">
          Группа
        </div>
        <Section title="Имя">
          <Row>
            <Lbl>Название</Lbl>
            <input
              type="text"
              value={baseGroup.name}
              onChange={(e) => updateGroup(baseGroup.id, { name: e.target.value })}
              className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white min-w-0"
            />
          </Row>
        </Section>
        <Section title="Позиция и размер">
          {editingKeyframe && (
            <p className="text-[10px] text-amber-400/90 mb-1.5">Ключ — кадр {timelinePlayhead}</p>
          )}
          {!editingKeyframe && groupKeyAtPlayhead && (
            <p className="text-[10px] text-amber-400/70 mb-1.5">Значения кадра {timelinePlayhead} (ключ на таймлайне)</p>
          )}
          <TransformSpaceToggle />
          <Row>
            <Lbl>X</Lbl>
            <NumInput value={Math.round(t.x)} onChange={(v) => updGT({ x: v })} wide />
            <KeyButton active={groupKeyAtPlayhead?.x !== undefined} onClick={() => addGroupPropKey('x')} />
          </Row>
          <Row>
            <Lbl>Y</Lbl>
            <NumInput value={Math.round(t.y)} onChange={(v) => updGT({ y: v })} wide />
            <KeyButton active={groupKeyAtPlayhead?.y !== undefined} onClick={() => addGroupPropKey('y')} />
          </Row>
          <Row>
            <Lbl>Ш</Lbl>
            <NumInput value={Math.round(t.width)} min={0} onChange={(v) => updGT({ width: v })} wide />
            <KeyButton active={groupKeyAtPlayhead?.width !== undefined} onClick={() => addGroupPropKey('width')} />
          </Row>
          <Row>
            <Lbl>В</Lbl>
            <NumInput value={Math.round(t.height)} min={0} onChange={(v) => updGT({ height: v })} wide />
            <KeyButton active={groupKeyAtPlayhead?.height !== undefined} onClick={() => addGroupPropKey('height')} />
          </Row>
          <Row>
            <Lbl>Угол°</Lbl>
            <NumInput value={Math.round(t.rotation)} onChange={(v) => updGT({ rotation: v })} wide />
            <KeyButton active={groupKeyAtPlayhead?.rotation !== undefined} onClick={() => addGroupPropKey('rotation')} />
          </Row>
          <div className="relative">
            <ScaleLockButton locked={scaleLocked} onToggle={toggleScaleLock} />
            <Row>
              <Lbl>Scale X</Lbl>
              <NumInput value={t.scaleX} min={0.01} step={0.05} onChange={updGroupScaleX} wide />
              <KeyButton active={groupKeyAtPlayhead?.scaleX !== undefined} onClick={() => addGroupPropKey('scaleX')} />
            </Row>
            <Row>
              <Lbl>Scale Y</Lbl>
              <NumInput value={t.scaleY} min={0.01} step={0.05} onChange={updGroupScaleY} wide />
              <KeyButton active={groupKeyAtPlayhead?.scaleY !== undefined} onClick={() => addGroupPropKey('scaleY')} />
            </Row>
          </div>
        </Section>
      </div>
    );
  }

  // в”Ђв”Ђ Canvas properties (nothing selected) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (!baseLayer) {
    return (
      <div className="flex-1 overflow-y-auto text-white">
        <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide">
          Холст
        </div>
        <Section title="Размер">
          <Row>
            <Lbl>Ширина</Lbl>
            <NumInput value={template.canvas.width} min={1} onChange={(v) => updateCanvas({ width: v })} />
          </Row>
          <Row>
            <Lbl>Высота</Lbl>
            <NumInput value={template.canvas.height} min={1} onChange={(v) => updateCanvas({ height: v })} />
          </Row>
          <div className="flex flex-wrap gap-1 pt-1">
            {([
              { label: 'FHD', w: 1920, h: 1080 },
              { label: 'HD',  w: 1280, h: 720  },
              { label: '4K',  w: 3840, h: 2160 },
              { label: 'SD',  w: 1024, h: 576  },
            ] as const).map(({ label, w, h }) => (
              <button
                key={label}
                onClick={() => updateCanvas({ width: w, height: h })}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  template.canvas.width === w && template.canvas.height === h
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-700 text-gray-400 hover:text-white hover:bg-surface-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Фон">
          <Row>
            <Lbl>Цвет</Lbl>
            {template.canvas.background === 'transparent' ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-gray-500 italic">Прозрачный</span>
                <button
                  onClick={() => updateCanvas({ background: '#000000' })}
                  className="text-xs text-accent-400 hover:text-accent-300"
                >
                  → цвет
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <ColorInput
                  value={template.canvas.background}
                  onChange={(v) => updateCanvas({ background: v })}
                />
                <button
                  onClick={() => updateCanvas({ background: 'transparent' })}
                  className="text-gray-500 hover:text-white text-xs flex-shrink-0"
                  title="Сбросить (прозрачный)"
                >
                  ✕
                </button>
              </div>
            )}
          </Row>
        </Section>
      </div>
    );
  }

  const t = layerT!;
  const layerKeyAtPlayhead = keyAtPlayhead?.layers[baseLayer.id];

  return (
    <div className="flex-1 overflow-y-auto text-white">
      <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center justify-between">
        <span>Свойства</span>
        {baseLayer!.locked && (
          <span className="text-yellow-500 text-xs font-normal normal-case flex items-center gap-1">
            🔒 Заблокирован
          </span>
        )}
      </div>

      {/* Transform */}
      <Section title="Позиция и размер">
        {editingKeyframe && (
          <p className="text-[10px] text-amber-400/90 mb-1.5">Редактирование ключа — кадр {timelinePlayhead}</p>
        )}
        <Row>
          <Lbl>X</Lbl>
          <NumInput value={Math.round(t.x)} onChange={(v) => updT({ x: v })} wide />
          <KeyButton active={layerKeyAtPlayhead?.x !== undefined} onClick={() => addLayerPropKey('x')} />
        </Row>
        <Row>
          <Lbl>Y</Lbl>
          <NumInput value={Math.round(t.y)} onChange={(v) => updT({ y: v })} wide />
          <KeyButton active={layerKeyAtPlayhead?.y !== undefined} onClick={() => addLayerPropKey('y')} />
        </Row>
        <Row>
          <Lbl>Ш</Lbl>
          <NumInput value={Math.round(t.width)} min={1} onChange={(v) => updT({ width: v })} wide />
          <KeyButton active={layerKeyAtPlayhead?.width !== undefined} onClick={() => addLayerPropKey('width')} />
        </Row>
        <Row>
          <Lbl>В</Lbl>
          <NumInput value={Math.round(t.height)} min={1} onChange={(v) => updT({ height: v })} wide />
          <KeyButton active={layerKeyAtPlayhead?.height !== undefined} onClick={() => addLayerPropKey('height')} />
        </Row>
        <Row>
          <Lbl>Угол°</Lbl>
          <NumInput value={Math.round(t.rotation)} min={-360} max={360} onChange={(v) => updT({ rotation: v })} wide />
          <KeyButton active={layerKeyAtPlayhead?.rotation !== undefined} onClick={() => addLayerPropKey('rotation')} />
        </Row>
        <Row>
          <Lbl>Прозр.</Lbl>
          <NumInput value={Math.round(baseLayer!.opacity * 100)} min={0} max={100} onChange={(v) => upd({ opacity: v / 100 })} wide />
        </Row>
        <div className="relative">
          <ScaleLockButton locked={scaleLocked} onToggle={toggleScaleLock} />
          <Row>
            <Lbl>Scale X</Lbl>
            <NumInput value={t.scaleX} min={0.01} step={0.05} onChange={updLayerScaleX} wide />
            <KeyButton active={layerKeyAtPlayhead?.scaleX !== undefined} onClick={() => addLayerPropKey('scaleX')} />
          </Row>
          <Row>
            <Lbl>Scale Y</Lbl>
            <NumInput value={t.scaleY} min={0.01} step={0.05} onChange={updLayerScaleY} wide />
            <KeyButton active={layerKeyAtPlayhead?.scaleY !== undefined} onClick={() => addLayerPropKey('scaleY')} />
          </Row>
        </div>
      </Section>

      {/* Text layer */}
      {baseLayer!.type === 'text' && (() => {
        const l = baseLayer as TextLayer;
        const vars = template.variables;
        const updS = (patch: object) => upd({ style: { ...l.style, ...patch } });
        return (
          <>
            <Section title="Текст">
              <Row>
                <Lbl>Текст</Lbl>
                <BindableField
                  value={l.content}
                  varFilter={vars.filter((v) => v.type === 'text')}
                  onChange={(v) => upd({ content: v })}
                  placeholder="Введите текст..."
                />
              </Row>
              <Row>
                <Lbl>Шрифт</Lbl>
                <FontInput value={l.style.fontFamily} onChange={(v) => updS({ fontFamily: v })} />
              </Row>
              <Row>
                <Lbl>Размер</Lbl>
                <NumInput value={l.style.fontSize} min={1} onChange={(v) => updS({ fontSize: v })} />
                <select
                  value={l.style.fontWeight}
                  onChange={(e) => updS({ fontWeight: e.target.value })}
                  className="w-20 flex-shrink-0 bg-surface-700 border border-surface-600 rounded px-1 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
                >
                  {['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </Row>
              <Row>
                <Lbl>Цвет</Lbl>
                <ColorBindableField value={l.style.fill} vars={vars} onChange={(v) => updS({ fill: v })} />
              </Row>
              <Row>
                <Lbl>Выравн.</Lbl>
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => updS({ align: a })}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        l.style.align === a ? 'bg-accent-500 text-white' : 'bg-surface-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
                    </button>
                  ))}
                </div>
              </Row>
              <Row>
                <Lbl>Межстр.</Lbl>
                <NumInput value={l.style.lineHeight} min={0.5} max={5} step={0.1} onChange={(v) => updS({ lineHeight: v })} />
                <Lbl>Трекинг</Lbl>
                <NumInput value={l.style.letterSpacing} min={-20} max={100} onChange={(v) => updS({ letterSpacing: v })} />
              </Row>
            </Section>

            <Section title="Обводка">
              <Row>
                <Lbl>Толщина</Lbl>
                <NumInput value={l.style.strokeWidth} min={0} onChange={(v) => updS({ strokeWidth: v })} />
              </Row>
              {l.style.strokeWidth > 0 && (
                <Row>
                  <Lbl>Цвет</Lbl>
                  <ColorInput value={l.style.strokeColor} onChange={(v) => updS({ strokeColor: v })} />
                </Row>
              )}
            </Section>

            <Section title="Тень">
              <Row>
                <Lbl>Вкл.</Lbl>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={l.style.dropShadow}
                    onChange={(e) => updS({ dropShadow: e.target.checked })}
                    className="accent-accent-500"
                  />
                  <span className="text-xs text-gray-400">{l.style.dropShadow ? 'Да' : 'Нет'}</span>
                </label>
              </Row>
              {l.style.dropShadow && (
                <>
                  <Row>
                    <Lbl>Размытие</Lbl>
                    <NumInput value={l.style.dropShadowBlur} min={0} onChange={(v) => updS({ dropShadowBlur: v })} />
                    <Lbl>Отступ</Lbl>
                    <NumInput value={l.style.dropShadowDistance} min={0} onChange={(v) => updS({ dropShadowDistance: v })} />
                  </Row>
                  <Row>
                    <Lbl>Цвет</Lbl>
                    <ColorInput value={l.style.dropShadowColor} onChange={(v) => updS({ dropShadowColor: v })} />
                  </Row>
                </>
              )}
            </Section>
          </>
        );
      })()}

      {/* Rect layer */}
      {baseLayer!.type === 'rect' && (() => {
        const l = baseLayer as RectLayer;
        return (
          <Section title="Прямоугольник">
            <Row>
              <Lbl>Заливка</Lbl>
              <ColorBindableField
                value={l.fill}
                vars={template.variables}
                onChange={(v) => upd({ fill: v })}
              />
            </Row>
            <Row>
              <Lbl>Радиус</Lbl>
              <NumInput value={l.cornerRadius} min={0} onChange={(v) => upd({ cornerRadius: v })} />
            </Row>
            <Row>
              <Lbl>Граница</Lbl>
              <NumInput value={l.borderWidth} min={0} onChange={(v) => upd({ borderWidth: v })} />
            </Row>
            {l.borderWidth > 0 && (
              <Row>
                <Lbl>Цвет гр.</Lbl>
                <ColorInput value={l.borderColor} onChange={(v) => upd({ borderColor: v })} />
              </Row>
            )}
          </Section>
        );
      })()}

      {/* Clock layer */}
      {baseLayer!.type === 'clock' && (() => {
        const l = baseLayer as ClockLayer;
        const updS = (patch: object) => upd({ style: { ...l.style, ...patch } });
        return (
          <>
            <Section title="Часы / Таймер">
              <Row>
                <Lbl>Режим</Lbl>
                <div className="flex gap-1 flex-1">
                  {(['clock', 'countup', 'countdown'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => upd({ mode: m })}
                      className={`flex-1 py-0.5 rounded text-xs transition-colors ${l.mode === m ? 'bg-accent-500 text-white' : 'bg-surface-700 text-gray-400 hover:text-white'}`}
                    >
                      {m === 'clock' ? 'Часы' : m === 'countup' ? 'Прямой' : 'Обратный'}
                    </button>
                  ))}
                </div>
              </Row>
              <Row>
                <Lbl>Формат</Lbl>
                <div className="flex gap-1 flex-1">
                  {(['HH:mm:ss', 'HH:mm', 'mm:ss'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => upd({ format: f })}
                      className={`flex-1 py-0.5 rounded text-xs font-mono transition-colors ${l.format === f ? 'bg-accent-500 text-white' : 'bg-surface-700 text-gray-400 hover:text-white'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </Row>
              {l.mode === 'countdown' && (
                <Row>
                  <Lbl>До момента</Lbl>
                  <input
                    type="datetime-local"
                    value={l.targetTime
                      ? new Date(l.targetTime * 1000).toISOString().slice(0, 16)
                      : ''}
                    onChange={(e) => {
                      const ts = e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : undefined;
                      upd({ targetTime: ts });
                    }}
                    className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
                  />
                </Row>
              )}
              {l.mode === 'countup' && (
                <Row>
                  <Lbl>С момента</Lbl>
                  <div className="flex gap-1 flex-1">
                    <input
                      type="datetime-local"
                      value={l.startTime
                        ? new Date(l.startTime * 1000).toISOString().slice(0, 16)
                        : ''}
                      onChange={(e) => {
                        const ts = e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : undefined;
                        upd({ startTime: ts });
                      }}
                      className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
                    />
                    <button
                      onClick={() => upd({ startTime: Math.floor(Date.now() / 1000) })}
                      className="px-2 py-0.5 rounded text-xs bg-surface-700 hover:bg-surface-600 text-gray-400 hover:text-white transition-colors flex-shrink-0"
                      title="Начать с текущего момента"
                    >Сейчас</button>
                  </div>
                </Row>
              )}
            </Section>

            {/* Font styling — reuse text style section */}
            <Section title="Шрифт">
              <Row>
                <Lbl>Шрифт</Lbl>
                <input type="text" value={l.style.fontFamily}
                  onChange={(e) => updS({ fontFamily: e.target.value })}
                  className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500" />
              </Row>
              <Row>
                <Lbl>Размер</Lbl>
                <NumInput value={l.style.fontSize} min={6} onChange={(v) => updS({ fontSize: v })} />
                <Lbl>Вес</Lbl>
                <select value={l.style.fontWeight} onChange={(e) => updS({ fontWeight: e.target.value })}
                  className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none">
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </Row>
              <Row>
                <Lbl>Цвет</Lbl>
                <ColorInput value={typeof l.style.fill === 'string' ? l.style.fill : '#ffffff'}
                  onChange={(v) => updS({ fill: v })} />
              </Row>
              <Row>
                <Lbl>Выравн.</Lbl>
                <div className="flex gap-1 flex-1">
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button key={a} onClick={() => updS({ align: a })}
                      className={`flex-1 py-0.5 rounded text-xs transition-colors ${l.style.align === a ? 'bg-accent-500 text-white' : 'bg-surface-700 text-gray-400 hover:text-white'}`}>
                      {a === 'left' ? '←' : a === 'center' ? '↔' : '→'}
                    </button>
                  ))}
                </div>
              </Row>
            </Section>
          </>
        );
      })()}

      {/* Video layer */}
      {baseLayer!.type === 'video' && (() => {
        const l = baseLayer as VideoLayer;
        return (
          <Section title="Видео">
            <Row>
              <Lbl>URL</Lbl>
              <BindableField
                value={l.src}
                varFilter={template.variables.filter((v) => v.type === 'video')}
                onChange={(v) => upd({ src: v })}
                placeholder="/uploads/video.webm"
              />
            </Row>
            <Row>
              <Lbl>Загрузить</Lbl>
              <VideoUploadRow value={l.src} onChange={(v) => upd({ src: v })} />
            </Row>
            <Row>
              <Lbl>Режим</Lbl>
              <div className="flex gap-1">
                {(['stretch', 'contain', 'cover'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => upd({ fit: f })}
                    title={{ stretch: 'Растянуть', contain: 'Вписать', cover: 'Заполнить' }[f]}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      (l.fit ?? 'stretch') === f
                        ? 'bg-accent-500 text-white'
                        : 'bg-surface-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {{ stretch: '⟺', contain: '⊡', cover: '⬛' }[f]}
                  </button>
                ))}
              </div>
            </Row>
            <Row>
              <Lbl>Повтор</Lbl>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={l.loop}
                  onChange={(e) => upd({ loop: e.target.checked })}
                  className="accent-accent-500"
                />
                <span className="text-xs text-gray-400">{l.loop ? 'Да' : 'Нет'}</span>
              </label>
            </Row>
            {l.src && (
              <div className="px-3 pb-2">
                <p className="text-xs text-gray-500">
                  РСЃРїРѕР»СЊР·СѓР№С‚Рµ <span className="text-accent-400 font-mono">.webm</span> с альфа-каналом для прозрачности (VP9+alpha)
                </p>
              </div>
            )}
          </Section>
        );
      })()}

      {/* Image layer */}
      {baseLayer!.type === 'image' && (() => {
        const l = baseLayer as ImageLayer;
        return (
          <Section title="РР·РѕР±СЂР°Р¶РµРЅРёРµ">
            <ImageUploadRow
              value={l.src}
              variables={template.variables.filter((v) => v.type === 'image')}
              onChange={(v) => upd({ src: v })}
            />
            <Row>
              <Lbl>Режим</Lbl>
              <div className="flex gap-1">
                {(['stretch', 'contain', 'cover'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => upd({ fit: f })}
                    title={{ stretch: 'Растянуть', contain: 'Вписать', cover: 'Заполнить' }[f]}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      (l.fit ?? 'stretch') === f
                        ? 'bg-accent-500 text-white'
                        : 'bg-surface-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {{ stretch: '⟺', contain: '⊡', cover: '⬛' }[f]}
                  </button>
                ))}
              </div>
            </Row>
            <Row>
              <Lbl>Радиус</Lbl>
              <NumInput value={l.cornerRadius} min={0} onChange={(v) => upd({ cornerRadius: v })} />
            </Row>
          </Section>
        );
      })()}
    </div>
  );
}



