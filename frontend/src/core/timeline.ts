import { gsap } from 'gsap';
import {
  createDefaultTimeline,
  Layer,
  LayerGroup,
  POSITION_SIZE_PROPS,
  PositionSizeProp,
  PositionSizeValues,
  Template,
  Timeline,
  TimelineDirector,
  TimelineKeyframe,
  Transform,
  BezierHandle,
} from './schema';
import { flattenLayersInStackOrder, normalizeAllStacks } from './stackOrder';
import {
  accumulateParentTransform,
  getGroupChain,
  getLayerParentWorld,
  IDENTITY_TRANSFORM,
  localToWorld,
  worldToLocal,
} from './transform';
import { generateId } from './id';

export type AnimTargetKind = 'layer' | 'group';
export const DEFAULT_DIRECTOR_ID = 'default';
export type TimelineFrame = number | Record<string, number>;

export function getTimelineTrackKey(kind: AnimTargetKind, targetId: string, prop: PositionSizeProp): string {
  return `${kind}:${targetId}:${prop}`;
}

function createDefaultDirector(durationFrames = 125): TimelineDirector {
  return {
    id: DEFAULT_DIRECTOR_ID,
    name: 'default',
    durationFrames,
    offsetFrames: 0,
    autostart: true,
    loop: false,
  };
}

export function normalizeTimeline(timeline?: Timeline): Timeline {
  if (!timeline) return createDefaultTimeline();
  const durationFrames = Math.max(1, timeline.durationFrames ?? 125);
  const sourceDirectors = timeline.directors?.length
    ? timeline.directors
    : [createDefaultDirector(durationFrames)];
  const seen = new Set<string>();
  const directors = sourceDirectors
    .map((director, index) => ({
    id: director.id || (index === 0 ? DEFAULT_DIRECTOR_ID : generateId()),
      name: director.name || (index === 0 ? 'default' : `Director ${index + 1}`),
      durationFrames: Math.max(1, Math.round(director.durationFrames ?? durationFrames)),
      offsetFrames: Math.max(0, Math.round(director.offsetFrames ?? 0)),
      autostart: director.autostart ?? true,
      loop: director.loop ?? false,
    }))
    .filter((director) => {
      if (seen.has(director.id)) return false;
      seen.add(director.id);
      return true;
    });
  if (!directors.some((director) => director.id === DEFAULT_DIRECTOR_ID)) {
    directors.unshift(createDefaultDirector(durationFrames));
  }
  const validDirectorIds = new Set(directors.map((director) => director.id));
  const trackDirectors = Object.fromEntries(
    Object.entries(timeline.trackDirectors ?? {}).filter(([, directorId]) => validDirectorIds.has(directorId)),
  );
  const actions = (timeline.actions ?? [])
    .filter((action) => validDirectorIds.has(action.directorId))
    .map((action) => {
      const director = directors.find((d) => d.id === action.directorId) ?? directors[0];
      return {
        id: action.id || generateId(),
        directorId: action.directorId,
        frame: Math.max(0, Math.min(director.durationFrames, Math.round(action.frame ?? 0))),
        command: action.command === 'startDirector' || action.command === 'stopDirector'
          ? action.command
          : 'startDirector',
        targetDirectorId: action.targetDirectorId && validDirectorIds.has(action.targetDirectorId)
          ? action.targetDirectorId
          : null,
      };
    })
    .sort((a, b) => a.frame - b.frame);
  return {
    fps: 50,
    durationFrames,
    playbackMode: timeline.playbackMode === 'infinite' ? 'infinite' : 'bounded',
    directors,
    trackDirectors,
    keyframes: [...(timeline.keyframes ?? [])].map((kf) => ({
      ...kf,
      layers: kf.layers ?? {},
      groups: kf.groups ?? {},
    })).sort((a, b) => a.frame - b.frame),
    actions,
  };
}

export function getDirectorForTrack(
  timeline: Timeline,
  kind: AnimTargetKind,
  targetId: string,
  prop: PositionSizeProp,
): TimelineDirector {
  const normalized = normalizeTimeline(timeline);
  const directorId = normalized.trackDirectors[getTimelineTrackKey(kind, targetId, prop)] ?? DEFAULT_DIRECTOR_ID;
  return normalized.directors.find((director) => director.id === directorId)
    ?? normalized.directors[0]
    ?? createDefaultDirector(normalized.durationFrames);
}

