import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ToastItem = { id: number; message: string; type: 'success' | 'error' };

type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();
let counter = 0;

export function toast(message: string, type: ToastItem['type'] = 'success') {
  const item: ToastItem = { id: ++counter, message, type };
  listeners.forEach((fn) => fn(item));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add = (item: ToastItem) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== item.id)), 2500);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  if (items.length === 0) return null;

  return createPortal(
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontFamily: 'monospace',
            color: '#fff',
            background: t.type === 'success' ? '#16a34a' : '#dc2626',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            animation: 'fadeInUp 0.15s ease',
          }}
        >
          {t.message}
        </div>
      ))}
      <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>,
    document.body
  );
}
