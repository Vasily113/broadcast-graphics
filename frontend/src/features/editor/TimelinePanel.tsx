import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Diamond,
  Folder,
  Pause,
  Play,
  SkipBack,
  Square,
  Trash2,
} from 'lucide-react';
import { useEditorStore } from '../../core/store';
import { EasingType, POSITION_SIZE_LABELS, POSITION_SIZE_PROPS, PositionSizeProp, TimelineAction, TimelineDirector, TimelineKeyframe } from '../../core/schema';
import {
  AnimTargetKind,
  getDirectorForTrack,
  getSortedKeyframes,
  getTimelineTrackKey,
  groupHasPropKey,
  layerHasPropKey,
} from '../../core/timeline';
import { BezierEditor } from './BezierEditor';
import { NumericInput } from './NumericInput';

const EASINGS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Линейная' },
  { value: 'power2.out', label: 'Сглаженная (out)' },
  { value: 'power2.in', label: 'Сглаженная (in)' },
  { value: 'bounce.out', label: 'Отскок' },
  { value: 'elastic.out', label: 'Упругая' },
];

const PX_PER_FRAME = 6;
const LABEL_W = 168;
const ROW_H = 22;
const BEZIER_PANEL_H = 156;

interface TrackRow {
  rowId: string;
  label: string;
  type: 'director' | 'track' | 'action';
  directorId: string;
  director?: TimelineDirector;
  action?: TimelineAction;
  kind?: AnimTargetKind;
  targetId?: string;
  prop?: PositionSizeProp;
  trackKey?: string;
  indent: number;
}

type SelectedKeyTarget = {
  keyframeId: string;
  kind: AnimTargetKind;
  targetId: string;
  prop: PositionSizeProp;
  directorId: string;
};

function buildTrackRows(
  groups: { id: string; name: string; parentId: string | null }[],
  layers: { id: string; name: string; groupId: string | null }[],
  timeline: ReturnType<typeof useEditorStore.getState>['template']['timeline'],
  selectedLayerIds: string[],
  selectedGroupIds: string[],
  selectedDirectorId: string,
): TrackRow[] {
  const rows: TrackRow[] = [];
  const normalized = timeline;
  const selectedLayers = new Set(selectedLayerIds);
  const selectedGroups = new Set(selectedGroupIds);
  const groupsByParent = new Map<string | null, typeof groups>();
  groups.forEach((g) => {
    const k = g.parentId;
    if (!groupsByParent.has(k)) groupsByParent.set(k, []);
    groupsByParent.get(k)!.push(g);
  });
  const layersByGroup = new Map<string | null, typeof layers>();
  layers.forEach((l) => {
    const k = l.groupId;
    if (!layersByGroup.has(k)) layersByGroup.set(k, []);
    layersByGroup.get(k)!.push(l);
  });

  const propBelongsToDirector = (
    kind: AnimTargetKind,
    targetId: string,
    prop: PositionSizeProp,
    directorId: string,
  ) => getDirectorForTrack(normalized, kind, targetId, prop).id === directorId;

  const walkGroups = (parentId: string | null, indent: number, directorId: string) => {
    (groupsByParent.get(parentId) ?? []).forEach((g) => {
      const keyedProps = POSITION_SIZE_PROPS.filter((prop) =>
        groupHasPropKey(normalized, g.id, prop) && propBelongsToDirector('group', g.id, prop, directorId),
      );
      if (keyedProps.length > 0 || (selectedGroups.has(g.id) && directorId === selectedDirectorId)) {
        rows.push({
          rowId: `d-${directorId}-g-${g.id}`,
          label: g.name,
          type: 'track',
          directorId,
          kind: 'group',
          targetId: g.id,
          indent,
        });
        keyedProps.forEach((prop) => {
          const trackKey = getTimelineTrackKey('group', g.id, prop);
          rows.push({
            rowId: `d-${directorId}-g-${g.id}-${prop}`,
            label: POSITION_SIZE_LABELS[prop],
            type: 'track',
            directorId,
            kind: 'group',
            targetId: g.id,
            prop,
            trackKey,
            indent: indent + 1,
          });
        });
      }
      walkGroups(g.id, indent + 1, directorId);
      (layersByGroup.get(g.id) ?? []).forEach((l) => addLayer(l, indent + 1, directorId));
    });
  };

  const addLayer = (l: (typeof layers)[0], indent: number, directorId: string) => {
    const keyedProps = POSITION_SIZE_PROPS.filter((prop) =>
      layerHasPropKey(normalized, l.id, prop) && propBelongsToDirector('layer', l.id, prop, directorId),
    );
    if (keyedProps.length === 0 && !(selectedLayers.has(l.id) && directorId === selectedDirectorId)) return;
    rows.push({
      rowId: `d-${directorId}-l-${l.id}`,
      label: l.name,
      type: 'track',
      directorId,
      kind: 'layer',
      targetId: l.id,
      indent,
    });
    keyedProps.forEach((prop) => {
      const trackKey = getTimelineTrackKey('layer', l.id, prop);
      rows.push({
        rowId: `d-${directorId}-l-${l.id}-${prop}`,
        label: POSITION_SIZE_LABELS[prop],
        type: 'track',
        directorId,
        kind: 'layer',
        targetId: l.id,
        prop,
        trackKey,
        indent: indent + 1,
      });
    });
  };

  normalized.directors.forEach((director) => {
    rows.push({
      rowId: `d-${director.id}`,
      label: director.name,
      type: 'director',
      directorId: director.id,
      director,
      indent: 0,
    });
    normalized.actions
      .filter((action) => action.directorId === director.id)
      .forEach((action, index) => {
        rows.push({
          rowId: `d-${director.id}-a-${action.id}`,
          label: `Action ${index + 1}`,
          type: 'action',
          directorId: director.id,
          action,
          indent: 1,
        });
      });
    walkGroups(null, 1, director.id);
    (layersByGroup.get(null) ?? []).forEach((l) => addLayer(l, 1, director.id));
  });
  return rows;
}