export function getDirectorLocalFrame(director: TimelineDirector, frame: TimelineFrame): number {
  const localFrame = typeof frame === 'number'
    ? (director.autostart ? frame - director.offsetFrames : 0)
    : (frame[director.id] ?? 0);
  if (director.loop) {
    const period = director.durationFrames + 1;
    const wrapped = ((Math.round(localFrame) % period) + period) % period;
    return wrapped;
  }
  return Math.max(0, Math.min(director.durationFrames, localFrame));
}

export interface TimelinePlaybackState {
  directorPlayheads: Record<string, number>;
  directorActive: Record<string, boolean>;
  directorStopped: Record<string, boolean>;
}

export function createTimelinePlaybackState(directors: TimelineDirector[]): TimelinePlaybackState {
  return {
    directorPlayheads: Object.fromEntries(directors.map((director) => [director.id, 0])),
    directorActive: Object.fromEntries(directors.map((director) => [director.id, false])),
    directorStopped: {},
  };
}

function actionFrameCrossed(previousFrame: number, nextFrame: number, actionFrame: number): boolean {
  return previousFrame !== nextFrame
    && previousFrame <= actionFrame
    && nextFrame >= actionFrame;
}

function computeDirectorPlayheads(
  directors: TimelineDirector[],
  globalFrame: number,
  previousPlayheads: Record<string, number>,
  directorActive: Record<string, boolean>,
  directorStopped: Record<string, boolean>,
  frozenPlayheads: Record<string, number>,
  delta: number,
): Record<string, number> {
  const loopedFrame = (value: number, director: TimelineDirector) => {
    if (!director.loop) return Math.max(0, Math.min(director.durationFrames, value));
    const period = director.durationFrames + 1;
    return ((Math.round(value) % period) + period) % period;
  };

  const playheads: Record<string, number> = {};
  directors.forEach((director) => {
    if (frozenPlayheads[director.id] !== undefined) {
      playheads[director.id] = frozenPlayheads[director.id];
      return;
    }
    if (directorStopped[director.id]) {
      playheads[director.id] = previousPlayheads[director.id] ?? 0;
      return;
    }
    if (director.autostart) {
      playheads[director.id] = loopedFrame(globalFrame - director.offsetFrames, director);
      return;
    }
    if (directorActive[director.id]) {
      const previous = previousPlayheads[director.id] ?? 0;
      playheads[director.id] = loopedFrame(previous + delta, director);
      return;
    }
    playheads[director.id] = Math.max(0, Math.min(director.durationFrames, previousPlayheads[director.id] ?? 0));
  });
  return playheads;
}

/** Advance timeline playback by one step; handles start/stop director actions. */
export function stepTimelinePlayback(
  timeline: Timeline,
  prevGlobalFrame: number,
  nextGlobalFrame: number,
  state: TimelinePlaybackState,
): { nextGlobalFrame: number; state: TimelinePlaybackState } {
  const normalized = normalizeTimeline(timeline);
  const delta = Math.max(0, nextGlobalFrame - prevGlobalFrame);
  const previousPlayheads = { ...state.directorPlayheads };
  const directorActive = { ...state.directorActive };
  const directorStopped = { ...state.directorStopped };
  const frozenPlayheads: Record<string, number> = {};

  let directorPlayheads = computeDirectorPlayheads(
    normalized.directors,
    nextGlobalFrame,
    previousPlayheads,
    directorActive,
    directorStopped,
    frozenPlayheads,
    delta,
  );

  normalized.actions.forEach((action) => {
    const prevSource = previousPlayheads[action.directorId] ?? 0;
    const nextSource = directorPlayheads[action.directorId] ?? 0;
    if (!actionFrameCrossed(prevSource, nextSource, action.frame)) return;

    if (action.command === 'startDirector' && action.targetDirectorId) {
      directorActive[action.targetDirectorId] = true;
      return;
    }

    if (action.command === 'stopDirector' && action.targetDirectorId) {
      directorActive[action.targetDirectorId] = false;
      directorStopped[action.targetDirectorId] = true;
      frozenPlayheads[action.targetDirectorId] = directorPlayheads[action.targetDirectorId] ?? 0;
    }
  });

  if (Object.keys(frozenPlayheads).length > 0) {
    directorPlayheads = computeDirectorPlayheads(
      normalized.directors,
      nextGlobalFrame,
      previousPlayheads,
      directorActive,
      directorStopped,
      frozenPlayheads,
      delta,
    );
  }

  return {
    nextGlobalFrame,
    state: {
      directorPlayheads,
      directorActive,
      directorStopped,
    },
  };
}

