import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  Template,
  Layer,
  LayerGroup,
  Variable,
  createDefaultTemplate,
  EasingType,
  PositionSizeProp,
  PositionSizeValues,
  BezierHandle,
  RootStackEntry,
  TimelineDirector,
  TimelineAction,
} from './schema';
import { createDefaultGroup, getLayerParentWorld, getGroupChain, worldToLocal, accumulateParentTransform } from './transform';
import {
  captureLocalValuesForKeyframe,
  findKeyframeAtFrame,
  getGroupLocalTransformAtFrame,
  getLayerLocalTransformAtFrame,
  getLayerWorldTransformAtFrame,
  getGroupWorldTransformAtFrame,
  DEFAULT_DIRECTOR_ID,
  getDirectorForTrack,
  getTimelineTrackKey,
  mergeKeyframeTargets,
  normalizeTemplate,
  normalizeTimeline,
  stepTimelinePlayback,
  purgeTargetFromTimeline,
  remapLayerTimelineForReparent,
  reparentLayerTransform,
} from './timeline';
import {
  addToRootStack,
  normalizeAllStacks,
  normalizeRootStack,
  rebuildLayersArray,
  removeFromRootStack,
} from './stackOrder';

interface EditorState {
  template: Template;
  savedTemplate: Template;
  selectedLayerIds: string[];
  selectedGroupIds: string[];
  transformSpace: 'local' | 'world';
  tool: 'select' | 'text' | 'rect' | 'image' | 'clock' | 'video';
  zoom: number;

  setTemplate: (t: Template) => void;
  setTemplateName: (name: string) => void;
  markSaved: () => void;
  updateCanvas: (patch: Partial<Template['canvas']>) => void;

  addLayer: (layer: Layer) => void;
  addLayers: (layers: Layer[]) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  reorderLayers: (from: number, to: number) => void;
  reorderRootStack: (from: number, to: number) => void;
  moveTreeItem: (kind: 'layer' | 'group', id: string, parentId: string | null, index: number) => void;

  addGroup: (group?: LayerGroup) => void;
  deleteGroup: (id: string) => void;
  updateGroup: (id: string, patch: Partial<LayerGroup>) => void;
  moveLayerToGroup: (layerId: string, groupId: string | null) => void;
  moveGroupToParent: (groupId: string, parentId: string | null) => void;
  selectGroup: (id: string | null, multi?: boolean) => void;
  setTransformSpace: (space: 'local' | 'world') => void;

