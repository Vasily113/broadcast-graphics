import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { AnimationTrack, EasingType, Keyframe, Layer } from '../../core/schema';

const EASINGS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'power2.out', label: 'Power2 Out' },
  { value: 'power2.in', label: 'Power2 In' },
  { value: 'bounce.out', label: 'Bounce Out' },
  { value: 'elastic.out', label: 'Elastic Out' },
];

interface AnimState {
  enabled: boolean;
  duration: number;
  easing: EasingType;
  useAlpha: boolean;
  alpha: number;
  useX: boolean;
  xOffset: number;
  useY: boolean;
  yOffset: number;
}

const DEFAULT_IN: AnimState = {
  enabled: false, duration: 500, easing: 'power2.out',
  useAlpha: true, alpha: 0, useX: false, xOffset: -50, useY: false, yOffset: 0,
};
const DEFAULT_OUT: AnimState = {
  enabled: false, duration: 300, easing: 'power2.in',
  useAlpha: true, alpha: 0, useX: false, xOffset: 50, useY: false, yOffset: 0,
};

function kfToInState(kf: Keyframe, layer: Layer): AnimState {
  return {
    enabled: true,
    duration: kf.time,
    easing: kf.easing,
    useAlpha: kf.fromProperties?.alpha !== undefined,
    alpha: kf.fromProperties?.alpha ?? 0,
    useX: kf.fromProperties?.x !== undefined,
    xOffset: kf.fromProperties?.x !== undefined ? kf.fromProperties.x - layer.transform.x : -50,
    useY: kf.fromProperties?.y !== undefined,
    yOffset: kf.fromProperties?.y !== undefined ? kf.fromProperties.y - layer.transform.y : 0,
  };
}

function kfToOutState(kf: Keyframe, layer: Layer): AnimState {
  return {
    enabled: true,
    duration: kf.time,
    easing: kf.easing,
    useAlpha: kf.properties.alpha !== undefined,
    alpha: kf.properties.alpha ?? 0,
    useX: kf.properties.x !== undefined,
    xOffset: kf.properties.x !== undefined ? kf.properties.x - layer.transform.x : 50,
    useY: kf.properties.y !== undefined,
    yOffset: kf.properties.y !== undefined ? kf.properties.y - layer.transform.y : 0,
  };
}

function inStateToKeyframe(s: AnimState, layer: Layer): Keyframe {
  const from: Record<string, number> = {};
  const to: Record<string, number> = {};
  if (s.useAlpha) { from.alpha = s.alpha; to.alpha = layer.opacity; }
  if (s.useX) { from.x = layer.transform.x + s.xOffset; to.x = layer.transform.x; }
  if (s.useY) { from.y = layer.transform.y + s.yOffset; to.y = layer.transform.y; }
  return { time: s.duration, easing: s.easing, fromProperties: from, properties: to };
}

function outStateToKeyframe(s: AnimState, layer: Layer): Keyframe {
  const to: Record<string, number> = {};
  if (s.useAlpha) to.alpha = s.alpha;
  if (s.useX) to.x = layer.transform.x + s.xOffset;
  if (s.useY) to.y = layer.transform.y + s.yOffset;
  return { time: s.duration, easing: s.easing, properties: to };
}