export function normalizeTemplate(template: Template): Template {
  const groups = template.groups ?? [];
  const base = {
    ...template,
    groups,
    layers: template.layers.map((l) => ({
      ...l,
      groupId: l.groupId ?? null,
    })),
    timeline: normalizeTimeline(template.timeline),
  };
  return {
    ...base,
    ...normalizeAllStacks(base),
    layers: flattenLayersInStackOrder(base),
  };
}

export function getSortedKeyframes(timeline: Timeline): TimelineKeyframe[] {
  return [...timeline.keyframes].sort((a, b) => a.frame - b.frame);
}

export function findKeyframeAtFrame(timeline: Timeline, frame: number): TimelineKeyframe | undefined {
  return timeline.keyframes.find((kf) => kf.frame === frame);
}

function getTargetValues(
  kf: TimelineKeyframe,
  kind: AnimTargetKind,
  targetId: string,
): PositionSizeValues | undefined {
  return kind === 'layer' ? kf.layers[targetId] : kf.groups[targetId];
}

function getKeysForProp(
  sortedKeys: TimelineKeyframe[],
  kind: AnimTargetKind,
  targetId: string,
  prop: PositionSizeProp,
): TimelineKeyframe[] {
  return sortedKeys.filter((kf) => {
    const bag = getTargetValues(kf, kind, targetId);
    return bag && bag[prop] !== undefined;
  });
}

function cubicBezierY(t: number, cp: BezierHandle): number {
  const cx = 3 * cp.cp1x;
  const bx = 3 * (cp.cp2x - cp.cp1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * cp.cp1y;
  const by = 3 * (cp.cp2y - cp.cp1y) - cy;
  const ay = 1 - cy - by;

  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (sampleX(mid) < t) lo = mid;
    else hi = mid;
  }
  const u = (lo + hi) / 2;
  return sampleY(u);
}

function applySegmentEase(t: number, easing: TimelineKeyframe['easing'], bezier?: BezierHandle): number {
  if (bezier) return cubicBezierY(t, bezier);
  if (easing === 'linear') return t;
  return gsap.parseEase(easing)(t);
}

function getPropValue(
  base: number,
  kind: AnimTargetKind,
  targetId: string,
  prop: PositionSizeProp,
  frame: number,
  sortedKeys: TimelineKeyframe[],
): number {
  const keysWithProp = getKeysForProp(sortedKeys, kind, targetId, prop);
  if (keysWithProp.length === 0) return base;

  const firstKey = keysWithProp[0];
  if (frame < firstKey.frame) return base;

  let prevFrame = -1;
  let prevVal = base;
  let nextFrame = Infinity;
  let nextVal = base;
  let segmentEasing: TimelineKeyframe['easing'] = 'linear';
  let segmentBezier: BezierHandle | undefined;

  for (const kf of keysWithProp) {
    const bag = getTargetValues(kf, kind, targetId)!;
    const v = bag[prop]!;
    if (kf.frame <= frame && kf.frame > prevFrame) {
      prevFrame = kf.frame;
      prevVal = v;
    }
    if (kf.frame > frame && kf.frame < nextFrame) {
      nextFrame = kf.frame;
      nextVal = v;
      segmentEasing = kf.easing;
      segmentBezier = kf.bezier;
    }
  }

  if (frame >= prevFrame && nextFrame === Infinity) return prevVal;
  if (prevFrame < 0 || nextFrame === Infinity) return base;
  if (prevFrame === nextFrame) return prevVal;

  const t = (frame - prevFrame) / (nextFrame - prevFrame);
  const eased = applySegmentEase(t, segmentEasing, segmentBezier);
  return prevVal + (nextVal - prevVal) * eased;
}

export function getLocalTransformAtFrame(
  base: Transform,
  kind: AnimTargetKind,
  targetId: string,
  timeline: Timeline,
  frame: TimelineFrame,
): Transform {
  const normalized = normalizeTimeline(timeline);
  const sorted = getSortedKeyframes(normalized);
  const t = { ...base };
  for (const prop of POSITION_SIZE_PROPS) {
    const director = getDirectorForTrack(normalized, kind, targetId, prop);
    const localFrame = getDirectorLocalFrame(director, frame);
    (t as Record<PositionSizeProp, number>)[prop] = getPropValue(
      base[prop],
      kind,
      targetId,
      prop,
      localFrame,
      sorted,
    );
  }
  return t;
}

