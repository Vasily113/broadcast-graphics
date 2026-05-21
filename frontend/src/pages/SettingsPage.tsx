import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, Plus, Trash2, Copy, Check, RefreshCw } from 'lucide-react';

// ── Display modes ─────────────────────────────────────────────────────────────
const DISPLAY_MODES = [
  { id: 'HD1080i50',   label: '1080i 50'    },
  { id: 'HD1080i5994', label: '1080i 59.94' },
  { id: 'HD1080i6000', label: '1080i 60'    },
  { id: 'HD1080p2398', label: '1080p 23.98' },
  { id: 'HD1080p24',   label: '1080p 24'    },
  { id: 'HD1080p25',   label: '1080p 25'    },
  { id: 'HD1080p2997', label: '1080p 29.97' },
  { id: 'HD1080p30',   label: '1080p 30'    },
  { id: 'HD1080p50',   label: '1080p 50'    },
  { id: 'HD1080p5994', label: '1080p 59.94' },
  { id: 'HD1080p6000', label: '1080p 60'    },
  { id: 'HD720p50',    label: '720p 50'     },
  { id: 'HD720p5994',  label: '720p 59.94'  },
  { id: 'HD720p60',    label: '720p 60'     },
];

const KEYER_MODES = [
  { id: 'external',  label: 'External (SDI 1 Fill + SDI 2 Key)' },
  { id: 'internal',  label: 'Internal (ключ внутри карты)'       },
  { id: 'fill_only', label: 'Fill only (только SDI 1)'           },
];

// In '2dfd' profile (2 Sub-Devices Full Duplex) the iterator exposes 4 entries:
// [output-A, input-A, output-B, input-B].  Input entries are automatically skipped
// by DoesSupportVideoMode() filtering in the addon, so index 0 → first output pair
// (SDI 1+2) and index 1 → second output pair (SDI 5+6).
const SUB_DEVICES = [
  { index: 0, label: 'Sub-device 0 — SDI 1 (Fill) + SDI 2 (Key)' },
  { index: 1, label: 'Sub-device 1 — SDI 5 (Fill) + SDI 6 (Key)' },
];

export const CHANNEL_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#a855f7', '#ec4899', '#14b8a6',
];

