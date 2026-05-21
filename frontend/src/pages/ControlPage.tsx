import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Tv, RefreshCw, ChevronDown, ChevronRight, Zap,
  GripVertical, Plus, X, SkipBack, SkipForward, Square, List, Layers, Monitor, Upload,
  FileDown, FileUp, Copy, Pencil, Trash2, Check, Settings,
} from 'lucide-react';
import { CHANNEL_COLORS } from './SettingsPage';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Template, Variable } from '../core/schema';
import { TemplateThumbnail } from '../features/templates/TemplateThumbnail';

type Command =
  | { type: 'take';   templateId: string; template: Template; variables: Record<string, string>; channelId?: string }
  | { type: 'clear';  templateId: string; channelId?: string }
  | { type: 'update'; templateId: string; variables: Record<string, string>; channelId?: string };

interface Channel { id: string; name: string; device_index: number; display_mode: string; keyer_mode: string; }

type WsStatus = 'connecting' | 'connected' | 'disconnected';

interface TemplateListItem { id: string; name: string; updated_at: number; }
interface FullTemplate extends TemplateListItem { data: Template; }
interface RundownSlot { slotId: string; templateId: string; name: string; vars: Record<string, string>; }
interface RundownData { id: string; name: string; slots: RundownSlot[]; channelId: string | null; created_at: number; updated_at: number; }

// ── Channel badge / selector ──────────────────────────────────────────────────

function ChannelBadge({
  channels, value, onChange,
}: { channels: Channel[]; value: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const idx  = channels.findIndex(c => c.id === value);
  const ch   = idx >= 0 ? channels[idx] : null;
  const color = ch ? CHANNEL_COLORS[idx % CHANNEL_COLORS.length] : '#4b5563';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-surface-700 hover:bg-surface-600 transition-colors"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-white">{ch?.name ?? 'Нет канала'}</span>
        <ChevronDown size={10} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 bg-surface-800 border border-surface-600 rounded-lg shadow-xl z-50 min-w-[180px]">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:bg-surface-700 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-gray-600 flex-shrink-0" />
            Нет канала
          </button>
          {channels.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { onChange(c.id); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-700 transition-colors ${c.id === value ? 'text-white' : 'text-gray-300'}`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }} />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Video variable field (upload + URL in Control panel) ─────────────────────

function ControlVideoField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('Upload failed');
      const { url } = await r.json();
      onChange(url);
    } catch (err) {
      console.error('Video upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/uploads/video.webm"
        className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title="Загрузить видео"
        className="flex-shrink-0 px-1.5 py-1 bg-surface-600 hover:bg-surface-500 disabled:opacity-40 rounded text-gray-300 transition-colors"
      >
        {uploading ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />}
      </button>
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

// ── WebSocket hook ────────────────────────────────────────────────────────────

function useControlWs() {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/control`);
    wsRef.current = ws;
    setStatus('connecting');
    ws.onopen = () => setStatus('connected');
    ws.onclose = () => { setStatus('disconnected'); reconnectTimer.current = setTimeout(connect, 3000); };
    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => { reconnectTimer.current && clearTimeout(reconnectTimer.current); wsRef.current?.close(); };
  }, [connect]);

  const send = useCallback((cmd: Command) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(cmd));
  }, []);

  return { status, send, reconnect: connect };
}

// ── Status badge ─────────────────────────────────────────────────────────────