export function getGroupLocalTransformAtFrame(group: LayerGroup, timeline: Timeline, frame: TimelineFrame): Transform {
  return getLocalTransformAtFrame(group.transform, 'group', group.id, timeline, frame);
}

export function getLayerLocalTransformAtFrame(layer: Layer, timeline: Timeline, frame: TimelineFrame): Transform {
  return getLocalTransformAtFrame(layer.transform, 'layer', layer.id, timeline, frame);
}

export function getLayerWorldTransformAtFrame(
  layer: Layer,
  template: Template,
  frame: TimelineFrame,
): Transform {
  const timeline = normalizeTimeline(template.timeline);
  const groups = template.groups ?? [];
  const parentWorld = getLayerParentWorld(layer, groups, (g) =>
    getGroupLocalTransformAtFrame(g, timeline, frame),
  );
  const local = getLayerLocalTransformAtFrame(layer, timeline, frame);
  return localToWorld(local, parentWorld);
}

export function getGroupWorldTransformAtFrame(
  group: LayerGroup,
  template: Template,
  frame: TimelineFrame,
): Transform {
  const timeline = normalizeTimeline(template.timeline);
  const groups = template.groups ?? [];
  const chain = getGroupChain(group.parentId, groups);
  const parentWorld = accumulateParentTransform(chain, (g) =>
    getGroupLocalTransformAtFrame(g, timeline, frame),
  );
  const local = getGroupLocalTransformAtFrame(group, timeline, frame);
  return localToWorld(local, parentWorld);
}

export function buildTemplateAtFrame(template: Template, frame: TimelineFrame): Template {
  const timeline = normalizeTimeline(template.timeline);
  const groups = template.groups ?? [];
  return {
    ...template,
    groups: groups.map((g) => ({
      ...g,
      transform: getGroupLocalTransformAtFrame(g, timeline, frame),
    })),
    layers: template.layers.map((layer) => ({
      ...layer,
      transform: getLayerWorldTransformAtFrame(layer, { ...template, timeline, groups }, frame),
    })),
  };
}

/** Resolved world transforms + paint order for on-air / renderer output. */
export function prepareTemplateForRender(template: Template, frame: TimelineFrame): Template {
  const base = normalizeTemplate(template);
  const hasGroups = (base.groups ?? []).length > 0;
  const withTimeline = hasAnyTimelineKeys(base.timeline);
  const resolved =
    hasGroups || withTimeline ? buildTemplateAtFrame(base, frame) : base;
  return {
    ...resolved,
    layers: flattenLayersInStackOrder(resolved),
  };
}

export function getEditorDisplayTemplate(template: Template, frame: TimelineFrame): Template {
  const timeline = normalizeTimeline(template.timeline);
  const hasGroups = (template.groups ?? []).length > 0;
  const withTimeline = hasAnyTimelineKeys(timeline);
  const resolved =
    hasGroups || withTimeline ? buildTemplateAtFrame(template, frame) : template;
  return {
    ...resolved,
    ...normalizeAllStacks(template),
    layers: flattenLayersInStackOrder(resolved),
  };
}

export function captureLocalValuesForKeyframe(
  template: Template,
  frame: number,
  layerIds: string[],
  groupIds: string[],
): { layers: Record<string, PositionSizeValues>; groups: Record<string, PositionSizeValues> } {
  const timeline = normalizeTimeline(template.timeline);
  const layers: Record<string, PositionSizeValues> = {};
  const groups: Record<string, PositionSizeValues> = {};

  for (const id of layerIds) {
    const layer = template.layers.find((l) => l.id === id);
    if (!layer) continue;
    const local = getLayerLocalTransformAtFrame(layer, timeline, frame);
    layers[id] = {
      x: local.x,
      y: local.y,
      width: local.width,
      height: local.height,
      rotation: local.rotation,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
    };
  }

  for (const id of groupIds) {
    const group = (template.groups ?? []).find((g) => g.id === id);
    if (!group) continue;
    const local = getGroupLocalTransformAtFrame(group, timeline, frame);
    groups[id] = {
      x: local.x,
      y: local.y,
      width: local.width,
      height: local.height,
      rotation: local.rotation,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
    };
  }

  return { layers, groups };
}

