import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { TextLayer, RectLayer, ImageLayer, ClockLayer, VideoLayer, VariableBinding, Variable } from '../../core/schema';

// ── Primitive inputs ────────────────────────────────────────────────────────

function NumInput({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min} max={max} step={step}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
    />
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
          <span className="text-accent-400 text-xs truncate">⚡ {name}</span>
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
          <span className="text-accent-400 text-xs truncate">⚡ {name}</span>
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

// ── Layout helpers ──────────────────────────────────────────────────────────

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

// ── Font input ───────────────────────────────────────────────────────────────

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

// ── Image upload ─────────────────────────────────────────────────────────────

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

// ── Video upload ─────────────────────────────────────────────────────────────

function VideoUploadRow({ value, variables, onChange }: {
  value: string | VariableBinding;
  variables: Variable[];
  onChange: (v: string | VariableBinding) => void;
}) {
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

  const src = typeof value === 'string' ? value : '';

  return (
    <>
      <Row>
        <Lbl>URL</Lbl>
        <div className="flex gap-1 flex-1">
          <BindableField value={value} varFilter={variables} onChange={onChange} placeholder="/uploads/video.webm" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Загрузить файл"
            className="flex-shrink-0 px-1.5 bg-surface-600 hover:bg-surface-500 disabled:opacity-40 rounded text-gray-300 transition-colors"
          >
            <Upload size={11} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/webm,video/mp4"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
          />
        </div>
      </Row>
      {uploading && (
        <Row><Lbl>{''}</Lbl><span className="text-xs text-gray-500">Загрузка...</span></Row>
      )}
      {src && !uploading && (
        <Row>
          <Lbl>{''}</Lbl>
          <span className="text-xs text-green-400 truncate flex-1" title={src}>✓ {src.split('/').pop()}</span>
        </Row>
      )}
    </>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function PropertiesPanel() {
  const { template, selectedLayerIds, updateLayer, updateCanvas } = useEditorStore();

  const layer = selectedLayerIds.length === 1
    ? template.layers.find((l) => l.id === selectedLayerIds[0])
    : null;

  const upd = (patch: object) => layer && updateLayer(layer.id, patch as any);
  const updT = (patch: object) => layer && upd({ transform: { ...layer.transform, ...patch } });

  // ── Multiselect panel ────────────────────────────────────────────────────
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
          {selectedLayerIds.length} слоёв
        </div>
        <Section title="Положение группы">
          <Row>
            <Lbl>X</Lbl>
            <NumInput value={minX} onChange={(v) => setGroupPos(v, minY)} />
            <Lbl>Y</Lbl>
            <NumInput value={minY} onChange={(v) => setGroupPos(minX, v)} />
          </Row>
          <Row>
            <Lbl>Прозр.</Lbl>
            <NumInput
              value={sharedOpacity ?? 100}
              min={0} max={100}
              onChange={setAllOpacity}
            />
            {sharedOpacity === null && <span className="text-xs text-gray-500 ml-1">mixed</span>}
          </Row>
        </Section>
      </div>
    );
  }

  // ── Canvas properties (nothing selected) ────────────────────────────────
  if (!layer) {
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

  const t = layer.transform;

  return (
    <div className="flex-1 overflow-y-auto text-white">
      <div className="px-3 py-2 border-b border-surface-700 text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center justify-between">
        <span>Свойства</span>
        {layer.locked && (
          <span className="text-yellow-500 text-xs font-normal normal-case flex items-center gap-1">
            🔒 Заблокирован
          </span>
        )}
      </div>

      {/* Transform */}
      <Section title="Позиция и размер">
        <Row>
          <Lbl>X</Lbl>
          <NumInput value={t.x} onChange={(v) => updT({ x: v })} />
          <Lbl>Y</Lbl>
          <NumInput value={t.y} onChange={(v) => updT({ y: v })} />
        </Row>
        <Row>
          <Lbl>Ш</Lbl>
          <NumInput value={t.width} min={1} onChange={(v) => updT({ width: v })} />
          <Lbl>В</Lbl>
          <NumInput value={t.height} min={1} onChange={(v) => updT({ height: v })} />
        </Row>
        <Row>
          <Lbl>Угол°</Lbl>
          <NumInput value={t.rotation} min={-360} max={360} onChange={(v) => updT({ rotation: v })} />
          <Lbl>Прозр.</Lbl>
          <NumInput value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(v) => upd({ opacity: v / 100 })} />
        </Row>
      </Section>

      {/* Text layer */}
      {layer.type === 'text' && (() => {
        const l = layer as TextLayer;
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
      {layer.type === 'rect' && (() => {
        const l = layer as RectLayer;
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
      {layer.type === 'clock' && (() => {
        const l = layer as ClockLayer;
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
      {layer.type === 'video' && (() => {
        const l = layer as VideoLayer;
        return (
          <Section title="Видео">
            <VideoUploadRow
              value={l.src}
              variables={template.variables.filter((v) => v.type === 'video')}
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
            {(typeof l.src === 'string' ? l.src : true) && (
              <div className="px-3 pb-2">
                <p className="text-xs text-gray-500">
                  Используйте <span className="text-accent-400 font-mono">.webm</span> с альфа-каналом для прозрачности (VP9+alpha)
                </p>
              </div>
            )}
          </Section>
        );
      })()}

      {/* Image layer */}
      {layer.type === 'image' && (() => {
        const l = layer as ImageLayer;
        return (
          <Section title="Изображение">
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