function AnimSection({
  label, state, onChange,
}: {
  label: string;
  state: AnimState;
  onChange: (patch: Partial<AnimState>) => void;
}) {
  const s = state;
  const row = 'flex items-center gap-2 text-xs';
  const numInput = 'w-16 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-white focus:outline-none focus:border-accent-500 text-xs';
  const check = 'w-3 h-3 accent-indigo-500 flex-shrink-0';

  return (
    <div className="flex-1 min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-300">{label}</span>
        <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" className={check} checked={s.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Включить
        </label>
      </div>

      {s.enabled && (
        <>
          <div className={row}>
            <span className="text-gray-500 w-20 flex-shrink-0">Длительность</span>
            <input type="number" className={numInput} min={0} step={50} value={s.duration}
              onChange={(e) => onChange({ duration: Number(e.target.value) })} />
            <span className="text-gray-600">ms</span>
          </div>

          <div className={row}>
            <span className="text-gray-500 w-20 flex-shrink-0">Easing</span>
            <select className="flex-1 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
              value={s.easing} onChange={(e) => onChange({ easing: e.target.value as EasingType })}>
              {EASINGS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>

          <div className="border-t border-surface-700 pt-1.5 space-y-1.5">
            <div className={row}>
              <input type="checkbox" className={check} checked={s.useAlpha} onChange={(e) => onChange({ useAlpha: e.target.checked })} />
              <span className="text-gray-400 w-14">Alpha</span>
              {s.useAlpha && (
                <input type="number" className={numInput} min={0} max={1} step={0.1} value={s.alpha}
                  onChange={(e) => onChange({ alpha: Number(e.target.value) })} />
              )}
            </div>
            <div className={row}>
              <input type="checkbox" className={check} checked={s.useX} onChange={(e) => onChange({ useX: e.target.checked })} />
              <span className="text-gray-400 w-14">X смещ.</span>
              {s.useX && (
                <>
                  <input type="number" className={numInput} step={10} value={s.xOffset}
                    onChange={(e) => onChange({ xOffset: Number(e.target.value) })} />
                  <span className="text-gray-600">px</span>
                </>
              )}
            </div>
            <div className={row}>
              <input type="checkbox" className={check} checked={s.useY} onChange={(e) => onChange({ useY: e.target.checked })} />
              <span className="text-gray-400 w-14">Y смещ.</span>
              {s.useY && (
                <>
                  <input type="number" className={numInput} step={10} value={s.yOffset}
                    onChange={(e) => onChange({ yOffset: Number(e.target.value) })} />
                  <span className="text-gray-600">px</span>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AnimationPanel() {
  const { template, selectedLayerIds, setTrack } = useEditorStore();
  const [open, setOpen] = useState(true);

  const layerId = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null;
  const layer = layerId ? template.layers.find((l) => l.id === layerId) ?? null : null;
  const track = layerId ? template.tracks.find((t) => t.layerId === layerId) ?? null : null;

  const [inAnim, setInAnim] = useState<AnimState>(DEFAULT_IN);
  const [outAnim, setOutAnim] = useState<AnimState>(DEFAULT_OUT);

  // Sync from store when selected layer changes
  useEffect(() => {
    if (!layer) return;
    setInAnim(track?.inKeyframes[0] ? kfToInState(track.inKeyframes[0], layer) : { ...DEFAULT_IN });
    setOutAnim(track?.outKeyframes[0] ? kfToOutState(track.outKeyframes[0], layer) : { ...DEFAULT_OUT });
  }, [layerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write to store on every change
  const applyChanges = (nextIn: AnimState, nextOut: AnimState) => {
    if (!layer || !layerId) return;
    const newTrack: AnimationTrack = {
      layerId,
      inKeyframes: nextIn.enabled ? [inStateToKeyframe(nextIn, layer)] : [],
      outKeyframes: nextOut.enabled ? [outStateToKeyframe(nextOut, layer)] : [],
    };
    setTrack(layerId, newTrack.inKeyframes.length + newTrack.outKeyframes.length > 0 ? newTrack : null);
  };

  const updateIn = (patch: Partial<AnimState>) => {
    const next = { ...inAnim, ...patch };
    setInAnim(next);
    applyChanges(next, outAnim);
  };

  const updateOut = (patch: Partial<AnimState>) => {
    const next = { ...outAnim, ...patch };
    setOutAnim(next);
    applyChanges(inAnim, next);
  };

  return (
    <div className="border-t border-surface-700 bg-surface-850 flex-shrink-0" style={{ maxHeight: open ? 220 : 'auto' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-surface-700/40 transition-colors"
      >
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          Анимация
          {layer && <span className="ml-2 normal-case text-gray-600 font-normal">— {layer.name}</span>}
        </span>
        {open ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
      </button>

      {open && (
        <div className="overflow-y-auto" style={{ maxHeight: 188 }}>
          {!layer ? (
            <p className="text-xs text-gray-600 text-center py-4">Выберите один слой</p>
          ) : (
            <div className="flex gap-4 px-3 pb-3 pt-1">
              <AnimSection label="▶ Вход" state={inAnim} onChange={updateIn} />
              <div className="w-px bg-surface-700 flex-shrink-0" />
              <AnimSection label="◀ Выход" state={outAnim} onChange={updateOut} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