interface Channel {
  id: string;
  name: string;
  device_index: number;
  display_mode: string;
  keyer_mode: string;
  created_at: number;
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      timer.current && clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      title="Скопировать"
      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs bg-surface-700 hover:bg-surface-600 text-gray-400 hover:text-white transition-colors"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      {copied ? 'Скопировано' : 'Копировать'}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/channels');
      setChannels(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createChannel = async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Channel ${channels.length + 1}`,
          device_index: channels.length % 4,
        }),
      });
      const ch: Channel = await r.json();
      setChannels(prev => [...prev, ch]);
    } finally {
      setCreating(false);
    }
  };

  const deleteChannel = async (id: string) => {
    await fetch(`/api/channels/${id}`, { method: 'DELETE' });
    setChannels(prev => prev.filter(c => c.id !== id));
  };

  const updateField = (
    id: string,
    field: 'name' | 'device_index' | 'display_mode' | 'keyer_mode',
    value: string | number,
  ) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    saveTimers.current[id] && clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      await fetch(`/api/channels/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
    }, 600);
  };

  const baseUrl = window.location.origin;

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-surface-800 border-b border-surface-700 flex items-center px-4 gap-3 flex-shrink-0">
        <button onClick={() => navigate('/templates')} className="p-1.5 hover:bg-surface-700 rounded text-gray-400">
          <ArrowLeft size={16} />
        </button>
        <div className="w-px h-5 bg-surface-600" />
        <Settings size={16} className="text-gray-400" />
        <span className="font-semibold text-white text-sm">Каналы</span>
        <div className="flex-1" />
        <button
          onClick={createChannel}
          disabled={creating || channels.length >= 8}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-40 text-white transition-colors"
        >
          {creating ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
          Добавить канал
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <p className="text-xs text-gray-500 mb-6">
          Каждый канал — независимый рендер-поток с собственными настройками DeckLink.
          Запустите один <code className="bg-surface-700 px-1 rounded text-gray-300">decklink-out</code> процесс
          на канал с переменной <code className="bg-surface-700 px-1 rounded text-gray-300">CHANNEL_ID</code>.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-600">
            <RefreshCw size={20} className="animate-spin" />
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-surface-600 rounded-xl text-gray-600">
            <Settings size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Каналы не созданы</p>
            <p className="text-xs mt-1 text-gray-700">Нажмите «Добавить канал» чтобы начать</p>
          </div>
        ) : (
          <div className="space-y-4">
            {channels.map((ch, idx) => {
              const rendererUrl  = `${baseUrl}/renderer.html?channel=${ch.id}`;
              const electronCmd  = `set CHANNEL_ID=${ch.id}&& electron .`;
              const color        = CHANNEL_COLORS[idx % CHANNEL_COLORS.length];
              return (
                <div key={ch.id} className="bg-surface-800 border border-surface-700 rounded-xl p-5">
                  <div className="flex items-start gap-4">
                    {/* Color badge */}
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                      style={{ background: color }}
                    >
                      {idx + 1}
                    </div>

                    <div className="flex-1 min-w-0 space-y-4">
                      {/* Row 1: name + SDI */}
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-36">
                          <label className="block text-xs text-gray-500 mb-1">Название</label>
                          <input
                            type="text"
                            value={ch.name}
                            onChange={e => updateField(ch.id, 'name', e.target.value)}
                            className="w-full bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-accent-500"
                          />
                        </div>
                        <div className="w-52">
                          <label className="block text-xs text-gray-500 mb-1">SDI выход</label>
                          <select
                            value={ch.device_index}
                            onChange={e => updateField(ch.id, 'device_index', Number(e.target.value))}
                            className="w-full bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-accent-500"
                          >
                            {SUB_DEVICES.map(d => (
                              <option key={d.index} value={d.index}>{d.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Row 2: display mode + keyer mode */}
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-36">
                          <label className="block text-xs text-gray-500 mb-1">Формат вывода</label>
                          <select
                            value={ch.display_mode}
                            onChange={e => updateField(ch.id, 'display_mode', e.target.value)}
                            className="w-full bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-accent-500"
                          >
                            <optgroup label="1080 Interlaced">
                              {DISPLAY_MODES.filter(m => m.id.includes('1080i')).map(m => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </optgroup>
                            <optgroup label="1080 Progressive">
                              {DISPLAY_MODES.filter(m => m.id.includes('1080p')).map(m => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </optgroup>
                            <optgroup label="720 Progressive">
                              {DISPLAY_MODES.filter(m => m.id.includes('720p')).map(m => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                        <div className="w-52">
                          <label className="block text-xs text-gray-500 mb-1">Режим кейера</label>
                          <select
                            value={ch.keyer_mode}
                            onChange={e => updateField(ch.id, 'keyer_mode', e.target.value)}
                            className="w-full bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-accent-500"
                          >
                            {KEYER_MODES.map(k => (
                              <option key={k.id} value={k.id}>{k.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Renderer URL */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Renderer URL (OBS / браузер)</label>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 min-w-0 truncate bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-xs text-green-400 font-mono">
                            {rendererUrl}
                          </code>
                          <CopyButton text={rendererUrl} />
                        </div>
                      </div>

                      {/* Electron command */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Запуск decklink-out (Windows CMD / .bat)</label>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 min-w-0 truncate bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-xs text-yellow-400 font-mono">
                            {electronCmd}
                          </code>
                          <CopyButton text={electronCmd} />
                        </div>
                      </div>

                      {/* Channel ID */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Channel ID</label>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 min-w-0 truncate bg-surface-700 border border-surface-600 rounded px-2.5 py-1.5 text-xs text-gray-400 font-mono">
                            {ch.id}
                          </code>
                          <CopyButton text={ch.id} />
                        </div>
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => deleteChannel(ch.id)}
                      title="Удалить канал"
                      className="flex-shrink-0 p-1.5 text-gray-600 hover:text-red-400 hover:bg-surface-700 rounded transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
