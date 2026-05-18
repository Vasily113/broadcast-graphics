import { useEffect, useRef, useState } from 'react';
import { TemplateRenderer } from '../core/renderer';
import { Template } from '../core/schema';

type Command =
  | { type: 'take'; templateId: string; template: Template; variables: Record<string, string> }
  | { type: 'clear'; templateId: string }
  | { type: 'update'; templateId: string; variables: Record<string, string> };

interface ActiveGraphic {
  renderer: TemplateRenderer;
  canvas: HTMLCanvasElement;
  template: Template;
}

type WsStatus = 'connecting' | 'connected' | 'disconnected';

export function RendererPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Map<string, ActiveGraphic>>(new Map());
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const [activeCount, setActiveCount] = useState(0);

  // Make body transparent so the page can be used as browser source in OBS/vMix
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = 'transparent';
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    const wsRef = { current: null as WebSocket | null };
    const reconnectTimer = { current: null as ReturnType<typeof setTimeout> | null };

    const handleCommand = (cmd: Command) => {
      const container = containerRef.current;
      if (!container) return;

      if (cmd.type === 'take') {
        // If already on air — destroy and recreate (re-take with new data)
        const existing = activeRef.current.get(cmd.templateId);
        if (existing) {
          existing.renderer.destroy();
          existing.canvas.remove();
          activeRef.current.delete(cmd.templateId);
        }

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        container.appendChild(canvas);

        let renderer: TemplateRenderer;
        try {
          renderer = new TemplateRenderer(canvas, cmd.template.canvas.width, cmd.template.canvas.height);
        } catch {
          canvas.remove();
          return;
        }

        renderer.syncTemplate(cmd.template, cmd.variables);
        renderer.playIn(cmd.template);

        activeRef.current.set(cmd.templateId, { renderer, canvas, template: cmd.template });
        setActiveCount(activeRef.current.size);
      }

      if (cmd.type === 'clear') {
        const entry = activeRef.current.get(cmd.templateId);
        if (!entry) return;

        // Remove from map immediately so a re-take can proceed
        activeRef.current.delete(cmd.templateId);
        setActiveCount(activeRef.current.size);

        entry.renderer.playOut(entry.template, () => {
          entry.renderer.destroy();
          entry.canvas.remove();
        });
      }

      if (cmd.type === 'update') {
        const entry = activeRef.current.get(cmd.templateId);
        if (!entry) return;
        entry.renderer.syncTemplate(entry.template, cmd.variables);
      }
    };

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // ?backend=host:port lets OBS connect directly, bypassing the Vite proxy
      const backendParam = new URLSearchParams(window.location.search).get('backend');
      const host = backendParam ?? window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/ws/renderer`);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => setStatus('connected');

      ws.onmessage = (e) => {
        try { handleCommand(JSON.parse(e.data) as Command); } catch {}
      };

      ws.onclose = () => {
        setStatus('disconnected');
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      reconnectTimer.current && clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      activeRef.current.forEach(({ renderer }) => renderer.destroy());
      activeRef.current.clear();
    };
  }, []);

  const statusColor = { connected: '#16a34a', connecting: '#ca8a04', disconnected: '#dc2626' }[status];
  const statusLabel = { connected: '⬤ WS', connecting: '◌ WS', disconnected: '✕ WS' }[status];

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, background: 'transparent', overflow: 'hidden' }}
    >
      {/* Dev HUD — only in development build */}
      {import.meta.env.DEV && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 9999,
          display: 'flex', gap: 6, alignItems: 'center', pointerEvents: 'none',
        }}>
          <span style={{
            padding: '2px 8px', borderRadius: 4,
            fontSize: 11, fontFamily: 'monospace',
            background: statusColor, color: '#fff',
          }}>
            {statusLabel}
          </span>
          {activeCount > 0 && (
            <span style={{
              padding: '2px 8px', borderRadius: 4,
              fontSize: 11, fontFamily: 'monospace',
              background: '#dc2626', color: '#fff',
            }}>
              {activeCount} ON AIR
            </span>
          )}
        </div>
      )}
    </div>
  );
}
