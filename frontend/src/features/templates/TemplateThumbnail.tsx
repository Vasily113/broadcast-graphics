import { useEffect, useRef } from 'react';
import { Template, TextLayer, ImageLayer, RectLayer, ClockLayer } from '../../core/schema';

function formatClockThumb(layer: ClockLayer): string {
  const now = Math.floor(Date.now() / 1000);
  let total: number;
  if (layer.mode === 'clock') {
    const d = new Date();
    total = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  } else if (layer.mode === 'countup') {
    total = Math.max(0, now - (layer.startTime ?? now));
  } else {
    total = Math.max(0, (layer.targetTime ?? now) - now);
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (layer.format || 'HH:mm:ss')
    .replace('HH', String(h).padStart(2, '0'))
    .replace('mm', String(m).padStart(2, '0'))
    .replace('ss', String(s).padStart(2, '0'));
}

const THUMB_W = 320;
const THUMB_H = 180;

function resolveThumbVar(
  value: string | { type: 'variable'; variableId: string } | undefined | null,
  vars: Record<string, string>,
  fallback: string
): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value.type === 'variable') return vars[value.variableId] ?? fallback;
  return fallback;
}

function drawThumb(
  ctx: CanvasRenderingContext2D,
  template: Template,
  vars: Record<string, string>,
  images: Map<string, HTMLImageElement>
) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const tw = template.canvas.width || 1920;
  const th = template.canvas.height || 1080;
  const scale = Math.min(W / tw, H / th);
  const offsetX = (W - tw * scale) / 2;
  const offsetY = (H - th * scale) / 2;

  ctx.clearRect(0, 0, W, H);

  // Canvas background fill (letterbox area)
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  // Template background
  const bg = template.canvas.background;
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(offsetX, offsetY, tw * scale, th * scale);
  } else {
    // Checkerboard pattern to indicate transparency
    const cs = 6;
    for (let row = 0; row * cs < th * scale; row++) {
      for (let col = 0; col * cs < tw * scale; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#1a1a1a' : '#222';
        ctx.fillRect(
          offsetX + col * cs, offsetY + row * cs,
          Math.min(cs, tw * scale - col * cs),
          Math.min(cs, th * scale - row * cs)
        );
      }
    }
  }

  const reversed = [...template.layers].reverse();
  for (const layer of reversed) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    const { x, y, width, height } = layer.transform;
    const sx = offsetX + x * scale;
    const sy = offsetY + y * scale;
    const sw = width * scale;
    const sh = height * scale;

    if (layer.type === 'rect') {
      const l = layer as RectLayer;
      ctx.fillStyle = resolveThumbVar(l.fill, vars, '#3a3a3a');
      const r = (l.cornerRadius ?? 0) * scale;
      ctx.beginPath();
      if (r > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(sx, sy, sw, sh, r);
      } else {
        ctx.rect(sx, sy, sw, sh);
      }
      ctx.fill();
      if ((l.borderWidth ?? 0) > 0) {
        ctx.strokeStyle = l.borderColor ?? '#ffffff';
        ctx.lineWidth = l.borderWidth * scale;
        ctx.stroke();
      }
    } else if (layer.type === 'text') {
      const l = layer as TextLayer;
      const content = resolveThumbVar(l.content, vars, '');
      if (content) {
        const fontSize = Math.max(1, (l.style.fontSize ?? 48) * scale);
        ctx.font = `${l.style.fontWeight ?? 'bold'} ${fontSize}px ${l.style.fontFamily ?? 'Arial'}`;
        ctx.fillStyle = resolveThumbVar(l.style.fill, vars, '#ffffff');
        ctx.textBaseline = 'top';
        ctx.beginPath();
        ctx.rect(sx, sy, sw, sh);
        ctx.clip();
        ctx.fillText(content, sx, sy);
      }
    } else if (layer.type === 'clock') {
      const l = layer as ClockLayer;
      const content = formatClockThumb(l);
      const fontSize = Math.max(1, (l.style.fontSize ?? 48) * scale);
      ctx.font = `${l.style.fontWeight ?? 'bold'} ${fontSize}px ${l.style.fontFamily ?? 'Arial'}`;
      ctx.fillStyle = resolveThumbVar(l.style.fill, vars, '#ffffff');
      ctx.textBaseline = 'top';
      ctx.beginPath();
      ctx.rect(sx, sy, sw, sh);
      ctx.clip();
      ctx.fillText(content, sx, sy);
    } else if (layer.type === 'video') {
      // Draw a dark placeholder with a film frame indicator
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = '#1e3a5f';
      ctx.fillRect(sx + 2, sy + 2, sw - 4, sh - 4);
      const cx = sx + sw / 2, cy = sy + sh / 2;
      const r = Math.min(sw, sh) * 0.18;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy - r * 0.8);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.8);
      ctx.closePath();
      ctx.fill();
    } else if (layer.type === 'image') {
      const l = layer as ImageLayer;
      const src = resolveThumbVar(l.src, vars, '');
      const img = images.get(src);
      if (img) {
        ctx.drawImage(img, sx, sy, sw, sh);
      } else {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.fillStyle = '#334155';
        ctx.fillRect(sx + 1, sy + 1, sw - 2, sh - 2);
      }
    }
    ctx.restore();
  }
}

interface Props {
  // Pass templateId to fetch from API, or template directly
  templateId?: string;
  template?: Template | null;
  vars?: Record<string, string>;
  onNeedFull?: () => void;
  width?: number;
  height?: number;
  className?: string;
}

export function TemplateThumbnail({
  templateId,
  template: templateProp,
  vars = {},
  onNeedFull,
  width = THUMB_W,
  height = THUMB_H,
  className = 'w-full h-full object-contain',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onNeedFullRef = useRef(onNeedFull);
  onNeedFullRef.current = onNeedFull;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const render = (template: Template) => {
      const images = new Map<string, HTMLImageElement>();
      drawThumb(ctx, template, vars, images);

      const srcList = template.layers
        .filter(l => l.type === 'image' && l.visible)
        .map(l => resolveThumbVar((l as ImageLayer).src, vars, ''))
        .filter(Boolean);
      if (!srcList.length) return;

      const promises = srcList.map(src => new Promise<void>(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { images.set(src, img); resolve(); };
        img.onerror = () => resolve();
        img.src = src;
      }));

      Promise.all(promises).then(() => {
        if (cancelled || !canvasRef.current) return;
        const c = canvasRef.current.getContext('2d');
        if (c) drawThumb(c, template, vars, images);
      });
    };

    if (templateProp) {
      render(templateProp);
      return () => { cancelled = true; };
    }

    if (templateId) {
      fetch(`/api/templates/${templateId}`)
        .then(r => r.json())
        .then(res => {
          if (cancelled) return;
          const template: Template = res.data;
          if (template?.layers) render(template);
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }

    // No template available yet — ask parent to load
    onNeedFullRef.current?.();
  }, [templateId, templateProp, vars]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
    />
  );
}
