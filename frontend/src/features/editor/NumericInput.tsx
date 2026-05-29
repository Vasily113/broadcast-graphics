import { useEffect, useRef, useState } from 'react';

interface NumericInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  title?: string;
}

function clamp(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

function decimalsForStep(step: number): number {
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}

function formatNumber(value: number, step: number): string {
  const decimals = decimalsForStep(step);
  return decimals > 0 ? Number(value.toFixed(decimals)).toString() : Math.round(value).toString();
}

export function NumericInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className = '',
  title,
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => formatNumber(value, step));
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setDraft(formatNumber(value, step));
  }, [value, step]);

  const commit = (raw: string) => {
    const normalized = raw.replace(',', '.');
    if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') {
      setDraft(formatNumber(value, step));
      return;
    }
    const next = Number(normalized);
    if (!Number.isFinite(next)) {
      setDraft(formatNumber(value, step));
      return;
    }
    const clamped = clamp(next, min, max);
    setDraft(formatNumber(clamped, step));
    onChange(clamped);
  };

  const handleChange = (raw: string) => {
    if (!/^-?\d*(?:[.,]\d*)?$/.test(raw)) return;
    setDraft(raw);

    const normalized = raw.replace(',', '.');
    if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') return;

    const next = Number(normalized);
    if (Number.isFinite(next)) onChange(clamp(next, min, max));
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLInputElement>) => {
    if (event.button !== 0) return;

    const input = event.currentTarget;
    const startX = event.clientX;
    const startValue = Number(draft.replace(',', '.'));
    const baseValue = Number.isFinite(startValue) ? startValue : value;
    let didDrag = false;

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!didDrag && Math.abs(dx) < 2) return;
      if (!didDrag) {
        didDrag = true;
        draggingRef.current = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ew-resize';
        input.blur();
      }
      const next = clamp(baseValue + dx * step, min, max);
      setDraft(formatNumber(next, step));
      onChange(next);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (didDrag) {
        setTimeout(() => { draggingRef.current = false; }, 0);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
      }}
      onMouseDown={handleMouseDown}
      className={className}
      title={title}
    />
  );
}