  selectLayer: (id: string | null, multi?: boolean) => void;
  alignLayers: (type: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdistribute' | 'vdistribute') => void;
  shiftLayerOrder: (id: string, direction: 'up' | 'down') => void;
  setTool: (tool: EditorState['tool']) => void;
  setZoom: (zoom: number) => void;
  snapToGrid: boolean;
  gridSize: number;
  setSnapToGrid: (v: boolean) => void;
  setGridSize: (v: number) => void;

  addVariable: (variable: Variable) => void;
  updateVariable: (id: string, patch: Partial<Variable>) => void;
  deleteVariable: (id: string) => void;

  timelinePlayhead: number;
  timelineDirectorPlayheads: Record<string, number>;
  timelineDirectorActive: Record<string, boolean>;
  timelineDirectorStopped: Record<string, boolean>;
  selectedTimelineKeyframeId: string | null;
  selectedTimelineDirectorId: string;
  selectedTimelineActionId: string | null;
  timelinePlaying: boolean;
  timelineEasing: EasingType;

  setTimelinePlayhead: (frame: number) => void;
  setTimelineDuration: (frames: number) => void;
  setTimelinePlaying: (playing: boolean) => void;
  setTimelineEasing: (easing: EasingType) => void;
  selectTimelineKeyframe: (id: string | null) => void;
  selectTimelineDirector: (id: string) => void;
  selectTimelineAction: (id: string | null) => void;
  addTimelineActionToSelectedDirector: () => void;
  deleteTimelineAction: (id: string) => void;
  updateTimelineAction: (id: string, patch: Partial<Omit<TimelineAction, 'id'>>) => void;
  addTimelineDirector: () => void;
  deleteTimelineDirector: (id: string) => void;
  updateTimelineDirector: (id: string, patch: Partial<Omit<TimelineDirector, 'id'>>) => void;
  moveTimelineDirector: (id: string, toIndex: number) => void;
  moveTimelineTrackToDirector: (trackKey: string, directorId: string) => void;
  addTimelineKeyframeAtPlayhead: (target?: {
    kind: 'layer' | 'group';
    targetId: string;
    props: PositionSizeProp[];
  }) => void;
  deleteTimelineKeyframe: (id: string) => void;
  deleteTimelineKeyframeTarget: (
    keyframeId: string,
    target: { kind: 'layer' | 'group'; targetId: string; prop: PositionSizeProp },
  ) => void;
  setTimelineKeyframeEasing: (id: string, easing: EasingType) => void;
  setTimelineKeyframeBezier: (id: string, bezier: BezierHandle | undefined) => void;
  moveTimelineKeyframeTarget: (
    keyframeId: string,
    target: { kind: 'layer' | 'group'; targetId: string; prop: PositionSizeProp },
    frame: number,
  ) => void;
  updateTimelineKeyframeLayer: (keyframeId: string, layerId: string, patch: PositionSizeValues) => void;
  updateTimelineKeyframeGroup: (keyframeId: string, groupId: string, patch: PositionSizeValues) => void;
  updateLayerTransform: (layerId: string, patch: Partial<Layer['transform']>) => void;
  updateGroupTransform: (groupId: string, patch: Partial<LayerGroup['transform']>) => void;
  advanceTimeline: (deltaFrames: number) => void;
}

const defaultTemplate = createDefaultTemplate();

function getDirectorPlayheadsAtFrame(
  directors: TimelineDirector[],
  frame: number,
  _existing: Record<string, number> = {},
): Record<string, number> {
  return Object.fromEntries(
    directors.map((director) => {
      const activeFrame = Math.max(0, Math.min(director.durationFrames, frame - director.offsetFrames));
      if (!director.autostart) return [director.id, 0];
      if (!director.loop) return [director.id, activeFrame];
      const period = director.durationFrames + 1;
      const wrappedFrame = ((Math.round(frame - director.offsetFrames) % period) + period) % period;
      return [director.id, wrappedFrame];
    }),
  );
}

function getDefaultDirectorActive(directors: TimelineDirector[]): Record<string, boolean> {
  return Object.fromEntries(directors.map((director) => [director.id, false]));
}

function getPlaybackModeFromDirectors(directors: TimelineDirector[]): 'bounded' | 'infinite' {
  return directors.some((director) => director.loop) ? 'infinite' : 'bounded';
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      template: defaultTemplate,
      savedTemplate: defaultTemplate,
      selectedLayerIds: [],
      selectedGroupIds: [],
      transformSpace: 'local',
      tool: 'select',
      zoom: 0.5,
      snapToGrid: false,
      gridSize: 20,

      setTemplate: (template) => {
        const normalized = normalizeTemplate(template);
        const normalizedTimeline = {
          ...normalized.timeline,
          playbackMode: getPlaybackModeFromDirectors(normalized.timeline.directors),
        };
        set({
          template: { ...normalized, timeline: normalizedTimeline },
          savedTemplate: { ...normalized, timeline: normalizedTimeline },
          selectedLayerIds: [],
          selectedGroupIds: [],
          timelinePlayhead: 0,
          timelineDirectorPlayheads: getDirectorPlayheadsAtFrame(normalizedTimeline.directors, 0),
          timelineDirectorActive: getDefaultDirectorActive(normalizedTimeline.directors),
          timelineDirectorStopped: {},
          selectedTimelineKeyframeId: null,
          selectedTimelineDirectorId: normalizedTimeline.directors[0]?.id ?? DEFAULT_DIRECTOR_ID,
          selectedTimelineActionId: null,
          timelinePlaying: false,
        });
      },
      setTemplateName: (name) => set((s) => ({ template: { ...s.template, name } })),
      markSaved: () => set({ savedTemplate: get().template }),

      updateCanvas: (patch) =>
        set((s) => ({ template: { ...s.template, canvas: { ...s.template.canvas, ...patch } } })),

      addLayer: (layer) =>
        set((s) => {
          const rootStack = normalizeRootStack(s.template);
          const nextStack =
            !layer.groupId
              ? addToRootStack(rootStack, { kind: 'layer', id: layer.id }, 'start')
              : rootStack;
          const template = {
            ...s.template,
            rootStack: nextStack,
            layers: [layer, ...s.template.layers],
          };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      addLayers: (layers) =>
        set((s) => ({ template: { ...s.template, layers: [...layers, ...s.template.layers] } })),

      updateLayer: (id, patch) =>
        set((s) => ({
          template: {
            ...s.template,
            layers: s.template.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
          },
        })),

      deleteLayer: (id) =>
        set((s) => {
          const template = {
            ...s.template,
            rootStack: removeFromRootStack(normalizeRootStack(s.template), 'layer', id),
            layers: s.template.layers.filter((l) => l.id !== id),
            timeline: purgeTargetFromTimeline(normalizeTimeline(s.template.timeline), 'layer', id),
          };
          return {
            template: { ...template, layers: rebuildLayersArray(template) },
            selectedLayerIds: s.selectedLayerIds.filter((sid) => sid !== id),
          };
        }),

      addGroup: (group) =>
        set((s) => {
          const g = group ?? createDefaultGroup();
          const rootStack = addToRootStack(
            normalizeRootStack(s.template),
            { kind: 'group', id: g.id },
            'start',
          );
          const template = {
            ...s.template,
            groups: [...(s.template.groups ?? []), g],
            rootStack,
          };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      deleteGroup: (id) =>
        set((s) => {
          const childGroupIds = new Set<string>();
          const collect = (pid: string) => {
            (s.template.groups ?? []).forEach((g) => {
              if (g.parentId === pid) {
                childGroupIds.add(g.id);
                collect(g.id);
              }
            });
          };
          collect(id);
          const allGroupIds = new Set([id, ...childGroupIds]);
          const layerIdsToDelete = s.template.layers
            .filter((l) => l.groupId && allGroupIds.has(l.groupId))
            .map((l) => l.id);
          const layerIdsSet = new Set(layerIdsToDelete);

          let timeline = normalizeTimeline(s.template.timeline);
          allGroupIds.forEach((gid) => {
            timeline = purgeTargetFromTimeline(timeline, 'group', gid);
          });
          layerIdsToDelete.forEach((lid) => {
            timeline = purgeTargetFromTimeline(timeline, 'layer', lid);
          });

          let rootStack = normalizeRootStack(s.template);
          const groupStacks: Record<string, RootStackEntry[]> = { ...(s.template.groupStacks ?? {}) };
          allGroupIds.forEach((gid) => {
            rootStack = removeFromRootStack(rootStack, 'group', gid);
            Object.keys(groupStacks).forEach((stackId) => {
              groupStacks[stackId] = removeFromRootStack(groupStacks[stackId], 'group', gid);
            });
            delete groupStacks[gid];
          });
          layerIdsToDelete.forEach((lid) => {
            rootStack = removeFromRootStack(rootStack, 'layer', lid);
            Object.keys(groupStacks).forEach((stackId) => {
              groupStacks[stackId] = removeFromRootStack(groupStacks[stackId], 'layer', lid);
            });
          });

          const template = {
            ...s.template,
            groups: (s.template.groups ?? []).filter((g) => !allGroupIds.has(g.id)),
            layers: s.template.layers.filter((l) => !layerIdsSet.has(l.id)),
            timeline,
            rootStack,
            groupStacks,
          };
          return {
            template: { ...template, layers: rebuildLayersArray(template) },
            selectedGroupIds: s.selectedGroupIds.filter((gid) => !allGroupIds.has(gid)),
            selectedLayerIds: s.selectedLayerIds.filter((lid) => !layerIdsSet.has(lid)),
          };
        }),

      updateGroup: (id, patch) =>
        set((s) => {
          if (patch.visible === undefined) {
            return {
              template: {
                ...s.template,
                groups: (s.template.groups ?? []).map((g) =>
                  g.id === id ? ({ ...g, ...patch } as LayerGroup) : g,
                ),
              },
            };
          }

          const groups = s.template.groups ?? [];
          const groupIds = new Set([id]);
          const collectChildren = (parentId: string) => {
            groups.forEach((g) => {
              if (g.parentId === parentId) {
                groupIds.add(g.id);
                collectChildren(g.id);
              }
            });
          };
          collectChildren(id);

          return {
            template: {
              ...s.template,
              groups: groups.map((g) =>
                groupIds.has(g.id) ? ({ ...g, visible: patch.visible } as LayerGroup) : g,
              ),
              layers: s.template.layers.map((l) =>
                l.groupId && groupIds.has(l.groupId) ? ({ ...l, visible: patch.visible } as Layer) : l,
              ),
            },
          };
        }),

      moveLayerToGroup: (layerId, groupId) =>
        set((s) => {
          const layer = s.template.layers.find((l) => l.id === layerId);
          if (!layer) return {};
          const oldGroupId = layer.groupId ?? null;
          if (oldGroupId === groupId) return {};

          const frame = s.timelinePlayhead;
          const newTransform = reparentLayerTransform(layer, s.template, groupId, frame);
          const timeline = remapLayerTimelineForReparent(
            s.template,
            layerId,
            oldGroupId,
            groupId,
          );

          let rootStack = normalizeRootStack(s.template);
          if (!groupId) {
            rootStack = addToRootStack(rootStack, { kind: 'layer', id: layerId }, 'start');
          } else {
            rootStack = removeFromRootStack(rootStack, 'layer', layerId);
          }
          const template = {
            ...s.template,
            timeline,
            rootStack,
            layers: s.template.layers.map((l) =>
              l.id === layerId ? { ...l, groupId, transform: newTransform } : l,
            ),
          };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      moveGroupToParent: (groupId, parentId) =>
        set((s) => {
          if (groupId === parentId) return {};
          const groups = s.template.groups ?? [];
          const isDescendant = (candidateParent: string, node: string): boolean => {
            let cur = candidateParent;
            const seen = new Set<string>();
            while (cur) {
              if (cur === node) return true;
              if (seen.has(cur)) break;
              seen.add(cur);
              cur = groups.find((g) => g.id === cur)?.parentId ?? '';
            }
            return false;
          };
          if (parentId && isDescendant(parentId, groupId)) return {};
          let rootStack = normalizeRootStack(s.template);
          if (!parentId) {
            rootStack = addToRootStack(rootStack, { kind: 'group', id: groupId }, 'start');
          } else {
            rootStack = removeFromRootStack(rootStack, 'group', groupId);
          }
          const template = {
            ...s.template,
            groups: groups.map((g) => (g.id === groupId ? { ...g, parentId } : g)),
            rootStack,
          };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      selectGroup: (id, multi = false) =>
        set((s) => ({
          selectedGroupIds: id === null
            ? []
            : multi
            ? s.selectedGroupIds.includes(id)
              ? s.selectedGroupIds.filter((i) => i !== id)
              : [...s.selectedGroupIds, id]
            : [id],
          selectedLayerIds: id && !multi ? [] : s.selectedLayerIds,
        })),

      setTransformSpace: (transformSpace) => set({ transformSpace }),

      reorderLayers: (from, to) =>
        set((s) => {
          const layers = [...s.template.layers];
          const [item] = layers.splice(from, 1);
          layers.splice(to, 0, item);
          const template = { ...s.template, layers };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      reorderRootStack: (from, to) =>
        set((s) => {
          const stack = [...normalizeRootStack(s.template)];
          if (from < 0 || from >= stack.length || to < 0 || to >= stack.length) return {};
          const [item] = stack.splice(from, 1);
          stack.splice(to, 0, item);
          const template = { ...s.template, rootStack: stack };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      moveTreeItem: (kind, id, parentId, index) =>
        set((s) => {
          const groups = s.template.groups ?? [];
          if (parentId && !groups.some((g) => g.id === parentId)) return {};

          if (kind === 'group') {
            if (id === parentId) return {};
            let cur = parentId;
            while (cur) {
              if (cur === id) return {};
              cur = groups.find((g) => g.id === cur)?.parentId ?? null;
            }
          }

          const layer = kind === 'layer'
            ? s.template.layers.find((l) => l.id === id)
            : null;
          const group = kind === 'group'
            ? groups.find((g) => g.id === id)
            : null;
          if (kind === 'layer' && !layer) return {};
          if (kind === 'group' && !group) return {};

          const oldParentId = kind === 'layer'
            ? layer!.groupId ?? null
            : group!.parentId ?? null;
          const entry = { kind, id } as const;
          const normalized = normalizeAllStacks(s.template);
          const groupStacks: Record<string, RootStackEntry[]> = { ...(normalized.groupStacks ?? {}) };
          let rootStack: RootStackEntry[] = [...(normalized.rootStack ?? [])];

          const removeFrom = (stack: RootStackEntry[]) =>
            stack.filter((e) => !(e.kind === kind && e.id === id));

          const oldStack = oldParentId ? groupStacks[oldParentId] ?? [] : rootStack;
          const oldIndex = oldStack.findIndex((e) => e.kind === kind && e.id === id);
          rootStack = removeFrom(rootStack);
          Object.keys(groupStacks).forEach((gid) => {
            groupStacks[gid] = removeFrom(groupStacks[gid]);
          });

          const targetStack = parentId ? [...(groupStacks[parentId] ?? [])] : [...rootStack];
          const adjustedIndex = oldParentId === parentId && oldIndex !== -1 && oldIndex < index
            ? index - 1
            : index;
          const insertAt = Math.max(0, Math.min(adjustedIndex, targetStack.length));
          targetStack.splice(insertAt, 0, entry);
          if (parentId) groupStacks[parentId] = targetStack;
          else rootStack = targetStack;

          let timeline = s.template.timeline;
          let layers = s.template.layers;
          if (kind === 'layer') {
            const nextTransform = oldParentId === parentId
              ? layer!.transform
              : reparentLayerTransform(layer!, s.template, parentId, s.timelinePlayhead);
            timeline = oldParentId === parentId
              ? timeline
              : remapLayerTimelineForReparent(s.template, id, oldParentId, parentId);
            layers = layers.map((l) =>
              l.id === id ? { ...l, groupId: parentId, transform: nextTransform } : l,
            );
          }

          const template = {
            ...s.template,
            groups: kind === 'group'
              ? groups.map((g) => (g.id === id ? { ...g, parentId } : g))
              : groups,
            layers,
            timeline,
            rootStack,
            groupStacks,
          };
          return { template: { ...template, layers: rebuildLayersArray(template) } };
        }),

      selectLayer: (id, multi = false) =>
        set((s) => ({
          selectedLayerIds: id === null
            ? []
            : multi
            ? s.selectedLayerIds.includes(id)
              ? s.selectedLayerIds.filter((i) => i !== id)
              : [...s.selectedLayerIds, id]
            : [id],
        })),

      alignLayers: (type) =>
        set((s) => {
          const sel = s.template.layers.filter((l) => s.selectedLayerIds.includes(l.id));
          if (sel.length < 2) return {};
          const boxes = sel.map((l) => ({
            id: l.id,
            x: l.transform.x, y: l.transform.y,
            w: l.transform.width, h: l.transform.height,
          }));
          const minX = Math.min(...boxes.map((b) => b.x));
          const maxX = Math.max(...boxes.map((b) => b.x + b.w));
          const minY = Math.min(...boxes.map((b) => b.y));
          const maxY = Math.max(...boxes.map((b) => b.y + b.h));

          const updates: Record<string, { x?: number; y?: number }> = {};

          if (type === 'left') {
            boxes.forEach((b) => { updates[b.id] = { x: minX }; });
          } else if (type === 'right') {
            boxes.forEach((b) => { updates[b.id] = { x: maxX - b.w }; });
          } else if (type === 'hcenter') {
            const cx = (minX + maxX) / 2;
            boxes.forEach((b) => { updates[b.id] = { x: cx - b.w / 2 }; });
          } else if (type === 'top') {
            boxes.forEach((b) => { updates[b.id] = { y: minY }; });
          } else if (type === 'bottom') {
            boxes.forEach((b) => { updates[b.id] = { y: maxY - b.h }; });
          } else if (type === 'vcenter') {
            const cy = (minY + maxY) / 2;
            boxes.forEach((b) => { updates[b.id] = { y: cy - b.h / 2 }; });
          } else if (type === 'hdistribute') {
            const sorted = [...boxes].sort((a, b) => a.x - b.x);
            const totalW = sorted.reduce((s, b) => s + b.w, 0);
            const gap = (maxX - minX - totalW) / (sorted.length - 1);
            let cursor = minX;
            sorted.forEach((b) => { updates[b.id] = { x: cursor }; cursor += b.w + gap; });
          } else if (type === 'vdistribute') {
            const sorted = [...boxes].sort((a, b) => a.y - b.y);
            const totalH = sorted.reduce((s, b) => s + b.h, 0);
            const gap = (maxY - minY - totalH) / (sorted.length - 1);
            let cursor = minY;
            sorted.forEach((b) => { updates[b.id] = { y: cursor }; cursor += b.h + gap; });
          }

          return {
            template: {
              ...s.template,
              layers: s.template.layers.map((l) => {
                const u = updates[l.id];
                if (!u) return l;
                return { ...l, transform: { ...l.transform, ...u } };
              }),
            },
          };
        }),

      shiftLayerOrder: (id, direction) =>
        set((s) => {
          const idx = s.template.layers.findIndex((l) => l.id === id);
          if (idx === -1) return {};
          const newIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= s.template.layers.length) return {};
          const layers = [...s.template.layers];
          const [item] = layers.splice(idx, 1);
          layers.splice(newIdx, 0, item);
          return { template: { ...s.template, layers } };
        }),

      setTool: (tool) => set({ tool }),
      setZoom: (zoom) => set({ zoom }),
      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setGridSize: (gridSize) => set({ gridSize }),

      addVariable: (variable) =>
        set((s) => ({ template: { ...s.template, variables: [...s.template.variables, variable] } })),

      updateVariable: (id, patch) =>
        set((s) => ({
          template: {
            ...s.template,
            variables: s.template.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)),
          },
        })),

      deleteVariable: (id) =>
        set((s) => ({
          template: { ...s.template, variables: s.template.variables.filter((v) => v.id !== id) },
        })),

      timelinePlayhead: 0,
      timelineDirectorPlayheads: getDirectorPlayheadsAtFrame(defaultTemplate.timeline.directors, 0),
      timelineDirectorActive: getDefaultDirectorActive(defaultTemplate.timeline.directors),
      timelineDirectorStopped: {},
      selectedTimelineKeyframeId: null,
      selectedTimelineDirectorId: DEFAULT_DIRECTOR_ID,
      selectedTimelineActionId: null,
      timelinePlaying: false,
      timelineEasing: 'linear',

      setTimelinePlayhead: (frame) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const max = Math.max(0, timeline.durationFrames);
          const f = Math.max(0, Math.min(max, Math.round(frame)));
          const directorStopped = f === 0 ? {} : s.timelineDirectorStopped;
          const directorPlayheads = getDirectorPlayheadsAtFrame(timeline.directors, f, s.timelineDirectorPlayheads);
          if (f !== 0) {
            Object.entries(directorStopped).forEach(([directorId, stopped]) => {
              if (stopped) {
                directorPlayheads[directorId] = s.timelineDirectorPlayheads[directorId] ?? directorPlayheads[directorId];
              }
            });
          }
          const kf = findKeyframeAtFrame(timeline, f);
          return {
            timelinePlayhead: f,
            timelineDirectorPlayheads: directorPlayheads,
            timelineDirectorActive: getDefaultDirectorActive(timeline.directors),
            timelineDirectorStopped: directorStopped,
            selectedTimelineKeyframeId: kf?.id ?? null,
            selectedTimelineActionId: null,
          };
        }),

      setTimelineDuration: (durationFrames) =>
        set((s) => {
          const frame = Math.min(s.timelinePlayhead, Math.max(0, Math.round(durationFrames)));
          const timeline = normalizeTimeline({
            ...s.template.timeline,
            durationFrames: Math.max(1, Math.round(durationFrames)),
          });
          return {
            template: {
              ...s.template,
              timeline,
            },
            timelinePlayhead: frame,
            timelineDirectorPlayheads: getDirectorPlayheadsAtFrame(timeline.directors, frame, s.timelineDirectorPlayheads),
            timelineDirectorActive: getDefaultDirectorActive(timeline.directors),
          };
        }),

      setTimelinePlaying: (timelinePlaying) => set({ timelinePlaying }),

      advanceTimeline: (deltaFrames) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const max = Math.max(0, timeline.durationFrames);
          const prevGlobalFrame = s.timelinePlayhead;
          const isInfinite = timeline.playbackMode === 'infinite';
          const tentativeFrame = isInfinite
            ? Math.max(0, Math.round(prevGlobalFrame + deltaFrames))
            : Math.max(0, Math.min(max, Math.round(prevGlobalFrame + deltaFrames)));
          const playback = stepTimelinePlayback(timeline, prevGlobalFrame, tentativeFrame, {
            directorPlayheads: s.timelineDirectorPlayheads,
            directorActive: {
              ...getDefaultDirectorActive(timeline.directors),
              ...s.timelineDirectorActive,
            },
            directorStopped: s.timelineDirectorStopped,
          });
          const nextGlobalFrame = playback.nextGlobalFrame;
          const kf = findKeyframeAtFrame(timeline, nextGlobalFrame);
          return {
            timelinePlayhead: nextGlobalFrame,
            timelineDirectorPlayheads: playback.state.directorPlayheads,
            timelineDirectorActive: playback.state.directorActive,
            timelineDirectorStopped: playback.state.directorStopped,
            timelinePlaying: isInfinite ? s.timelinePlaying : (nextGlobalFrame >= max ? false : s.timelinePlaying),
            selectedTimelineKeyframeId: kf?.id ?? null,
          };
        }),

      setTimelineEasing: (timelineEasing) => set({ timelineEasing }),

      selectTimelineKeyframe: (id) =>
        set((s) => {
          if (!id) return { selectedTimelineKeyframeId: null };
          const kf = s.template.timeline.keyframes.find((k) => k.id === id);
          if (!kf) return { selectedTimelineKeyframeId: null };
          const timeline = normalizeTimeline(s.template.timeline);
          return {
            selectedTimelineKeyframeId: id,
            selectedTimelineActionId: null,
            timelinePlayhead: kf.frame,
            timelineDirectorPlayheads: getDirectorPlayheadsAtFrame(timeline.directors, kf.frame, s.timelineDirectorPlayheads),
            timelineDirectorActive: getDefaultDirectorActive(timeline.directors),
          };
        }),

      selectTimelineDirector: (id) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          if (!timeline.directors.some((director) => director.id === id)) return {};
          return { selectedTimelineDirectorId: id, selectedTimelineKeyframeId: null, selectedTimelineActionId: null };
        }),

      selectTimelineAction: (id) =>
        set((s) => {
          if (!id) return { selectedTimelineActionId: null };
          const timeline = normalizeTimeline(s.template.timeline);
          const action = timeline.actions.find((a) => a.id === id);
          if (!action) return { selectedTimelineActionId: null };
          const director = timeline.directors.find((d) => d.id === action.directorId) ?? timeline.directors[0];
          const globalFrame = director.offsetFrames + action.frame;
          return {
            selectedTimelineActionId: id,
            selectedTimelineKeyframeId: null,
            selectedTimelineDirectorId: action.directorId,
            timelinePlayhead: Math.max(0, Math.min(timeline.durationFrames, globalFrame)),
            timelineDirectorPlayheads: {
              ...getDirectorPlayheadsAtFrame(timeline.directors, globalFrame, s.timelineDirectorPlayheads),
              [action.directorId]: action.frame,
            },
            timelineDirectorActive: getDefaultDirectorActive(timeline.directors),
          };
        }),

      addTimelineActionToSelectedDirector: () =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const directorId = s.selectedTimelineDirectorId;
          const director = timeline.directors.find((d) => d.id === directorId);
          if (!director) return {};
          const frame = Math.max(0, Math.min(
            director.durationFrames,
            s.timelineDirectorPlayheads[director.id] ?? Math.max(0, s.timelinePlayhead - director.offsetFrames),
          ));
          const action: TimelineAction = {
            id: crypto.randomUUID(),
            directorId: director.id,
            frame,
            command: 'startDirector',
            targetDirectorId: timeline.directors[0]?.id ?? null,
          };
          return {
            selectedTimelineActionId: action.id,
            selectedTimelineKeyframeId: null,
            template: {
              ...s.template,
              timeline: {
                ...timeline,
                actions: [...timeline.actions, action],
              },
            },
          };
        }),

      deleteTimelineAction: (id) =>
        set((s) => {
          if (!s.template.timeline.actions.some((action) => action.id === id)) return {};
          return {
            selectedTimelineActionId:
              s.selectedTimelineActionId === id ? null : s.selectedTimelineActionId,
            template: {
              ...s.template,
              timeline: {
                ...s.template.timeline,
                actions: s.template.timeline.actions.filter((action) => action.id !== id),
              },
            },
          };
        }),

      updateTimelineAction: (id, patch) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const validDirectorIds = new Set(timeline.directors.map((director) => director.id));
          return {
            template: {
              ...s.template,
              timeline: {
                ...timeline,
                actions: timeline.actions.map((action) => {
                  if (action.id !== id) return action;
                  const directorId = patch.directorId && validDirectorIds.has(patch.directorId)
                    ? patch.directorId
                    : action.directorId;
                  const director = timeline.directors.find((d) => d.id === directorId) ?? timeline.directors[0];
                  return {
                    ...action,
                    ...patch,
                    directorId,
                    frame: patch.frame !== undefined
                      ? Math.max(0, Math.min(director.durationFrames, Math.round(patch.frame)))
                      : action.frame,
                    command: patch.command ?? action.command,
                    targetDirectorId: patch.targetDirectorId && validDirectorIds.has(patch.targetDirectorId)
                      ? patch.targetDirectorId
                      : patch.targetDirectorId === null
                        ? null
                        : action.targetDirectorId,
                  };
                }),
              },
            },
          };
        }),