export function TimelinePanel() {
  const {
    template,
    selectedLayerIds,
    selectedGroupIds,
    timelinePlayhead,
    timelineDirectorPlayheads,
    selectedTimelineKeyframeId,
    selectedTimelineDirectorId,
    selectedTimelineActionId,
    timelinePlaying,
    timelineEasing,
    setTimelinePlayhead,
    setTimelineDuration,
    setTimelinePlaying,
    setTimelineEasing,
    selectTimelineKeyframe,
    selectTimelineDirector,
    selectTimelineAction,
    addTimelineDirector,
    addTimelineActionToSelectedDirector,
    deleteTimelineAction,
    deleteTimelineDirector,
    updateTimelineDirector,
    moveTimelineDirector,
    moveTimelineTrackToDirector,
    deleteTimelineKeyframeTarget,
    setTimelineKeyframeEasing,
    setTimelineKeyframeBezier,
    moveTimelineKeyframeTarget,
  } = useEditorStore();

  const [open, setOpen] = useState(true);
  const [bezierOpen, setBezierOpen] = useState(false);
  const [draggedRow, setDraggedRow] = useState<TrackRow | null>(null);
  const [selectedKeyTarget, setSelectedKeyTarget] = useState<SelectedKeyTarget | null>(null);
  const TIMELINE_HEIGHT_KEY = 'editor-timeline-height';
  const MIN_PANEL_H = 120;
  const MAX_PANEL_H = 720;
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(TIMELINE_HEIGHT_KEY);
    const n = saved ? Number(saved) : 300;
    return Number.isFinite(n) ? Math.min(MAX_PANEL_H, Math.max(MIN_PANEL_H, n)) : 300;
  });
  const panelHeightRef = useRef(panelHeight);
  panelHeightRef.current = panelHeight;
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'playhead' | 'scrub' | 'key' | 'resize' | null>(null);
  const dragKeyIdRef = useRef<string | null>(null);
  const dragKeyTargetRef = useRef<SelectedKeyTarget | null>(null);
  const dragKeyOffsetRef = useRef(0);

  const { timeline } = template;
  const groups = template.groups ?? [];
  const sortedKeys = getSortedKeyframes(timeline);
  const selectedKey = selectedTimelineKeyframeId
    ? timeline.keyframes.find((k) => k.id === selectedTimelineKeyframeId)
    : null;
  const timelineWidth = (timeline.durationFrames + 1) * PX_PER_FRAME;

  const trackRows = useMemo(
    () => buildTrackRows(groups, template.layers, timeline, selectedLayerIds, selectedGroupIds, selectedTimelineDirectorId),
    [groups, template.layers, timeline, selectedLayerIds, selectedGroupIds, selectedTimelineDirectorId],
  );
  const directorById = useMemo(
    () => new Map(timeline.directors.map((director) => [director.id, director])),
    [timeline.directors],
  );
  const selectedDirector = timeline.directors.find((director) => director.id === selectedTimelineDirectorId)
    ?? timeline.directors[0];
  const directorCursorLeft = (director: TimelineDirector) =>
    (director.offsetFrames + (timelineDirectorPlayheads[director.id] ?? 0)) * PX_PER_FRAME;

  useEffect(() => {
    if (!selectedTimelineKeyframeId) setSelectedKeyTarget(null);
  }, [selectedTimelineKeyframeId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement
        && (
          activeElement.tagName === 'INPUT'
          || activeElement.tagName === 'TEXTAREA'
          || activeElement.tagName === 'SELECT'
          || activeElement.isContentEditable
        )
      ) {
        return;
      }
      if (selectedKeyTarget) {
        e.preventDefault();
        deleteTimelineKeyframeTarget(selectedKeyTarget.keyframeId, selectedKeyTarget);
        setSelectedKeyTarget(null);
        return;
      }
      if (selectedTimelineActionId) {
        e.preventDefault();
        deleteTimelineAction(selectedTimelineActionId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedKeyTarget, selectedTimelineActionId, deleteTimelineAction, deleteTimelineKeyframeTarget]);

  const frameFromClientX = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return timelinePlayhead;
      const x = clientX - el.getBoundingClientRect().left + (scrollRef.current?.scrollLeft ?? 0);
      return Math.max(0, Math.min(timeline.durationFrames, Math.round(x / PX_PER_FRAME)));
    },
    [timeline.durationFrames, timelinePlayhead],
  );

  useEffect(() => {
    if (!timelinePlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const state = useEditorStore.getState();
      state.advanceTimeline(dt * state.template.timeline.fps);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timelinePlaying]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current === 'resize' && resizeRef.current) {
        const dy = resizeRef.current.startY - e.clientY;
        const h = Math.min(MAX_PANEL_H, Math.max(MIN_PANEL_H, resizeRef.current.startH + dy));
        setPanelHeight(h);
        return;
      }
      if (dragRef.current === 'key' && dragKeyIdRef.current && dragKeyTargetRef.current) {
        moveTimelineKeyframeTarget(
          dragKeyIdRef.current,
          dragKeyTargetRef.current,
          frameFromClientX(e.clientX) - dragKeyOffsetRef.current,
        );
        const nextKeyframeId = useEditorStore.getState().selectedTimelineKeyframeId;
        if (nextKeyframeId) {
          dragKeyIdRef.current = nextKeyframeId;
          dragKeyTargetRef.current = {
            ...dragKeyTargetRef.current,
            keyframeId: nextKeyframeId,
          };
        }
        return;
      }
      if (!dragRef.current) return;
      setTimelinePlayhead(frameFromClientX(e.clientX));
    };
    const onUp = () => {
      if (resizeRef.current) {
        localStorage.setItem(TIMELINE_HEIGHT_KEY, String(panelHeightRef.current));
        resizeRef.current = null;
      }
      dragRef.current = null;
      dragKeyIdRef.current = null;
      dragKeyTargetRef.current = null;
      dragKeyOffsetRef.current = 0;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [frameFromClientX, setTimelinePlayhead, moveTimelineKeyframeTarget]);

  const keysOnRow = (row: TrackRow) => {
    if (row.type !== 'track' || !row.kind || !row.targetId) return [];
    const kind = row.kind;
    const targetId = row.targetId;
    if (!row.prop) return [];
    const prop = row.prop;
    return sortedKeys.filter((kf) => {
      if (kind === 'layer') return kf.layers[targetId]?.[prop] !== undefined;
      return kf.groups[targetId]?.[prop] !== undefined;
    });
  };

  const valueOnRow = (row: TrackRow, kf: TimelineKeyframe) => {
    if (!row.prop || !row.kind || !row.targetId) return undefined;
    const bag = row.kind === 'layer' ? kf.layers[row.targetId] : kf.groups[row.targetId];
    return bag?.[row.prop];
  };

  const animatedSegmentsOnRow = (row: TrackRow) => {
    if (!row.prop) return [];
    const rowKeys = keysOnRow(row);
    return rowKeys.flatMap((kf, i) => {
      if (i === 0) return [];
      const prev = rowKeys[i - 1];
      const fromValue = valueOnRow(row, prev);
      const toValue = valueOnRow(row, kf);
      if (fromValue === undefined || toValue === undefined || Object.is(fromValue, toValue)) return [];
      const director = timeline.directors.find((d) => d.id === row.directorId);
      const offset = director?.offsetFrames ?? 0;
      const left = (prev.frame + offset) * PX_PER_FRAME;
      const width = (kf.frame - prev.frame) * PX_PER_FRAME;
      if (width <= 0) return [];
      return [{ id: `${prev.id}-${kf.id}`, left, width }];
    });
  };

  const hasKeys = (row: TrackRow) => {
    if (row.type !== 'track') return false;
    if (!row.kind || !row.targetId) return false;
    const kind = row.kind;
    const targetId = row.targetId;
    if (!row.prop) {
      if (kind === 'layer') return sortedKeys.some((kf) => kf.layers[targetId]);
      return sortedKeys.some((kf) => kf.groups[targetId]);
    }
    if (kind === 'layer') return layerHasPropKey(timeline, targetId, row.prop);
    return groupHasPropKey(timeline, targetId, row.prop);
  };

  const handleRowDrop = (targetRow: TrackRow) => {
    if (!draggedRow) return;
    if (draggedRow.type === 'director' && targetRow.type === 'director') {
      const toIndex = timeline.directors.findIndex((director) => director.id === targetRow.directorId);
      moveTimelineDirector(draggedRow.directorId, toIndex);
    } else if (draggedRow.trackKey && targetRow.type === 'director') {
      moveTimelineTrackToDirector(draggedRow.trackKey, targetRow.directorId);
    } else if (draggedRow.type === 'track' && draggedRow.kind && draggedRow.targetId && targetRow.type === 'director') {
      POSITION_SIZE_PROPS.forEach((prop) => {
        const hasProp = draggedRow.kind === 'layer'
          ? layerHasPropKey(timeline, draggedRow.targetId!, prop)
          : groupHasPropKey(timeline, draggedRow.targetId!, prop);
        if (hasProp) {
          moveTimelineTrackToDirector(
            getTimelineTrackKey(draggedRow.kind!, draggedRow.targetId!, prop),
            targetRow.directorId,
          );
        }
      });
    }
    setDraggedRow(null);
  };

  return (
    <div className="border-t border-surface-700 bg-surface-850 flex-shrink-0 flex flex-col relative" style={{ height: open ? panelHeight : 36 }}>
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-30 hover:bg-accent-500/50 active:bg-accent-500/70"
          onMouseDown={(e) => {
            e.preventDefault();
            dragRef.current = 'resize';
            resizeRef.current = { startY: e.clientY, startH: panelHeight };
          }}
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-surface-700/40 flex-shrink-0"
      >
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          Таймлайн — кадр {timelinePlayhead} / {timeline.durationFrames}
        </span>
        {open ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
      </button>

      {open && (
        <>
          <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-surface-700 flex-shrink-0">
            <button type="button" onClick={() => { setTimelinePlaying(false); setTimelinePlayhead(0); }} className="p-1.5 rounded hover:bg-surface-700 text-gray-400"><SkipBack size={14} /></button>
            <button type="button" onClick={() => setTimelinePlaying(!timelinePlaying)} className="p-1.5 rounded hover:bg-surface-700 text-gray-300">{timelinePlaying ? <Pause size={14} /> : <Play size={14} />}</button>
            <button type="button" onClick={() => { setTimelinePlaying(false); setTimelinePlayhead(0); }} className="p-1.5 rounded hover:bg-surface-700 text-gray-400"><Square size={14} /></button>
            {selectedKeyTarget && (
              <button
                type="button"
                onClick={() => {
                  deleteTimelineKeyframeTarget(selectedKeyTarget.keyframeId, selectedKeyTarget);
                  setSelectedKeyTarget(null);
                }}
                className="p-1.5 rounded hover:bg-red-500/20 text-red-400 flex items-center gap-0.5"
                title="Удалить выбранный ключ параметра"
              >
                <Diamond size={11} className="rotate-45 text-amber-400" />
                <Trash2 size={14} />
              </button>
            )}
            <span className="text-xs text-gray-500">Длина</span>
            <NumericInput value={timeline.durationFrames} min={1} onChange={setTimelineDuration} className="w-14 bg-surface-700 border border-surface-600 rounded px-1 text-xs text-white cursor-ew-resize" />
            {selectedDirector && (
              <div className="flex items-center gap-1.5 ml-auto pl-2 border-l border-surface-700">
                <span className="text-xs text-amber-400">Director</span>
                <input
                  value={selectedDirector.name}
                  onChange={(e) => updateTimelineDirector(selectedDirector.id, { name: e.target.value })}
                  className="w-28 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-accent-500"
                  title="Имя director"
                />
                <span className="text-xs text-gray-500">Дл.</span>
                <NumericInput
                  value={selectedDirector.durationFrames}
                  min={1}
                  onChange={(v) => updateTimelineDirector(selectedDirector.id, { durationFrames: v })}
                  className="w-14 bg-surface-700 border border-surface-600 rounded px-1 text-xs text-white cursor-ew-resize"
                  title="Длина director"
                />
                <span className="text-xs text-gray-500">Offset</span>
                <NumericInput
                  value={selectedDirector.offsetFrames}
                  min={0}
                  onChange={(v) => updateTimelineDirector(selectedDirector.id, { offsetFrames: v })}
                  className="w-14 bg-surface-700 border border-surface-600 rounded px-1 text-xs text-white cursor-ew-resize"
                  title="Offset director"
                />
                <button
                  type="button"
                  onClick={() => updateTimelineDirector(selectedDirector.id, { autostart: !selectedDirector.autostart })}
                  className={`px-2 py-1 rounded text-xs font-semibold border ${
                    selectedDirector.autostart
                      ? 'bg-accent-500 text-white border-accent-400 shadow-inner'
                      : 'bg-surface-700 text-gray-400 border-surface-600 hover:text-white'
                  }`}
                  title="Запускать director при старте template"
                >
                  Autostart
                </button>
                <button
                  type="button"
                  onClick={() => updateTimelineDirector(selectedDirector.id, { loop: !selectedDirector.loop })}
                  className={`px-2 py-1 rounded text-xs font-semibold border ${
                    selectedDirector.loop
                      ? 'bg-accent-500 text-white border-accent-400 shadow-inner'
                      : 'bg-surface-700 text-gray-400 border-surface-600 hover:text-white'
                  }`}
                  title="Зациклить director"
                >
                  Loop
                </button>
                <button
                  type="button"
                  onClick={addTimelineActionToSelectedDirector}
                  className="px-2 py-1 rounded text-xs font-semibold border bg-surface-700 text-gray-300 border-surface-600 hover:bg-surface-600 hover:text-white"
                  title="Добавить Action"
                >
                  +A
                </button>
                <button
                  type="button"
                  onClick={() => selectedTimelineActionId && deleteTimelineAction(selectedTimelineActionId)}
                  disabled={!selectedTimelineActionId}
                  className={`px-2 py-1 rounded text-xs font-semibold border ${
                    selectedTimelineActionId
                      ? 'bg-surface-700 text-gray-300 border-surface-600 hover:bg-surface-600 hover:text-white'
                      : 'bg-surface-800 text-gray-600 border-surface-700 cursor-not-allowed'
                  }`}
                  title="Удалить выбранный Action"
                >
                  -A
                </button>
              </div>
            )}
            <select value={selectedKey?.easing ?? timelineEasing} onChange={(e) => { const easing = e.target.value as EasingType; setTimelineEasing(easing); if (selectedKey) setTimelineKeyframeEasing(selectedKey.id, easing); }} className="bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-xs text-white ml-auto">
              {EASINGS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-shrink-0 border-r border-surface-700 overflow-y-auto text-[11px]" style={{ width: LABEL_W }}>
              <div className="h-6 border-b border-surface-700 px-2 flex items-center justify-between text-gray-500 sticky top-0 bg-surface-850 z-10">
                <span>Дорожки</span>
                <button
                  type="button"
                  onClick={addTimelineDirector}
                  className="px-1.5 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-[10px] font-semibold text-gray-300"
                  title="Создать director"
                >
                  +D
                </button>
              </div>
              {trackRows.map((row) => (
                <div
                  key={row.rowId}
                  draggable
                  onDragStart={() => setDraggedRow(row)}
                  onDragEnd={() => setDraggedRow(null)}
                  onDragOver={(e) => {
                    if (draggedRow && (row.type === 'director' || draggedRow.type === 'director')) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleRowDrop(row);
                  }}
                  onClick={() => {
                    if (row.type === 'director') selectTimelineDirector(row.directorId);
                    if (row.type === 'action') selectTimelineAction(row.action?.id ?? null);
                  }}
                  className={`flex items-center gap-1 truncate border-b border-surface-800/80 cursor-pointer ${
                    row.type === 'director'
                      ? row.directorId === selectedTimelineDirectorId
                        ? 'bg-accent-500/15 text-white'
                        : 'text-amber-300'
                      : row.type === 'action'
                        ? row.action?.id === selectedTimelineActionId
                          ? 'bg-accent-500/10 text-accent-200'
                          : 'text-purple-300'
                        : row.prop
                          ? 'text-gray-500'
                          : 'text-gray-300'
                  }`}
                  style={{ height: ROW_H, paddingLeft: 8 + row.indent * 12 }}
                  title={row.label}
                >
                  {row.type === 'director' && <Folder size={10} className="text-amber-400 flex-shrink-0" />}
                  {row.type === 'action' && <Diamond size={8} className="text-purple-300 flex-shrink-0" />}
                  {row.type === 'track' && !row.prop && row.kind === 'group' && <Folder size={10} className="text-amber-500/70 flex-shrink-0" />}
                  {hasKeys(row) && <Diamond size={8} className="text-amber-400 flex-shrink-0" />}
                  <span className="truncate">{row.label}</span>
                  {row.type === 'director' && timeline.directors.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTimelineDirector(row.directorId);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="ml-auto p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
                      title="Удалить director"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-auto relative"
              onMouseDown={(e) => {
                if (e.button !== 0 || (e.target as HTMLElement).closest('[data-keyframe],[data-action-marker]')) return;
                dragRef.current = 'scrub';
                setTimelinePlaying(false);
                setTimelinePlayhead(frameFromClientX(e.clientX));
              }}
            >
              <div ref={rulerRef} className="relative" style={{ width: timelineWidth, minWidth: '100%' }}>
                <div className="h-6 border-b border-surface-700 sticky top-0 z-10 bg-surface-900/90">
                  {(() => {
                    const marks: number[] = [];
                    for (let f = 0; f <= timeline.durationFrames; f += 25) marks.push(f);
                    if (marks[marks.length - 1] !== timeline.durationFrames) marks.push(timeline.durationFrames);
                    return marks.map((f) => (
                      <span key={f} className="absolute text-[10px] text-gray-600 -translate-x-1/2" style={{ left: f * PX_PER_FRAME, top: 2 }}>{f}</span>
                    ));
                  })()}
                </div>

                <div className="relative" style={{ height: trackRows.length * ROW_H }}>
                  {trackRows.map((row, ri) => {
                    const rowDirector = directorById.get(row.directorId);
                    return (
                      <div key={row.rowId} className="absolute left-0 right-0 border-b border-surface-800/50" style={{ top: ri * ROW_H, height: ROW_H }}>
                        {row.type === 'director' && row.director && (
                          <div
                            className="absolute top-1/2 h-1 -translate-y-1/2 bg-amber-500/50 border-y border-amber-300/60 pointer-events-none"
                            style={{
                              left: row.director.offsetFrames * PX_PER_FRAME,
                              width: row.director.durationFrames * PX_PER_FRAME,
                            }}
                          />
                        )}
                        {animatedSegmentsOnRow(row).map((segment) => (
                          <div
                            key={`${row.rowId}-${segment.id}`}
                            className="absolute top-1/2 h-1 -translate-y-1/2 bg-cyan-500/60 border-y border-cyan-300/50 pointer-events-none"
                            style={{ left: segment.left, width: segment.width }}
                          />
                        ))}
                        {row.type === 'action' && row.action && (
                          <button
                            type="button"
                            data-action-marker
                            title="Action"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectTimelineAction(row.action!.id);
                            }}
                            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-4 rounded-sm border ${
                              row.action.id === selectedTimelineActionId
                                ? 'bg-purple-300 border-white'
                                : 'bg-purple-600 border-purple-300 hover:bg-purple-400'
                            }`}
                            style={{
                              left: (row.action.frame + (rowDirector?.offsetFrames ?? 0)) * PX_PER_FRAME,
                            }}
                          />
                        )}
                        {keysOnRow(row).map((kf) => (
                        <button
                          key={`${row.rowId}-${kf.id}`}
                          type="button"
                          data-keyframe
                          title={`Кадр ${kf.frame}`}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            dragRef.current = 'key';
                            dragKeyIdRef.current = kf.id;
                            dragKeyOffsetRef.current = timeline.directors.find((d) => d.id === row.directorId)?.offsetFrames ?? 0;
                            if (row.type === 'track' && row.kind && row.targetId && row.prop) {
                              const keyTarget = {
                                keyframeId: kf.id,
                                kind: row.kind,
                                targetId: row.targetId,
                                prop: row.prop,
                                directorId: row.directorId,
                              };
                              dragKeyTargetRef.current = keyTarget;
                              setSelectedKeyTarget(keyTarget);
                            } else {
                              dragKeyTargetRef.current = null;
                              setSelectedKeyTarget(null);
                            }
                            selectTimelineKeyframe(kf.id);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (row.type === 'track' && row.kind && row.targetId && row.prop) {
                              setSelectedKeyTarget({
                                keyframeId: kf.id,
                                kind: row.kind,
                                targetId: row.targetId,
                                prop: row.prop,
                                directorId: row.directorId,
                              });
                            } else {
                              setSelectedKeyTarget(null);
                            }
                            selectTimelineKeyframe(kf.id);
                          }}
                          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border ${
                            kf.id === selectedTimelineKeyframeId && selectedKeyTarget?.prop === row.prop && selectedKeyTarget?.targetId === row.targetId
                              ? 'bg-amber-300 border-white'
                              : 'bg-amber-600 border-amber-400 hover:bg-amber-400'
                          }`}
                          style={{ left: (kf.frame + (timeline.directors.find((d) => d.id === row.directorId)?.offsetFrames ?? 0)) * PX_PER_FRAME }}
                        />
                        ))}
                        {rowDirector && (
                          <div
                            className={`absolute top-0 bottom-0 w-px z-20 pointer-events-none ${
                              rowDirector.autostart ? 'bg-red-500' : 'bg-red-500/40'
                            }`}
                            style={{ left: directorCursorLeft(rowDirector) }}
                          >
                            {row.type === 'director' && (
                              <div
                                className="absolute top-0 -translate-x-1/2 cursor-ew-resize pointer-events-auto"
                                style={{
                                  borderLeft: '6px solid transparent',
                                  borderRight: '6px solid transparent',
                                  borderTop: `8px solid ${rowDirector.autostart ? '#ef4444' : '#7f1d1d'}`,
                                }}
                                onMouseDown={(e) => { e.stopPropagation(); dragRef.current = 'playhead'; setTimelinePlaying(false); }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-surface-700 flex-shrink-0">
            <button
              type="button"
              onClick={() => setBezierOpen((v) => !v)}
              className="w-full px-3 py-1.5 flex items-center justify-between text-xs text-gray-400 hover:bg-surface-700/40"
            >
              <span>Кривая Безье</span>
              {bezierOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {bezierOpen && (
              <div className="px-3 pb-2 overflow-hidden" style={{ height: BEZIER_PANEL_H }}>
                {selectedKey ? (
                  <BezierEditor value={selectedKey.bezier} onChange={(b) => setTimelineKeyframeBezier(selectedKey.id, b)} />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-gray-500">
                    в данном кадре не доступно
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
