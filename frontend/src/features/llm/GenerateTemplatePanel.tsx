import { useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { generateTemplate } from './api';
import { createTemplate } from '../templates/api';

interface GenerateTemplatePanelProps {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function GenerateTemplatePanel({ onCreated, onCancel }: GenerateTemplatePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const result = await generateTemplate(text);
      const created = await createTemplate(result.template.name || 'AI draft', result.template);
      setWarning(result.warnings.join('\n'));
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сгенерировать шаблон');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-accent-500/40 bg-surface-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-accent-400" />
        <h2 className="text-sm font-semibold text-white">AI-генерация шаблона</h2>
        <div className="flex-1" />
        <button onClick={onCancel} className="p-1 hover:bg-surface-700 rounded text-gray-400">
          <X size={14} />
        </button>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-full h-24 bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
        placeholder="Опиши титр: нижняя плашка с именем спикера, спортивный счет, заставка новости..."
      />
      {warning && <p className="mt-2 text-xs text-yellow-400 whitespace-pre-wrap">{warning}</p>}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          onClick={submit}
          disabled={!prompt.trim() || busy}
          className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
        >
          {busy ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
          Сгенерировать
        </button>
      </div>
    </div>
  );
}