export function mergeKeyframeTargets(
  existingLayers: Record<string, PositionSizeValues>,
  existingGroups: Record<string, PositionSizeValues>,
  captured: { layers: Record<string, PositionSizeValues>; groups: Record<string, PositionSizeValues> },
): { layers: Record<string, PositionSizeValues>; groups: Record<string, PositionSizeValues> } {
  const layers = { ...existingLayers };
  const groups = { ...existingGroups };
  for (const [id, values] of Object.entries(captured.layers)) {
    layers[id] = { ...(layers[id] ?? {}), ...values };
  }
  for (const [id, values] of Object.entries(captured.groups)) {
    groups[id] = { ...(groups[id] ?? {}), ...values };
  }
  return { layers, groups };
}

export function purgeTargetFromTimeline(timeline: Timeline, kind: AnimTargetKind, targetId: string): Timeline {
  const keyframes = timeline.keyframes
    .map((kf) => {
      if (kind === 'layer') {
        const layers = { ...kf.layers };
        delete layers[targetId];
        return { ...kf, layers };
      }
      const groups = { ...kf.groups };
      delete groups[targetId];
      return { ...kf, groups };
    })
    .filter((kf) => Object.keys(kf.layers).length > 0 || Object.keys(kf.groups).length > 0);
  return { ...timeline, keyframes };
}

export function hasAnyTimelineKeys(timeline?: Timeline): boolean {
  const t = normalizeTimeline(timeline);
  return t.actions.length > 0 || t.keyframes.some(
    (kf) => Object.keys(kf.layers).length > 0 || Object.keys(kf.groups).length > 0,
  );
}

export function layerHasPropKey(
  timeline: Timeline,
  layerId: string,
  prop: PositionSizeProp,
): boolean {
  return timeline.keyframes.some((kf) => kf.layers[layerId]?.[prop] !== undefined);
}

export function groupHasPropKey(
  timeline: Timeline,
  groupId: string,
  prop: PositionSizeProp,
): boolean {
  return timeline.keyframes.some((kf) => kf.groups[groupId]?.[prop] !== undefined);
}

function getGroupParentWorldAtFrame(
  groupId: string | null,
  template: Template,
  frame: number,
): Transform {
  if (!groupId) return { ...IDENTITY_TRANSFORM, width: 0, height: 0 };
  const groups = template.groups ?? [];
  const group = groups.find((g) => g.id === groupId);
  if (!group) return { ...IDENTITY_TRANSFORM, width: 0, height: 0 };
  return getGroupWorldTransformAtFrame(group, template, frame);
}

export function reparentLayerTransform(
  layer: Layer,
  template: Template,
  newGroupId: string | null,
  frame: number,
): Transform {
  const world = getLayerWorldTransformAtFrame(layer, template, frame);
  const parentWorld = getGroupParentWorldAtFrame(newGroupId, template, frame);
  return worldToLocal(world, parentWorld);
}

export function remapLayerTimelineForReparent(
  template: Template,
  layerId: string,
  oldGroupId: string | null,
  newGroupId: string | null,
): Timeline {
  const timeline = normalizeTimeline(template.timeline);
  const layer = template.layers.find((l) => l.id === layerId);
  if (!layer) return timeline;

  const keyframes = timeline.keyframes.map((kf) => {
    const vals = kf.layers[layerId];
    if (!vals) return kf;

    const frame = kf.frame;
    const layerAtFrame = { ...layer, groupId: oldGroupId };
    const localAtFrame = getLayerLocalTransformAtFrame(layerAtFrame, timeline, frame);
    const oldParent = getGroupParentWorldAtFrame(oldGroupId, template, frame);
    const world = localToWorld(localAtFrame, oldParent);
    const newParent = getGroupParentWorldAtFrame(newGroupId, template, frame);
    const newLocal = worldToLocal(world, newParent);

    const newVals: PositionSizeValues = {};
    for (const prop of POSITION_SIZE_PROPS) {
      if (vals[prop] !== undefined) {
        newVals[prop] = newLocal[prop];
      }
    }
    return { ...kf, layers: { ...kf.layers, [layerId]: newVals } };
  });

  return { ...timeline, keyframes };
}
