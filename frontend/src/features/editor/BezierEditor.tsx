import { BezierHandle, DEFAULT_BEZIER } from '../../core/schema';
import { NumericInput } from './NumericInput';

export function BezierEditor({
  value,
  onChange,
}: {
  value?: BezierHandle;
  onChange: (v: BezierHandle | undefined) => void;
}) {
  const v = value ?? DEFAULT_BEZIER;
  const size = 100;
  const pad = 8;

  const toSvg = (x: number, y: number) => ({
    sx: pad + x * (size - pad * 2),
    sy: size - pad - y * (size - pad * 2),
  });

  const p0 = toSvg(0, 0);
  const p1 = toSvg(v.cp1x, v.cp1y);
  const p2 = toSvg(v.cp2x, v.cp2y);
  const p3 = toSvg(1, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">Кривая Безье</span>
        <button
          type="button"
          className="text-[10px] text-gray-500 hover:text-white"
          onClick={() => onChange(undefined)}
        >
          Сброс
        </button>
      </div>
      <svg width={size} height={size} className="bg-surface-900 rounded border border-surface-700">
        <line x1={p0.sx} y1={p0.sy} x2={p1.sx} y2={p1.sy} stroke="#4b5563" strokeWidth={1} />
        <line x1={p3.sx} y1={p3.sy} x2={p2.sx} y2={p2.sy} stroke="#4b5563" strokeWidth={1} />
        <path
          d={`M ${p0.sx} ${p0.sy} C ${p1.sx} ${p1.sy}, ${p2.sx} ${p2.sy}, ${p3.sx} ${p3.sy}`}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
        />
        <circle cx={p0.sx} cy={p0.sy} r={3} fill="#6b7280" />
        <circle cx={p3.sx} cy={p3.sy} r={3} fill="#6b7280" />
        <circle cx={p1.sx} cy={p1.sy} r={4} fill="#6366f1" />
        <circle cx={p2.sx} cy={p2.sy} r={4} fill="#6366f1" />
      </svg>
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        {(['cp1x', 'cp1y', 'cp2x', 'cp2y'] as const).map((key) => (
          <label key={key} className="flex items-center gap-1 text-gray-500">
            {key}
            <NumericInput
              min={0}
              max={1}
              step={0.05}
              value={v[key]}
              onChange={(next) => onChange({ ...v, [key]: next })}
              className="w-full bg-surface-700 border border-surface-600 rounded px-1 py-0.5 text-white cursor-ew-resize"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