      addTimelineDirector: () =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const director = {
            id: crypto.randomUUID(),
            name: `Director ${timeline.directors.length + 1}`,
            durationFrames: timeline.durationFrames,
            offsetFrames: 0,
            autostart: true,
            loop: false,
          };
          const directors = [...timeline.directors, director];
          return {
            selectedTimelineDirectorId: director.id,
            selectedTimelineKeyframeId: null,
            selectedTimelineActionId: null,
            timelineDirectorPlayheads: {
              ...s.timelineDirectorPlayheads,
              [director.id]: 0,
            },
            timelineDirectorActive: {
              ...s.timelineDirectorActive,
              [director.id]: false,
            },
            template: {
              ...s.template,
              timeline: {
                ...timeline,
                directors,
                playbackMode: getPlaybackModeFromDirectors(directors),
              },
            },
          };
        }),

      deleteTimelineDirector: (id) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          if (timeline.directors.length <= 1) return {};
          if (!timeline.directors.some((director) => director.id === id)) return {};

          const directors = timeline.directors.filter((director) => director.id !== id);
          const nextSelectedDirectorId = s.selectedTimelineDirectorId === id
            ? directors[0]?.id ?? DEFAULT_DIRECTOR_ID
            : s.selectedTimelineDirectorId;

          const trackBelongsToDeletedDirector = (trackKey: string) =>
            (timeline.trackDirectors[trackKey] ?? DEFAULT_DIRECTOR_ID) === id;

          const keyframes = timeline.keyframes
            .map((kf) => {
              const layers = Object.fromEntries(
                Object.entries(kf.layers)
                  .map(([layerId, values]) => {
                    const nextValues = Object.fromEntries(
                      Object.entries(values).filter(([prop]) =>
                        !trackBelongsToDeletedDirector(getTimelineTrackKey('layer', layerId, prop as PositionSizeProp)),
                      ),
                    ) as PositionSizeValues;
                    return [layerId, nextValues] as const;
                  })
                  .filter(([, values]) => Object.keys(values).length > 0),
              );

              const groups = Object.fromEntries(
                Object.entries(kf.groups)
                  .map(([groupId, values]) => {
                    const nextValues = Object.fromEntries(
                      Object.entries(values).filter(([prop]) =>
                        !trackBelongsToDeletedDirector(getTimelineTrackKey('group', groupId, prop as PositionSizeProp)),
                      ),
                    ) as PositionSizeValues;
                    return [groupId, nextValues] as const;
                  })
                  .filter(([, values]) => Object.keys(values).length > 0),
              );

              return { ...kf, layers, groups };
            })
            .filter((kf) => Object.keys(kf.layers).length > 0 || Object.keys(kf.groups).length > 0);

          const trackDirectors = Object.fromEntries(
            Object.entries(timeline.trackDirectors).filter(([, directorId]) => directorId !== id),
          );
          const actions = timeline.actions.filter((action) =>
            action.directorId !== id && action.targetDirectorId !== id,
          );

          return {
            selectedTimelineDirectorId: nextSelectedDirectorId,
            selectedTimelineKeyframeId: null,
            selectedTimelineActionId: null,
            timelineDirectorPlayheads: Object.fromEntries(
              Object.entries(s.timelineDirectorPlayheads).filter(([directorId]) => directorId !== id),
            ),
            timelineDirectorActive: Object.fromEntries(
              Object.entries(s.timelineDirectorActive).filter(([directorId]) => directorId !== id),
            ),
            timelineDirectorStopped: Object.fromEntries(
              Object.entries(s.timelineDirectorStopped).filter(([directorId]) => directorId !== id),
            ),
            template: {
              ...s.template,
              timeline: {
                ...timeline,
                directors,
                playbackMode: getPlaybackModeFromDirectors(directors),
                trackDirectors,
                keyframes,
                actions,
              },
            },
          };
        }),

      updateTimelineDirector: (id, patch) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const directors = timeline.directors.map((director) =>
            director.id === id
              ? {
                  ...director,
                  ...patch,
                  name: patch.name ?? director.name,
                  durationFrames: patch.durationFrames !== undefined
                    ? Math.max(1, Math.round(patch.durationFrames))
                    : director.durationFrames,
                  offsetFrames: patch.offsetFrames !== undefined
                    ? Math.max(0, Math.round(patch.offsetFrames))
                    : director.offsetFrames,
                  autostart: patch.autostart ?? director.autostart,
                  loop: patch.loop ?? director.loop,
                }
              : director,
          );
          return {
            template: {
              ...s.template,
              timeline: {
                ...timeline,
                directors,
                playbackMode: getPlaybackModeFromDirectors(directors),
              },
            },
            timelineDirectorPlayheads: getDirectorPlayheadsAtFrame(directors, s.timelinePlayhead, s.timelineDirectorPlayheads),
            timelineDirectorActive: getDefaultDirectorActive(directors),
          };
        }),

      moveTimelineDirector: (id, toIndex) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const from = timeline.directors.findIndex((director) => director.id === id);
          if (from < 0) return {};
          const directors = [...timeline.directors];
          const [director] = directors.splice(from, 1);
          directors.splice(Math.max(0, Math.min(toIndex, directors.length)), 0, director);
          return {
            template: {
              ...s.template,
              timeline: { ...timeline, directors },
            },
          };
        }),

      moveTimelineTrackToDirector: (trackKey, directorId) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          if (!timeline.directors.some((director) => director.id === directorId)) return {};
          return {
            template: {
              ...s.template,
              timeline: {
                ...timeline,
                trackDirectors: { ...timeline.trackDirectors, [trackKey]: directorId },
              },
            },
          };
        }),

      addTimelineKeyframeAtPlayhead: (target) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const frame = s.timelinePlayhead;
          let localFrame = frame;
          let captured: { layers: Record<string, PositionSizeValues>; groups: Record<string, PositionSizeValues> };
          let trackDirectors = { ...timeline.trackDirectors };

          if (target) {
            captured = { layers: {}, groups: {} };
            const firstProp = target.props[0];
            const trackKey = getTimelineTrackKey(target.kind, target.targetId, firstProp);
            const directorId = trackDirectors[trackKey] ?? s.selectedTimelineDirectorId ?? DEFAULT_DIRECTOR_ID;
            const director = timeline.directors.find((d) => d.id === directorId) ?? timeline.directors[0];
            localFrame = Math.max(0, Math.min(
              director.durationFrames,
              s.timelineDirectorPlayheads[director.id] ?? (frame - director.offsetFrames),
            ));
            target.props.forEach((prop) => {
              trackDirectors[getTimelineTrackKey(target.kind, target.targetId, prop)] = director.id;
            });
            if (target.kind === 'layer') {
              const layer = s.template.layers.find((l) => l.id === target.targetId);
              if (!layer) return {};
              const local = getLayerLocalTransformAtFrame(layer, timeline, s.timelineDirectorPlayheads);
              captured.layers[target.targetId] = target.props.reduce<PositionSizeValues>((acc, prop) => {
                acc[prop] = local[prop];
                return acc;
              }, {});
            } else {
              const group = (s.template.groups ?? []).find((g) => g.id === target.targetId);
              if (!group) return {};
              const local = getGroupLocalTransformAtFrame(group, timeline, s.timelineDirectorPlayheads);
              captured.groups[target.targetId] = target.props.reduce<PositionSizeValues>((acc, prop) => {
                acc[prop] = local[prop];
                return acc;
              }, {});
            }
          } else {
            const layerIds = s.selectedLayerIds;
            const groupIds = s.selectedGroupIds;
            if (layerIds.length === 0 && groupIds.length === 0) return {};
            captured = captureLocalValuesForKeyframe(s.template, frame, layerIds, groupIds);
          }
          const existing = findKeyframeAtFrame(timeline, localFrame);

          if (existing) {
            const merged = mergeKeyframeTargets(existing.layers, existing.groups, captured);
            const keyframes = timeline.keyframes.map((kf) =>
              kf.id === existing.id
                ? { ...kf, layers: merged.layers, groups: merged.groups }
                : kf,
            );
            return {
              selectedTimelineKeyframeId: existing.id,
              template: {
                ...s.template,
                timeline: { ...timeline, keyframes, trackDirectors },
              },
            };
          }

          const newKf = {
            id: crypto.randomUUID(),
            frame: localFrame,
            layers: captured.layers,
            groups: captured.groups,
            easing: s.timelineEasing,
          };
          const keyframes = [...timeline.keyframes, newKf].sort((a, b) => a.frame - b.frame);
          return {
            selectedTimelineKeyframeId: newKf.id,
            template: {
              ...s.template,
              timeline: { ...timeline, keyframes, trackDirectors },
            },
          };
        }),

      moveTimelineKeyframeTarget: (keyframeId, target, frame) =>
        set((s) => {
          const timeline = normalizeTimeline(s.template.timeline);
          const director = getDirectorForTrack(timeline, target.kind, target.targetId, target.prop);
          const localFrame = Math.max(0, Math.min(director.durationFrames, Math.round(frame)));
          const src = timeline.keyframes.find((k) => k.id === keyframeId);
          if (!src) return {};

          const srcBag = target.kind === 'layer' ? src.layers : src.groups;
          const srcValues = srcBag[target.targetId];
          if (!srcValues || srcValues[target.prop] === undefined) return {};
          const propValue = srcValues[target.prop];

          const captured = target.kind === 'layer'
            ? { layers: { [target.targetId]: { [target.prop]: propValue } }, groups: {} as Record<string, PositionSizeValues> }
            : { layers: {} as Record<string, PositionSizeValues>, groups: { [target.targetId]: { [target.prop]: propValue } } };

          let keyframes = timeline.keyframes
            .map((kf) => {
              if (kf.id !== keyframeId) return kf;
              if (target.kind === 'layer') {
                const layers = { ...kf.layers };
                const values = { ...(layers[target.targetId] ?? {}) };
                delete values[target.prop];
                if (Object.keys(values).length > 0) layers[target.targetId] = values;
                else delete layers[target.targetId];
                return { ...kf, layers };
              }
              const groups = { ...kf.groups };
              const values = { ...(groups[target.targetId] ?? {}) };
              delete values[target.prop];
              if (Object.keys(values).length > 0) groups[target.targetId] = values;
              else delete groups[target.targetId];
              return { ...kf, groups };
            })
            .filter((kf) => Object.keys(kf.layers).length > 0 || Object.keys(kf.groups).length > 0);

          const timelineAfterRemove = { ...timeline, keyframes };
          const existing = findKeyframeAtFrame(timelineAfterRemove, localFrame);
          let selectedTimelineKeyframeId: string;

          if (existing) {
            const merged = mergeKeyframeTargets(existing.layers, existing.groups, captured);
            keyframes = keyframes.map((kf) =>
              kf.id === existing.id ? { ...kf, layers: merged.layers, groups: merged.groups } : kf,
            );
            selectedTimelineKeyframeId = existing.id;
          } else {
            const newKf = {
              id: crypto.randomUUID(),
              frame: localFrame,
              layers: captured.layers,
              groups: captured.groups,
              easing: src.easing,
              bezier: src.bezier,
            };
            keyframes = [...keyframes, newKf].sort((a, b) => a.frame - b.frame);
            selectedTimelineKeyframeId = newKf.id;
          }

          const globalFrame = director.offsetFrames + localFrame;
          return {
            selectedTimelineKeyframeId,
            timelinePlayhead: globalFrame,
            timelineDirectorPlayheads: {
              ...s.timelineDirectorPlayheads,
              [director.id]: localFrame,
            },
            template: {
              ...s.template,
              timeline: { ...timeline, keyframes },
            },
          };
        }),

      deleteTimelineKeyframe: (id) =>
        set((s) => ({
          selectedTimelineKeyframeId:
            s.selectedTimelineKeyframeId === id ? null : s.selectedTimelineKeyframeId,
          template: {
            ...s.template,
            timeline: {
              ...s.template.timeline,
              keyframes: s.template.timeline.keyframes.filter((kf) => kf.id !== id),
            },
          },
        })),

      deleteTimelineKeyframeTarget: (keyframeId, target) =>
        set((s) => {
          const keyframes = s.template.timeline.keyframes
            .map((kf) => {
              if (kf.id !== keyframeId) return kf;

              if (target.kind === 'layer') {
                const layers = { ...kf.layers };
                const values = { ...(layers[target.targetId] ?? {}) };
                delete values[target.prop];
                if (Object.keys(values).length > 0) layers[target.targetId] = values;
                else delete layers[target.targetId];
                return { ...kf, layers };
              }

              const groups = { ...kf.groups };
              const values = { ...(groups[target.targetId] ?? {}) };
              delete values[target.prop];
              if (Object.keys(values).length > 0) groups[target.targetId] = values;
              else delete groups[target.targetId];
              return { ...kf, groups };
            })
            .filter((kf) => Object.keys(kf.layers).length > 0 || Object.keys(kf.groups).length > 0);

          return {
            selectedTimelineKeyframeId: s.selectedTimelineKeyframeId === keyframeId ? null : s.selectedTimelineKeyframeId,
            template: {
              ...s.template,
              timeline: {
                ...s.template.timeline,
                keyframes,
              },
            },
          };
        }),

      setTimelineKeyframeEasing: (id, easing) =>
        set((s) => ({
          template: {
            ...s.template,
            timeline: {
              ...s.template.timeline,
              keyframes: s.template.timeline.keyframes.map((kf) =>
                kf.id === id ? { ...kf, easing } : kf,
              ),
            },
          },
          timelineEasing: easing,
        })),

      setTimelineKeyframeBezier: (id, bezier) =>
        set((s) => ({
          template: {
            ...s.template,
            timeline: {
              ...s.template.timeline,
              keyframes: s.template.timeline.keyframes.map((kf) =>
                kf.id === id ? { ...kf, bezier, easing: 'linear' as EasingType } : kf,
              ),
            },
          },
        })),

      updateTimelineKeyframeLayer: (keyframeId, layerId, patch) =>
        set((s) => ({
          template: {
            ...s.template,
            timeline: {
              ...s.template.timeline,
              keyframes: s.template.timeline.keyframes.map((kf) => {
                if (kf.id !== keyframeId) return kf;
                return {
                  ...kf,
                  layers: {
                    ...kf.layers,
                    [layerId]: { ...(kf.layers[layerId] ?? {}), ...patch },
                  },
                };
              }),
            },
          },
        })),

      updateTimelineKeyframeGroup: (keyframeId, groupId, patch) =>
        set((s) => ({
          template: {
            ...s.template,
            timeline: {
              ...s.template.timeline,
              keyframes: s.template.timeline.keyframes.map((kf) => {
                if (kf.id !== keyframeId) return kf;
                return {
                  ...kf,
                  groups: {
                    ...kf.groups,
                    [groupId]: { ...(kf.groups[groupId] ?? {}), ...patch },
                  },
                };
              }),
            },
          },
        })),

      updateLayerTransform: (layerId, patch) => {
        const s = get();
        const layer = s.template.layers.find((l) => l.id === layerId);
        if (!layer) return;

        let localPatch = { ...patch };
        if (s.transformSpace === 'world') {
          const frame = s.timelinePlayhead;
          const world = getLayerWorldTransformAtFrame(layer, s.template, frame);
          const pw = getLayerParentWorld(layer, s.template.groups ?? [], (g) =>
            getGroupLocalTransformAtFrame(g, s.template.timeline, frame),
          );
          localPatch = worldToLocal({ ...world, ...patch }, pw);
        }

        const frame = s.timelinePlayhead;
        const keyAtPlayhead = findKeyframeAtFrame(s.template.timeline, frame);
        const editKeyframeId =
          s.selectedTimelineKeyframeId && keyAtPlayhead?.id === s.selectedTimelineKeyframeId
            ? s.selectedTimelineKeyframeId
            : keyAtPlayhead?.id ?? null;

        if (editKeyframeId) {
          get().updateTimelineKeyframeLayer(editKeyframeId, layerId, localPatch);
          return;
        }

        set((state) => ({
          template: {
            ...state.template,
            layers: state.template.layers.map((l) =>
              l.id === layerId
                ? { ...l, transform: { ...l.transform, ...localPatch } }
                : l,
            ),
          },
        }));
      },

      updateGroupTransform: (groupId, patch) => {
        const s = get();
        const group = (s.template.groups ?? []).find((g) => g.id === groupId);
        if (!group) return;

        let localPatch = { ...patch };
        if (s.transformSpace === 'world') {
          const frame = s.timelinePlayhead;
          const world = getGroupWorldTransformAtFrame(group, s.template, frame);
          const pw = accumulateParentTransform(
            getGroupChain(group.parentId, s.template.groups ?? []),
            (g) => getGroupLocalTransformAtFrame(g, s.template.timeline, frame),
          );
          localPatch = worldToLocal({ ...world, ...patch }, pw);
        }

        const frame = s.timelinePlayhead;
        const keyAtPlayhead = findKeyframeAtFrame(s.template.timeline, frame);
        const editKeyframeId =
          s.selectedTimelineKeyframeId && keyAtPlayhead?.id === s.selectedTimelineKeyframeId
            ? s.selectedTimelineKeyframeId
            : keyAtPlayhead?.id ?? null;

        if (editKeyframeId) {
          get().updateTimelineKeyframeGroup(editKeyframeId, groupId, localPatch);
          return;
        }

        set((state) => ({
          template: {
            ...state.template,
            groups: (state.template.groups ?? []).map((g) =>
              g.id === groupId
                ? { ...g, transform: { ...g.transform, ...localPatch } }
                : g,
            ),
          },
        }));
      },
    }),
    {
      limit: 50,
      partialize: (s) => ({
        template: s.template,
        selectedLayerIds: s.selectedLayerIds,
        // tool/zoom/snapToGrid/gridSize excluded
      }),
    }
  )
);

export const selectIsDirty = (s: EditorState) =>
  JSON.stringify(s.template) !== JSON.stringify(s.savedTemplate);