function WsStatusBadge({ status, onReconnect }: { status: WsStatus; onReconnect: () => void }) {
  const cfg = {
    connected:    { dot: 'bg-green-400',                text: 'Подключено',     color: 'text-green-400'  },
    connecting:   { dot: 'bg-yellow-400 animate-pulse', text: 'Подключение...', color: 'text-yellow-400' },
    disconnected: { dot: 'bg-red-500',                  text: 'Нет связи',      color: 'text-red-400'    },
  }[status];
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className={`text-xs ${cfg.color}`}>{cfg.text}</span>
      {status === 'disconnected' && (
        <button onClick={onReconnect} className="text-gray-500 hover:text-white" title="Переподключиться">
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  item, onAir, onTake, onClear, onUpdate, isSelected, focused, onSelect, onVarsChange,
}: {
  item: TemplateListItem;
  onAir: boolean;
  onTake: (id: string, vars: Record<string, string>) => void;
  onClear: (id: string) => void;
  onUpdate: (id: string, vars: Record<string, string>) => void;
  isSelected: boolean;
  focused: boolean;
  onSelect: (template: Template, vars: Record<string, string>) => void;
  onVarsChange: (vars: Record<string, string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<FullTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAirRef = useRef(onAir);
  useEffect(() => { onAirRef.current = onAir; }, [onAir]);

  const loadFull = async (): Promise<FullTemplate> => {
    if (full) return full;
    setLoading(true);
    try {
      const r = await fetch(`/api/templates/${item.id}`);
      const row: FullTemplate = await r.json();
      setFull(row);
      const defaults: Record<string, string> = {};
      (row.data?.variables ?? []).forEach((v: Variable) => { defaults[v.id] = String(v.defaultValue ?? ''); });
      setVars(defaults);
      return row;
    } finally { setLoading(false); }
  };

  const expand = async () => {
    if (!expanded && !full) await loadFull();
    setExpanded((v) => !v);
  };

  const handleSelect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const row = await loadFull();
    const defaults: Record<string, string> = {};
    (row.data?.variables ?? []).forEach((v: Variable) => { defaults[v.id] = String(v.defaultValue ?? ''); });
    const currentVars = Object.keys(vars).length > 0 ? vars : defaults;
    onSelect(row.data, currentVars);
  };

  const handleVarChange = (id: string, value: string) => {
    const next = { ...vars, [id]: value };
    setVars(next);
    if (onAirRef.current) {
      debounceRef.current && clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onUpdate(item.id, next), 300);
    }
    onVarsChange(next);
  };

  const variables: Variable[] = full?.data?.variables ?? [];

  return (
    <div className={`rounded-xl border transition-colors overflow-hidden ${
      onAir ? 'border-red-500 bg-red-500/5' :
      isSelected ? 'border-accent-500 bg-accent-500/5' :
      'border-surface-600 bg-surface-800 hover:border-surface-500'
    } ${focused && !onAir && !isSelected ? 'ring-2 ring-white/30' : ''}`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2">
        <div
          className="flex-shrink-0 w-24 h-[54px] rounded overflow-hidden bg-surface-700 cursor-pointer ring-0 hover:ring-1 hover:ring-accent-500 transition-all"
          onClick={handleSelect}
          title="Предпросмотр"
        >
          <TemplateThumbnail templateId={item.id} width={192} height={108} className="w-full h-full" />
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={handleSelect}>
          <span className="block font-medium text-white text-sm truncate">{item.name}</span>
          <div className="flex items-center gap-2 mt-0.5">
            {onAir
              ? <span className="px-1.5 py-0.5 bg-red-600 rounded text-[10px] font-bold text-white tracking-widest animate-pulse">ON AIR</span>
              : isSelected
                ? <span className="px-1.5 py-0.5 bg-accent-500/20 rounded text-[10px] text-accent-400">PVW</span>
                : <span className="w-1.5 h-1.5 rounded-full bg-surface-600 inline-block" />
            }
            {onAir && variables.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-green-400" title="Live update активен">
                <Zap size={9} className="fill-green-400" /> Live
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={expand} className="text-gray-600 hover:text-white transition-colors p-1">
            {loading ? <RefreshCw size={13} className="animate-spin" /> : expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            onClick={() => onTake(item.id, vars)}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              onAir ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-accent-500 hover:bg-accent-600 text-white'
            }`}
          >TAKE</button>
          <button
            onClick={() => onClear(item.id)}
            disabled={!onAir}
            className="px-3 py-1.5 rounded text-xs font-medium bg-surface-700 hover:bg-surface-600 disabled:opacity-30 text-gray-300 transition-colors"
          >CLEAR</button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-surface-700 px-3 py-2.5 space-y-2 bg-surface-800/60">
          {variables.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Нет переменных</p>
          ) : (
            variables.map((v) => (
              <div key={v.id} className="flex items-center gap-2">
                <label className="text-xs text-gray-400 w-28 flex-shrink-0 truncate" title={v.label}>{v.label || v.name}</label>
                {v.type === 'color' ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input type="color" value={vars[v.id] ?? String(v.defaultValue)} onChange={(e) => handleVarChange(v.id, e.target.value)}
                      className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
                    <input type="text" value={vars[v.id] ?? String(v.defaultValue)} onChange={(e) => handleVarChange(v.id, e.target.value)}
                      className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500" />
                  </div>
                ) : v.type === 'video' ? (
                  <ControlVideoField
                    value={vars[v.id] ?? String(v.defaultValue)}
                    onChange={(url) => handleVarChange(v.id, url)}
                  />
                ) : (
                  <input type={v.type === 'number' ? 'number' : 'text'} value={vars[v.id] ?? String(v.defaultValue)}
                    onChange={(e) => handleVarChange(v.id, e.target.value)} placeholder={String(v.defaultValue)}
                    className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500" />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


// ── Sortable rundown sidebar item ─────────────────────────────────────────────

function SortableRundownItem({
  rd, isActive, onAirCount, isRenaming, renameVal, rdChColor, rdChIdx, channels,
  rundownsLength, onActivate, onStartRename, onRenameChange, onCommitRename,
  onCancelRename, onDuplicate, onExport, onDelete,
}: {
  rd: RundownData;
  isActive: boolean;
  onAirCount: number;
  isRenaming: boolean;
  renameVal: string;
  rdChColor: string | null;
  rdChIdx: number;
  channels: Channel[];
  rundownsLength: number;
  onActivate: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rd.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      onClick={() => { if (!isRenaming) onActivate(); }}
      className={`group relative flex items-stretch cursor-pointer transition-colors ${
        isActive ? 'bg-accent-500/10 border-l-2 border-accent-500' : 'border-l-2 border-transparent hover:bg-surface-800'
      }`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        className="flex items-center pl-1.5 pr-0.5 text-gray-700 hover:text-gray-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
      >
        <GripVertical size={12} />
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 min-w-0 py-2 pr-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {rdChColor && !isRenaming && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: rdChColor }} title={channels[rdChIdx]?.name} />
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-surface-700 border border-accent-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
            />
          ) : (
            <span className={`flex-1 text-xs truncate ${isActive ? 'text-white font-medium' : 'text-gray-400'}`}>
              {rd.name}
            </span>
          )}
          {onAirCount > 0 && !isRenaming && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title={`${onAirCount} в эфире`} />
          )}
        </div>
        {!isRenaming && (
          <span className="text-[10px] text-gray-600 mt-0.5">
            {rd.slots.length} {rd.slots.length === 1 ? 'слот' : rd.slots.length < 5 ? 'слота' : 'слотов'}
          </span>
        )}
      </div>

      {/* Action buttons (hover / active) */}
      {!isRenaming && (
        <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          <button onClick={(e) => { e.stopPropagation(); onStartRename(); }} title="Переименовать" className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-600 transition-colors">
            <Pencil size={11} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Дублировать" className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-600 transition-colors">
            <Copy size={11} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onExport(); }} title="Экспорт JSON" className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-600 transition-colors">
            <FileDown size={11} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Удалить" disabled={rundownsLength <= 1} className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-surface-600 disabled:opacity-20 transition-colors">
            <Trash2 size={11} />
          </button>
        </div>
      )}
      {isRenaming && (
        <button onClick={(e) => { e.stopPropagation(); onCommitRename(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-green-400 hover:bg-surface-600">
          <Check size={11} />
        </button>
      )}
    </div>
  );
}


// ── Sortable rundown row ──────────────────────────────────────────────────────

function SortableRundownRow({
  slot, index, status, focused, full, expanded,
  onTake, onClear, onRemove, onToggleExpand, onVarChange, onNeedFull, onFocus,
}: {
  slot: RundownSlot;
  index: number;
  status: 'on-air' | 'next' | 'played' | 'pending';
  focused: boolean;
  full: FullTemplate | null;
  expanded: boolean;
  onTake: () => void;
  onClear: () => void;
  onRemove: () => void;
  onToggleExpand: () => void;
  onVarChange: (varId: string, value: string) => void;
  onNeedFull: () => void;
  onFocus: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slot.slotId });
  const variables: Variable[] = full?.data?.variables ?? [];

  return (
    <div
      id={`rd-slot-${slot.slotId}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`rounded-lg border transition-colors overflow-hidden cursor-pointer ${
        status === 'on-air' ? 'border-red-500 bg-red-500/10' :
        status === 'next'   ? 'border-accent-500/60 bg-accent-500/5' :
        status === 'played' ? 'border-surface-700 bg-surface-800/40 opacity-50' :
                              'border-surface-700 bg-surface-800'
      } ${focused && status !== 'on-air' ? 'ring-2 ring-white/30' : ''}`}
      onClick={onFocus}
    >
      {/* Row header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div {...attributes} {...listeners} className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0">
          <GripVertical size={13} />
        </div>

        <div className="flex-shrink-0 w-20 h-[45px] rounded overflow-hidden border border-surface-600 bg-surface-700">
          <TemplateThumbnail
            template={full?.data ?? null}
            vars={slot.vars}
            onNeedFull={onNeedFull}
            width={160}
            height={90}
            className="w-full h-full"
          />
        </div>

        <span className="text-xs w-4 flex-shrink-0 text-center" style={{ color: focused ? '#e2e8f0' : 'transparent' }}>▶</span>
        <span className="text-xs text-gray-500 w-4 flex-shrink-0 text-center">{index + 1}</span>
        <span className="flex-1 text-sm text-white truncate">{slot.name}</span>

        {status === 'on-air' && (
          <span className="px-2 py-0.5 bg-red-600 rounded text-xs font-bold text-white tracking-widest animate-pulse flex-shrink-0">ON AIR</span>
        )}
        {status === 'on-air' && variables.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-green-400 flex-shrink-0" title="Live update активен">
            <Zap size={11} className="fill-green-400" /> Live
          </span>
        )}
        {status === 'next' && (
          <span className="px-2 py-0.5 bg-accent-500/20 rounded text-xs text-accent-400 flex-shrink-0">NEXT</span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          className="text-gray-600 hover:text-gray-300 flex-shrink-0 transition-colors"
          title="Переменные"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        {status === 'on-air' ? (
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} className="px-2.5 py-1 rounded text-xs font-bold flex-shrink-0 bg-red-600 hover:bg-red-500 text-white transition-colors">CLEAR</button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); onTake(); }} className="px-2.5 py-1 rounded text-xs font-bold flex-shrink-0 bg-accent-500 hover:bg-accent-600 text-white transition-colors">TAKE</button>
        )}

        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-gray-600 hover:text-red-400 flex-shrink-0 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Variable panel */}
      {expanded && (
        <div className="border-t border-surface-700 px-3 py-2.5 bg-surface-800/60 space-y-2">
          {full === null ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <RefreshCw size={11} className="animate-spin" /> Загрузка...
            </div>
          ) : variables.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Нет переменных</p>
          ) : (
            variables.map((v) => {
              const val = slot.vars[v.id] ?? String(v.defaultValue ?? '');
              return (
                <div key={v.id} className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 w-24 flex-shrink-0 truncate" title={v.label || v.name}>
                    {v.label || v.name}
                  </label>
                  {v.type === 'color' ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input type="color" value={val} onChange={(e) => onVarChange(v.id, e.target.value)}
                        className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
                      <input type="text" value={val} onChange={(e) => onVarChange(v.id, e.target.value)}
                        className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500" />
                    </div>
                  ) : v.type === 'video' ? (
                    <ControlVideoField value={val} onChange={(url) => onVarChange(v.id, url)} />
                  ) : (
                    <input
                      type={v.type === 'number' ? 'number' : 'text'}
                      value={val}
                      onChange={(e) => onVarChange(v.id, e.target.value)}
                      placeholder={String(v.defaultValue ?? '')}
                      className="flex-1 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ControlPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'templates' | 'rundown'>('templates');
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [onAirSet, setOnAirSet] = useState<Set<string>>(new Set());
  const [fullCache, setFullCache] = useState<Record<string, FullTemplate>>({});
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tmplChannelId, setTmplChannelId] = useState<string | null>(null);
  const { status, send, reconnect } = useControlWs();

  // ── Preview panel ───────────────────────────────────────────────────────
  const previewRef = useRef<HTMLIFrameElement>(null);
  const iframeReadyRef = useRef(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const previewIdRef = useRef<string | null>(null);
  const pendingPreviewRef = useRef<{ template: Template; vars: Record<string, string> } | null>(null);

  const doTakePreview = useCallback((template: Template, vars: Record<string, string>) => {
    previewRef.current?.contentWindow?.postMessage(
      { type: 'take', templateId: '__preview__', template, variables: vars }, '*'
    );
  }, []);

  const selectPreview = useCallback((id: string, name: string, template: Template, vars: Record<string, string>) => {
    setPreviewId(id);
    setPreviewName(name);
    previewIdRef.current = id;
    if (iframeReadyRef.current) {
      doTakePreview(template, vars);
    } else {
      pendingPreviewRef.current = { template, vars };
    }
  }, [doTakePreview]);

  const livePreviewUpdate = useCallback((id: string, vars: Record<string, string>) => {
    if (id !== previewIdRef.current) return;
    previewRef.current?.contentWindow?.postMessage(
      { type: 'update', templateId: '__preview__', variables: vars }, '*'
    );
  }, []);

  // ── Template tab keyboard focus ─────────────────────────────────────────
  const [tmplFocusIdx, setTmplFocusIdx] = useState(0);

  useEffect(() => {
    if (templates.length > 0) setTmplFocusIdx((i) => Math.min(i, templates.length - 1));
  }, [templates.length]);

  useEffect(() => {
    if (tab !== 'templates' || templates.length === 0) return;
    document.getElementById(`tmpl-card-${templates[tmplFocusIdx]?.id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tmplFocusIdx, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Template tab state ──────────────────────────────────────────────────
  const handleTake = useCallback(async (id: string, vars: Record<string, string>) => {
    const r = await fetch(`/api/templates/${id}`);
    const fresh = await r.json();
    setFullCache((s) => ({ ...s, [id]: fresh }));
    send({ type: 'take', templateId: id, template: fresh.data, variables: vars, channelId: tmplChannelId ?? undefined });
    setOnAirSet((s) => new Set(s).add(id));
  }, [send, tmplChannelId]);

  const handleClear = useCallback((id: string) => {
    send({ type: 'clear', templateId: id, channelId: tmplChannelId ?? undefined });
    setOnAirSet((s) => { const n = new Set(s); n.delete(id); return n; });
  }, [send, tmplChannelId]);

  const handleUpdate = useCallback((id: string, vars: Record<string, string>) => {
    send({ type: 'update', templateId: id, variables: vars, channelId: tmplChannelId ?? undefined });
  }, [send, tmplChannelId]);

  useEffect(() => {
    fetch('/api/templates').then((r) => r.json()).then(setTemplates);
  }, []);

  useEffect(() => {
    fetch('/api/channels').then(r => r.json()).then((list: Channel[]) => {
      setChannels(list);
      if (list.length > 0) setTmplChannelId(prev => prev ?? list[0].id);
    });
  }, []);

  // ── Rundown management state ────────────────────────────────────────────
  const [rundowns, setRundowns] = useState<RundownData[]>([]);
  const [activeRundownId, setActiveRundownId] = useState<string | null>(null);
  const [loadingRundowns, setLoadingRundowns] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Derived: active rundown's slots (backward-compat alias)
  const activeRundown = rundowns.find(r => r.id === activeRundownId) ?? null;
  const rundown = activeRundown?.slots ?? [];

  // Proxy setter: updates slots in the active rundown inside the rundowns array
  const setRundown = useCallback((updater: RundownSlot[] | ((prev: RundownSlot[]) => RundownSlot[])) => {
    setRundowns(prev => prev.map(r => {
      if (r.id !== activeRundownId) return r;
      const newSlots = typeof updater === 'function' ? updater(r.slots) : updater;
      return { ...r, slots: newSlots, updated_at: Math.floor(Date.now() / 1000) };
    }));
  }, [activeRundownId]);

  // Load rundowns from backend on mount
  useEffect(() => {
    setLoadingRundowns(true);
    fetch('/api/rundowns')
      .then(r => r.json())
      .then(async (list: RundownData[]) => {
        if (list.length === 0) {
          // Auto-create first rundown
          const r = await fetch('/api/rundowns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Rundown 1', slots: [] }),
          });
          const created: RundownData = await r.json();
          setRundowns([created]);
          setActiveRundownId(created.id);
        } else {
          setRundowns(list);
          setActiveRundownId(list[0].id);
        }
      })
      .finally(() => setLoadingRundowns(false));
  }, []);

  // Auto-save active rundown's slots to backend (debounced 500ms)
  useEffect(() => {
    if (!activeRundownId || loadingRundowns) return;
    saveTimerRef.current && clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const rd = rundowns.find(r => r.id === activeRundownId);
      if (!rd) return;
      await fetch(`/api/rundowns/${activeRundownId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rd.name, slots: rd.slots }),
      });
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rundowns, activeRundownId]);

  // ── Rundown CRUD actions ────────────────────────────────────────────────
  const createRundown = useCallback(async () => {
    const name = `Rundown ${rundowns.length + 1}`;
    const r = await fetch('/api/rundowns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slots: [] }),
    });
    const created: RundownData = await r.json();
    setRundowns(prev => [created, ...prev]);
    setActiveRundownId(created.id);
  }, [rundowns.length]);

  const deleteRundown = useCallback(async (id: string) => {
    if (rundowns.length <= 1) return;
    await fetch(`/api/rundowns/${id}`, { method: 'DELETE' });
    setRundowns(prev => {
      const next = prev.filter(r => r.id !== id);
      if (activeRundownId === id) setActiveRundownId(next[0]?.id ?? null);
      return next;
    });
  }, [rundowns.length, activeRundownId]);

  const duplicateRundown = useCallback(async (id: string) => {
    const src = rundowns.find(r => r.id === id);
    if (!src) return;
    const r = await fetch('/api/rundowns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: src.name + ' (копия)',
        slots: src.slots.map(s => ({ ...s, slotId: crypto.randomUUID() })),
      }),
    });
    const created: RundownData = await r.json();
    setRundowns(prev => [created, ...prev]);
    setActiveRundownId(created.id);
  }, [rundowns]);

  const commitRename = useCallback(async (id: string) => {
    const trimmed = renameVal.trim();
    if (!trimmed) { setRenamingId(null); return; }
    await fetch(`/api/rundowns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    setRundowns(prev => prev.map(r => r.id === id ? { ...r, name: trimmed } : r));
    setRenamingId(null);
  }, [renameVal]);

  const exportRundown = useCallback((id: string) => {
    const rd = rundowns.find(r => r.id === id);
    if (!rd) return;
    const blob = new Blob([JSON.stringify(rd, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rd.name.replace(/[^a-z0-9а-яё]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rundowns]);

  const importRundown = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<RundownData>;
      const r = await fetch('/api/rundowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name ?? 'Импортированный rundown',
          slots: (data.slots ?? []).map(s => ({ ...s, slotId: crypto.randomUUID() })),
        }),
      });
      const created: RundownData = await r.json();
      setRundowns(prev => [created, ...prev]);
      setActiveRundownId(created.id);
    } catch (err) {
      console.error('Import error:', err);
    }
  }, []);

  // ── Rundown slot state ──────────────────────────────────────────────────
  const [rdOnAirSet, setRdOnAirSet] = useState<Set<string>>(new Set());
  const [rdFocusIdx, setRdFocusIdx] = useState(0);

  // Clamp focus when rundown changes
  useEffect(() => {
    if (rundown.length > 0) setRdFocusIdx(i => Math.min(i, rundown.length - 1));
  }, [rundown.length]);

  // Reset focus when switching rundowns
  useEffect(() => {
    setRdFocusIdx(0);
  }, [activeRundownId]);

  // Scroll focused item into view
  useEffect(() => {
    if (rdFocusIdx >= 0 && rundown[rdFocusIdx]) {
      document.getElementById(`rd-slot-${rundown[rdFocusIdx].slotId}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [rdFocusIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());
  const liveUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rdFetchTemplate = useCallback(async (templateId: string): Promise<FullTemplate> => {
    if (fullCache[templateId]) return fullCache[templateId];
    const r = await fetch(`/api/templates/${templateId}`);
    const data = await r.json();
    setFullCache((s) => ({ ...s, [templateId]: data }));
    return data;
  }, [fullCache]);

  const tmplTakeAt = useCallback(async (index: number) => {
    if (index < 0 || index >= templates.length) return;
    const item = templates[index];
    const full = fullCache[item.id] ?? await rdFetchTemplate(item.id);
    const vars: Record<string, string> = {};
    (full.data?.variables ?? []).forEach((v: Variable) => { vars[v.id] = String(v.defaultValue ?? ''); });
    await handleTake(item.id, vars);
  }, [templates, fullCache, rdFetchTemplate, handleTake]);

  const toggleSlotExpand = useCallback((slotId: string) => {
    setExpandedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) { next.delete(slotId); return next; }
      next.add(slotId);
      return next;
    });
    const slot = rundown.find((s) => s.slotId === slotId);
    if (slot && !fullCache[slot.templateId]) rdFetchTemplate(slot.templateId);
  }, [rundown, fullCache, rdFetchTemplate]);

  const updateSlotVar = useCallback((slotId: string, varId: string, value: string) => {
    setRundown((prev) => prev.map((s) =>
      s.slotId === slotId ? { ...s, vars: { ...s.vars, [varId]: value } } : s
    ));

    if (!rdOnAirSet.has(slotId)) return;
    const slot = rundown.find((s) => s.slotId === slotId);
    if (!slot) return;
    const full = fullCache[slot.templateId];
    if (!full) return;

    liveUpdateTimer.current && clearTimeout(liveUpdateTimer.current);
    liveUpdateTimer.current = setTimeout(() => {
      const vars: Record<string, string> = {};
      (full.data?.variables ?? []).forEach((v: Variable) => {
        vars[v.id] = slot.vars[v.id] ?? String(v.defaultValue ?? '');
      });
      vars[varId] = value;
      send({ type: 'update', templateId: slotId, variables: vars, channelId: activeRundown?.channelId ?? undefined });
    }, 300);
  }, [rundown, rdOnAirSet, fullCache, send, setRundown, activeRundown]);

  const setRundownChannel = useCallback((id: string, channelId: string | null) => {
    setRundowns(prev => prev.map(r => r.id === id ? { ...r, channelId } : r));
    fetch(`/api/rundowns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    });
  }, []);

  const rdTakeAt = useCallback(async (index: number) => {
    if (index < 0 || index >= rundown.length) return;
    const slot = rundown[index];
    const r = await fetch(`/api/templates/${slot.templateId}`);
    const full: FullTemplate = await r.json();
    setFullCache((s) => ({ ...s, [slot.templateId]: full }));
    const vars: Record<string, string> = {};
    (full.data?.variables ?? []).forEach((v: Variable) => {
      vars[v.id] = slot.vars[v.id] ?? String(v.defaultValue ?? '');
    });
    const channelId = activeRundown?.channelId ?? undefined;
    send({ type: 'take', templateId: slot.slotId, template: full.data, variables: vars, channelId });
    setOnAirSet((s) => new Set(s).add(slot.slotId));
    setRdOnAirSet((s) => new Set(s).add(slot.slotId));
  }, [rundown, send, activeRundown]);

  const rdClearSlot = useCallback((slotId: string) => {
    const channelId = activeRundown?.channelId ?? undefined;
    send({ type: 'clear', templateId: slotId, channelId });
    setOnAirSet((s) => { const n = new Set(s); n.delete(slotId); return n; });
    setRdOnAirSet((s) => { const n = new Set(s); n.delete(slotId); return n; });
  }, [send, activeRundown]);

  // Keyboard navigation for rundown tab
  useEffect(() => {
    if (tab !== 'rundown') return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setRdFocusIdx(i => Math.min(i + 1, rundown.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setRdFocusIdx(i => Math.max(i - 1, 0));
      } else if (e.key === ' ') {
        e.preventDefault();
        if (rundown.length === 0) return;
        const idx = Math.max(0, Math.min(rdFocusIdx, rundown.length - 1));
        rdTakeAt(idx);
        setRdFocusIdx(Math.min(idx + 1, rundown.length - 1));
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (rundown.length === 0) return;
        const slot = rundown[Math.min(rdFocusIdx, rundown.length - 1)];
        if (slot && rdOnAirSet.has(slot.slotId)) rdClearSlot(slot.slotId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tab, rundown, rdFocusIdx, rdTakeAt, rdOnAirSet, rdClearSlot]);

  const rdClearAll = useCallback(() => {
    const channelId = activeRundown?.channelId ?? undefined;
    rdOnAirSet.forEach((slotId) => {
      send({ type: 'clear', templateId: slotId, channelId });
      setOnAirSet((s) => { const n = new Set(s); n.delete(slotId); return n; });
    });
    setRdOnAirSet(new Set());
  }, [rdOnAirSet, send, activeRundown]);

  // Auto-preview focused rundown slot
  useEffect(() => {
    if (tab !== 'rundown' || rundown.length === 0) return;
    const slot = rundown[Math.min(rdFocusIdx, rundown.length - 1)];
    if (!slot) return;
    const doPreview = (f: FullTemplate) => {
      const vars: Record<string, string> = {};
      (f.data?.variables ?? []).forEach((v: Variable) => { vars[v.id] = slot.vars[v.id] ?? String(v.defaultValue ?? ''); });
      selectPreview(slot.slotId, slot.name, f.data, vars);
    };
    const cached = fullCache[slot.templateId];
    if (cached) { doPreview(cached); return; }
    rdFetchTemplate(slot.templateId).then(doPreview);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rdFocusIdx, rundown.length]);

  const rdRemoveSlot = useCallback((slotId: string) => {
    if (rdOnAirSet.has(slotId)) rdClearSlot(slotId);
    setRundown((prev) => prev.filter((s) => s.slotId !== slotId));
  }, [rdOnAirSet, rdClearSlot, setRundown]);

  const rdHandleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRundown((prev) => {
      const from = prev.findIndex((s) => s.slotId === active.id);
      const to = prev.findIndex((s) => s.slotId === over.id);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, [setRundown]);

  const handleRundownsDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRundowns(prev => {
      const from = prev.findIndex(r => r.id === active.id);
      const to   = prev.findIndex(r => r.id === over.id);
      if (from === -1 || to === -1) return prev;
      const next = arrayMove(prev, from, to);
      fetch('/api/rundowns/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map(r => r.id) }),
      });
      return next;
    });
  }, []);

  // Auto-preview focused template card
  useEffect(() => {
    if (tab !== 'templates' || templates.length === 0) return;
    const item = templates[Math.min(tmplFocusIdx, templates.length - 1)];
    if (!item) return;
    const doPreview = (f: FullTemplate) => {
      const vars: Record<string, string> = {};
      (f.data?.variables ?? []).forEach((v: Variable) => { vars[v.id] = String(v.defaultValue ?? ''); });
      selectPreview(item.id, item.name, f.data, vars);
    };
    const cached = fullCache[item.id];
    if (cached) { doPreview(cached); return; }
    rdFetchTemplate(item.id).then(doPreview);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tmplFocusIdx, templates.length]);

  // Keyboard navigation for templates tab
  useEffect(() => {
    if (tab !== 'templates') return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTmplFocusIdx((i) => Math.min(i + 1, templates.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTmplFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === ' ') {
        e.preventDefault();
        tmplTakeAt(tmplFocusIdx);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const item = templates[tmplFocusIdx];
        if (item && onAirSet.has(item.id)) handleClear(item.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tab, templates, tmplFocusIdx, tmplTakeAt, onAirSet, handleClear]);

  const canNext = rdFocusIdx < rundown.length - 1;
  const canPrev = rdFocusIdx > 0;

  // Count on-air slots across ALL rundowns (for a given rundown in the sidebar)
  const onAirCountForRundown = useCallback((rd: RundownData) => {
    return rd.slots.filter(s => rdOnAirSet.has(s.slotId)).length;
  }, [rdOnAirSet]);

  return (
    <div className="h-screen bg-surface-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 bg-surface-800 border-b border-surface-700 flex items-center px-4 gap-3 flex-shrink-0">
        <button onClick={() => navigate('/templates')} className="p-1.5 hover:bg-surface-700 rounded text-gray-400">
          <ArrowLeft size={16} />
        </button>
        <div className="w-px h-5 bg-surface-600" />
        <Tv size={16} className="text-gray-400" />
        <span className="font-semibold text-white text-sm">Control Panel</span>
        {onAirSet.size > 0 && (
          <span className="px-2 py-0.5 bg-red-600 rounded text-xs font-bold text-white tracking-widest">
            {onAirSet.size} ON AIR
          </span>
        )}
        <div className="flex-1" />
        <button onClick={() => navigate('/settings')} className="p-1.5 hover:bg-surface-700 rounded text-gray-500 hover:text-white" title="Настройки каналов">
          <Settings size={15} />
        </button>
        <WsStatusBadge status={status} onReconnect={reconnect} />
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-surface-700 bg-surface-800 flex-shrink-0">
        <button
          onClick={() => setTab('templates')}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'templates' ? 'border-accent-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Layers size={13} /> Шаблоны
        </button>
        <button
          onClick={() => setTab('rundown')}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'rundown' ? 'border-accent-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <List size={13} /> Rundown
          {rundowns.length > 0 && (
            <span className="px-1.5 py-0.5 bg-surface-600 rounded-full text-gray-400">{rundowns.length}</span>
          )}
        </button>
      </div>

      {/* Body: main tabs + preview panel */}
      <div className="flex-1 flex overflow-hidden min-h-0">

      {/* Main tab content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

      {/* Templates tab */}
      {tab === 'templates' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-700 bg-surface-800/50 flex-shrink-0">
            <span className="text-xs text-gray-600 select-none flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 bg-surface-700 border border-surface-600 rounded text-gray-400" style={{ fontSize: 10 }}>↑↓</kbd>
              <span>навигация</span>
              <kbd className="px-1.5 py-0.5 bg-surface-700 border border-surface-600 rounded text-gray-400" style={{ fontSize: 10 }}>⎵</kbd>
              <span>взять</span>
              <kbd className="px-1.5 py-0.5 bg-surface-700 border border-surface-600 rounded text-gray-400" style={{ fontSize: 10 }}>⌫</kbd>
              <span>убрать</span>
            </span>
            <div className="flex-1" />
            {channels.length > 0 && (
              <ChannelBadge channels={channels} value={tmplChannelId} onChange={setTmplChannelId} />
            )}
            {onAirSet.size > 0 && (
              <>
                <span className="text-xs text-gray-400">{onAirSet.size} в эфире</span>
                <button
                  onClick={() => { onAirSet.forEach(id => handleClear(id)); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-surface-700 hover:bg-surface-600 text-gray-300 transition-colors"
                >
                  <Square size={12} /> CLEAR ALL
                </button>
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {templates.length === 0 ? (
              <div className="text-center py-24 text-gray-600">
                <p className="text-lg">Нет шаблонов</p>
                <button onClick={() => navigate('/templates')} className="mt-3 text-sm text-accent-400 hover:text-accent-300">
                  Перейти к шаблонам →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((t, i) => (
                  <div key={t.id} id={`tmpl-card-${t.id}`} onClick={() => setTmplFocusIdx(i)}>
                    <TemplateCard
                      item={t}
                      onAir={onAirSet.has(t.id)}
                      onTake={handleTake} onClear={handleClear} onUpdate={handleUpdate}
                      isSelected={previewId === t.id}
                      focused={tmplFocusIdx === i}
                      onSelect={(template, vars) => { setTmplFocusIdx(i); selectPreview(t.id, t.name, template, vars); }}
                      onVarsChange={(vars) => livePreviewUpdate(t.id, vars)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rundown tab */}
      {tab === 'rundown' && (
        <div className="flex-1 flex overflow-hidden">

          {/* ── Left sidebar: rundowns list ─────────────────────────────── */}
          <div className="w-52 border-r border-surface-700 bg-surface-950 flex flex-col flex-shrink-0">
            {/* Sidebar header */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-surface-700 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">Rundowns</span>
              {/* Import */}
              <button
                onClick={() => importFileRef.current?.click()}
                title="Импорт из JSON"
                className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-700 transition-colors"
              >
                <FileUp size={13} />
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importRundown(f); e.target.value = ''; }}
              />
              {/* Create */}
              <button
                onClick={createRundown}
                title="Создать rundown"
                className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-700 transition-colors"
              >
                <Plus size={13} />
              </button>
            </div>

            {/* Rundowns list */}
            <div className="flex-1 overflow-y-auto py-1">
              {loadingRundowns ? (
                <div className="flex items-center justify-center py-8 text-gray-600">
                  <RefreshCw size={16} className="animate-spin" />
                </div>
              ) : (
                <DndContext collisionDetection={closestCenter} onDragEnd={handleRundownsDragEnd}>
                  <SortableContext items={rundowns.map(r => r.id)} strategy={verticalListSortingStrategy}>
                    {rundowns.map(rd => {
                      const isActive   = rd.id === activeRundownId;
                      const onAirCount = onAirCountForRundown(rd);
                      const isRenaming = renamingId === rd.id;
                      const rdChIdx    = rd.channelId ? channels.findIndex(c => c.id === rd.channelId) : -1;
                      const rdChColor  = rdChIdx >= 0 ? CHANNEL_COLORS[rdChIdx % CHANNEL_COLORS.length] : null;
                      return (
                        <SortableRundownItem
                          key={rd.id}
                          rd={rd}
                          isActive={isActive}
                          onAirCount={onAirCount}
                          isRenaming={isRenaming}
                          renameVal={renameVal}
                          rdChColor={rdChColor}
                          rdChIdx={rdChIdx}
                          channels={channels}
                          rundownsLength={rundowns.length}
                          onActivate={() => setActiveRundownId(rd.id)}
                          onStartRename={() => { setRenamingId(rd.id); setRenameVal(rd.name); }}
                          onRenameChange={setRenameVal}
                          onCommitRename={() => commitRename(rd.id)}
                          onCancelRename={() => setRenamingId(null)}
                          onDuplicate={() => duplicateRundown(rd.id)}
                          onExport={() => exportRundown(rd.id)}
                          onDelete={() => deleteRundown(rd.id)}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          {/* ── Right panel: active rundown slots ──────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Transport bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-700 bg-surface-800/50 flex-shrink-0">
              <button
                onClick={() => { const i = rdFocusIdx - 1; setRdFocusIdx(Math.max(0, i)); rdTakeAt(Math.max(0, i)); }}
                disabled={!canPrev}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-surface-700 hover:bg-surface-600 disabled:opacity-30 text-gray-300 transition-colors"
                title="Предыдущий"
              >
                <SkipBack size={13} /> PREV
              </button>

              <span className="text-xs text-gray-500 min-w-[3rem] text-center">
                {rdFocusIdx + 1} / {rundown.length || '—'}
              </span>

              <button
                onClick={() => { const i = rdFocusIdx + 1; setRdFocusIdx(Math.min(rundown.length - 1, i)); rdTakeAt(i); }}
                disabled={!canNext}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold bg-accent-500 hover:bg-accent-600 disabled:opacity-30 text-white transition-colors"
                title="Следующий"
              >
                NEXT <SkipForward size={13} />
              </button>

              <button
                onClick={rdClearAll}
                disabled={rdOnAirSet.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-surface-700 hover:bg-surface-600 disabled:opacity-30 text-gray-300 transition-colors"
                title="Убрать всё из эфира"
              >
                <Square size={12} /> CLEAR ALL
              </button>

              {/* Active rundown name + channel */}
              <span className="text-xs text-gray-500 truncate hidden sm:block">
                {activeRundown?.name ?? ''}
              </span>
              {channels.length > 0 && activeRundown && (
                <ChannelBadge
                  channels={channels}
                  value={activeRundown.channelId}
                  onChange={(id) => setRundownChannel(activeRundown.id, id)}
                />
              )}

              <div className="flex-1" />
              <span className="text-xs text-gray-600 select-none hidden sm:flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 bg-surface-700 border border-surface-600 rounded text-gray-400" style={{ fontSize: 10 }}>↑↓</kbd>
                <span>навигация</span>
                <kbd className="px-1.5 py-0.5 bg-surface-700 border border-surface-600 rounded text-gray-400" style={{ fontSize: 10 }}>⎵</kbd>
                <span>взять</span>
                <kbd className="px-1.5 py-0.5 bg-surface-700 border border-surface-600 rounded text-gray-400" style={{ fontSize: 10 }}>⌫</kbd>
                <span>убрать</span>
              </span>
            </div>

            {/* Rundown list */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="max-w-3xl mx-auto space-y-2">
                {rundown.length === 0 ? (
                  <div className="text-center py-16 text-gray-600">
                    <List size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Rundown пустой</p>
                    <p className="text-xs mt-1">Нажмите «+ Добавить» чтобы добавить шаблоны</p>
                  </div>
                ) : (
                  <DndContext collisionDetection={closestCenter} onDragEnd={rdHandleDragEnd}>
                    <SortableContext items={rundown.map((s) => s.slotId)} strategy={verticalListSortingStrategy}>
                      {rundown.map((slot, i) => {
                        const onAir = rdOnAirSet.has(slot.slotId);
                        const slotStatus = onAir ? 'on-air' : i === rdFocusIdx ? 'next' : 'pending';
                        return (
                          <SortableRundownRow
                            key={slot.slotId}
                            slot={slot} index={i}
                            status={slotStatus}
                            focused={i === rdFocusIdx}
                            full={fullCache[slot.templateId] ?? null}
                            expanded={expandedSlots.has(slot.slotId)}
                            onTake={() => { rdTakeAt(i); setRdFocusIdx(Math.min(i + 1, rundown.length - 1)); }}
                            onClear={() => rdClearSlot(slot.slotId)}
                            onRemove={() => rdRemoveSlot(slot.slotId)}
                            onToggleExpand={() => toggleSlotExpand(slot.slotId)}
                            onVarChange={(varId, value) => updateSlotVar(slot.slotId, varId, value)}
                            onNeedFull={() => rdFetchTemplate(slot.templateId)}
                            onFocus={() => setRdFocusIdx(i)}
                          />
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                )}

                {/* Add button */}
                <div className="relative pt-2">
                  <button
                    onClick={() => setShowAddMenu((v) => !v)}
                    className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg border border-dashed border-surface-600 text-gray-500 hover:border-accent-500 hover:text-accent-400 text-sm transition-colors"
                  >
                    <Plus size={14} /> Добавить шаблон
                  </button>

                  {showAddMenu && (
                    <div className="absolute left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-xl shadow-xl z-10 max-h-64 overflow-y-auto">
                      {templates.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-gray-500">Нет шаблонов</p>
                      ) : (
                        templates.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              setRundown((prev) => [...prev, { slotId: crypto.randomUUID(), templateId: t.id, name: t.name, vars: {} }]);
                              setShowAddMenu(false);
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-surface-700 hover:text-white transition-colors"
                          >
                            {t.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      </div>{/* end main tab content */}

      {/* ── Preview panel ────────────────────────────────────────────── */}
      <div className="w-72 xl:w-96 border-l border-surface-700 bg-surface-950 flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-surface-700 flex items-center gap-2 flex-shrink-0">
          <Monitor size={13} className="text-accent-400" />
          <span className="text-xs font-semibold text-white uppercase tracking-wider">Preview</span>
          {previewName && (
            <span className="text-xs text-gray-500 truncate ml-1">— {previewName}</span>
          )}
        </div>

        <div className="p-3 flex-shrink-0">
          <div
            className="relative w-full rounded overflow-hidden border border-surface-700 bg-[#0a0a0f]"
            style={{ paddingBottom: '56.25%' }}
          >
            <iframe
              ref={previewRef}
              src="/renderer.html?preview=1"
              className="absolute inset-0 w-full h-full border-0"
              onLoad={() => {
                iframeReadyRef.current = true;
                if (pendingPreviewRef.current) {
                  doTakePreview(pendingPreviewRef.current.template, pendingPreviewRef.current.vars);
                  pendingPreviewRef.current = null;
                }
              }}
            />
            {!previewId && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-700 pointer-events-none">
                <Monitor size={24} className="mb-2 opacity-30" />
                <p className="text-xs text-center px-4 leading-relaxed">
                  Кликните на шаблон<br />для предпросмотра
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1" />
      </div>

      </div>{/* end body flex row */}
    </div>
  );
}
