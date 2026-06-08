/* eslint-disable */
/** Runtime timeline + layer stack (mirrors frontend/src/core/timeline.ts + stackOrder.ts) */
(function (global) {
  const POSITION_SIZE_PROPS = ['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY'];
  const DEFAULT_DIRECTOR_ID = 'default';

  function createDefaultTimeline() {
    return {
      fps: 50,
      durationFrames: 500,
      playbackMode: 'bounded',
      directors: [{ id: DEFAULT_DIRECTOR_ID, name: 'default', durationFrames: 125, offsetFrames: 0, autostart: true, loop: false }],
      trackDirectors: {},
      keyframes: [],
      actions: [],
    };
  }

  function normalizeTimeline(timeline) {
    if (!timeline) return createDefaultTimeline();
    const durationFrames = Math.max(1, timeline.durationFrames ?? 125);
    const directors = (timeline.directors && timeline.directors.length ? timeline.directors : [{
      id: DEFAULT_DIRECTOR_ID,
      name: 'default',
      durationFrames,
      offsetFrames: 0,
      autostart: true,
    }]).map((director, index) => ({
      id: director.id || (index === 0 ? DEFAULT_DIRECTOR_ID : `director-${index + 1}`),
      name: director.name || (index === 0 ? 'default' : `Director ${index + 1}`),
      durationFrames: Math.max(1, Math.round(director.durationFrames ?? durationFrames)),
      offsetFrames: Math.max(0, Math.round(director.offsetFrames ?? 0)),
      autostart: director.autostart ?? true,
      loop: director.loop ?? false,
    }));
    if (!directors.some((director) => director.id === DEFAULT_DIRECTOR_ID)) {
      directors.unshift({ id: DEFAULT_DIRECTOR_ID, name: 'default', durationFrames, offsetFrames: 0, autostart: true, loop: false });
    }
    const validDirectorIds = new Set(directors.map((director) => director.id));
    const trackDirectors = Object.fromEntries(
      Object.entries(timeline.trackDirectors || {}).filter(([, directorId]) => validDirectorIds.has(directorId)),
    );
    const actions = (timeline.actions || [])
      .filter((action) => validDirectorIds.has(action.directorId))
      .map((action) => {
        const director = directors.find((d) => d.id === action.directorId) || directors[0];
        return {
          id: action.id || `action-${Math.random().toString(36).slice(2)}`,
          directorId: action.directorId,
          frame: Math.max(0, Math.min(director.durationFrames, Math.round(action.frame || 0))),
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
      keyframes: [...(timeline.keyframes || [])]
        .map((kf) => ({ ...kf, layers: kf.layers || {}, groups: kf.groups || {} }))
        .sort((a, b) => a.frame - b.frame),
      actions,
    };
  }

  function createTimelinePlaybackState(directors) {
    return {
      directorPlayheads: Object.fromEntries(directors.map((director) => [director.id, 0])),
      directorActive: Object.fromEntries(directors.map((director) => [director.id, false])),
      directorStopped: {},
    };
  }

  function actionFrameCrossed(previousFrame, nextFrame, actionFrame) {
    return previousFrame !== nextFrame
      && previousFrame <= actionFrame
      && nextFrame >= actionFrame;
  }

  function computeDirectorPlayheads(
    directors,
    globalFrame,
    previousPlayheads,
    directorActive,
    directorStopped,
    frozenPlayheads,
    delta,
  ) {
    const loopedFrame = (value, director) => {
      if (!director.loop) return Math.max(0, Math.min(director.durationFrames, value));
      const period = director.durationFrames + 1;
      return ((Math.round(value) % period) + period) % period;
    };

    const playheads = {};
    directors.forEach((director) => {
      if (frozenPlayheads[director.id] !== undefined) {
        playheads[director.id] = frozenPlayheads[director.id];
        return;
      }
      if (directorStopped[director.id]) {
        playheads[director.id] = previousPlayheads[director.id] || 0;
        return;
      }
      if (director.autostart) {
        playheads[director.id] = loopedFrame(globalFrame - director.offsetFrames, director);
        return;
      }
      if (directorActive[director.id]) {
        const previous = previousPlayheads[director.id] || 0;
        playheads[director.id] = loopedFrame(previous + delta, director);
        return;
      }
      playheads[director.id] = Math.max(0, Math.min(director.durationFrames, previousPlayheads[director.id] || 0));
    });
    return playheads;
  }

  function stepTimelinePlayback(timeline, prevGlobalFrame, nextGlobalFrame, state) {
    const normalized = normalizeTimeline(timeline);
    const delta = Math.max(0, nextGlobalFrame - prevGlobalFrame);
    const previousPlayheads = { ...state.directorPlayheads };
    const directorActive = { ...state.directorActive };
    const directorStopped = { ...state.directorStopped };
    const frozenPlayheads = {};

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
      const prevSource = previousPlayheads[action.directorId] || 0;
      const nextSource = directorPlayheads[action.directorId] || 0;
      if (!actionFrameCrossed(prevSource, nextSource, action.frame)) return;

      if (action.command === 'startDirector' && action.targetDirectorId) {
        directorActive[action.targetDirectorId] = true;
        return;
      }

      if (action.command === 'stopDirector' && action.targetDirectorId) {
        directorActive[action.targetDirectorId] = false;
        directorStopped[action.targetDirectorId] = true;
        frozenPlayheads[action.targetDirectorId] = directorPlayheads[action.targetDirectorId] || 0;
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
      state: { directorPlayheads, directorActive, directorStopped },
    };
  }

  function getTimelineTrackKey(kind, targetId, prop) {
    return `${kind}:${targetId}:${prop}`;
  }

  function getDirectorForTrack(timeline, kind, targetId, prop) {
    const normalized = normalizeTimeline(timeline);
    const directorId = normalized.trackDirectors[getTimelineTrackKey(kind, targetId, prop)] || DEFAULT_DIRECTOR_ID;
    return normalized.directors.find((director) => director.id === directorId)
      || normalized.directors[0]
      || { id: DEFAULT_DIRECTOR_ID, name: 'default', durationFrames: normalized.durationFrames, offsetFrames: 0 };
  }

  function normalizeStack(template, parentId) {
    const groups = template.groups || [];
    const childGroupIds = new Set(groups.filter((g) => (g.parentId ?? null) === parentId).map((g) => g.id));
    const childLayerIds = new Set(
      (template.layers || [])
        .filter((l) => {
          if (parentId) return l.groupId === parentId;
          return !l.groupId || !groups.some((g) => g.id === l.groupId);
        })
        .map((l) => l.id),
    );
    const stored = parentId ? template.groupStacks?.[parentId] : template.rootStack;
    if (stored?.length) {
      const valid = stored.filter((e) =>
        e.kind === 'group' ? childGroupIds.has(e.id) : childLayerIds.has(e.id),
      );
      const seen = new Set(valid.map((e) => `${e.kind}:${e.id}`));
      childGroupIds.forEach((id) => { if (!seen.has(`group:${id}`)) valid.push({ kind: 'group', id }); });
      childLayerIds.forEach((id) => { if (!seen.has(`layer:${id}`)) valid.push({ kind: 'layer', id }); });
      return valid;
    }
    const stack = [];
    groups.filter((g) => (g.parentId ?? null) === parentId).forEach((g) => stack.push({ kind: 'group', id: g.id }));
    (template.layers || []).filter((l) => childLayerIds.has(l.id)).forEach((l) => stack.push({ kind: 'layer', id: l.id }));
    return stack;
  }

  function flattenLayersInStackOrder(template) {
    const rootStack = normalizeStack(template, null);
    const ordered = [];
    function emitGroup(groupId) {
      for (const entry of normalizeStack(template, groupId)) {
        if (entry.kind === 'layer') {
          const layer = (template.layers || []).find((l) => l.id === entry.id);
          if (layer) ordered.push(layer);
        } else emitGroup(entry.id);
      }
    }
    for (const entry of rootStack) {
      if (entry.kind === 'layer') {
        const layer = (template.layers || []).find((l) => l.id === entry.id);
        if (layer && !layer.groupId) ordered.push(layer);
      } else emitGroup(entry.id);
    }
    const placed = new Set(ordered.map((l) => l.id));
    (template.layers || []).forEach((l) => { if (!placed.has(l.id)) ordered.push(l); });
    return ordered;
  }

  const IDENTITY = { x: 0, y: 0, width: 0, height: 0, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 };

  function composeTransforms(parent, local) {
    return {
      x: parent.x + local.x,
      y: parent.y + local.y,
      width: local.width,
      height: local.height,
      rotation: parent.rotation + local.rotation,
      scaleX: parent.scaleX * local.scaleX,
      scaleY: parent.scaleY * local.scaleY,
      anchorX: local.anchorX,
      anchorY: local.anchorY,
    };
  }

  function getGroupChain(groupId, groups) {
    const chain = [];
    let id = groupId ?? null;
    const seen = new Set();
    while (id) {
      if (seen.has(id)) break;
      seen.add(id);
      const g = groups.find((x) => x.id === id);
      if (!g) break;
      chain.unshift(g);
      id = g.parentId;
    }
    return chain;
  }

  function accumulateParentTransform(chain, getTransform) {
    let acc = { ...IDENTITY, width: 0, height: 0 };
    for (const g of chain) acc = composeTransforms(acc, getTransform(g));
    return acc;
  }

  function localToWorld(local, parentWorld) {
    return composeTransforms(parentWorld, local);
  }

  function getLayerParentWorld(layer, groups, getGroupTransform) {
    const chain = getGroupChain(layer.groupId, groups);
    return accumulateParentTransform(chain, getGroupTransform);
  }

  function cubicBezierY(t, cp) {
    const cx = 3 * cp.cp1x;
    const bx = 3 * (cp.cp2x - cp.cp1x) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * cp.cp1y;
    const by = 3 * (cp.cp2y - cp.cp1y) - cy;
    const ay = 1 - cy - by;
    const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
    const sampleY = (u) => ((ay * u + by) * u + cy) * u;
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (sampleX(mid) < t) lo = mid; else hi = mid;
    }
    return sampleY((lo + hi) / 2);
  }

  function applySegmentEase(t, easing, bezier) {
    if (bezier) return cubicBezierY(t, bezier);
    if (easing === 'linear') return t;
    return gsap.parseEase(easing)(t);
  }

  function getPropValue(base, kind, targetId, prop, frame, sortedKeys) {
    const keysWithProp = sortedKeys.filter((kf) => {
      const bag = kind === 'layer' ? kf.layers[targetId] : kf.groups[targetId];
      return bag && bag[prop] !== undefined;
    });
    if (!keysWithProp.length) return base;
    if (frame < keysWithProp[0].frame) return base;
    let prevFrame = -1, prevVal = base, nextFrame = Infinity, nextVal = base;
    let segmentEasing = 'linear', segmentBezier;
    for (const kf of keysWithProp) {
      const bag = kind === 'layer' ? kf.layers[targetId] : kf.groups[targetId];
      const v = bag[prop];
      if (kf.frame <= frame && kf.frame > prevFrame) { prevFrame = kf.frame; prevVal = v; }
      if (kf.frame > frame && kf.frame < nextFrame) {
        nextFrame = kf.frame; nextVal = v;
        segmentEasing = kf.easing; segmentBezier = kf.bezier;
      }
    }
    if (frame >= prevFrame && nextFrame === Infinity) return prevVal;
    if (prevFrame < 0 || nextFrame === Infinity) return base;
    if (prevFrame === nextFrame) return prevVal;
    const t = (frame - prevFrame) / (nextFrame - prevFrame);
    return prevVal + (nextVal - prevVal) * applySegmentEase(t, segmentEasing, segmentBezier);
  }

  function getLocalTransformAtFrame(base, kind, targetId, timeline, frame) {
    const normalized = normalizeTimeline(timeline);
    const sorted = [...normalized.keyframes].sort((a, b) => a.frame - b.frame);
    const t = { ...base };
    for (const prop of POSITION_SIZE_PROPS) {
      const director = getDirectorForTrack(normalized, kind, targetId, prop);
      const rawLocalFrame = typeof frame === 'number'
        ? (director.autostart ? frame - director.offsetFrames : 0)
        : (frame[director.id] || 0);
      const period = director.durationFrames + 1;
      const localFrame = director.loop
        ? ((Math.round(rawLocalFrame) % period) + period) % period
        : Math.max(0, Math.min(director.durationFrames, rawLocalFrame));
      t[prop] = getPropValue(
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

  function getGroupLocalTransformAtFrame(group, timeline, frame) {
    return getLocalTransformAtFrame(group.transform, 'group', group.id, timeline, frame);
  }

  function getLayerLocalTransformAtFrame(layer, timeline, frame) {
    return getLocalTransformAtFrame(layer.transform, 'layer', layer.id, timeline, frame);
  }

  function getLayerWorldTransformAtFrame(layer, template, frame) {
    const timeline = normalizeTimeline(template.timeline);
    const groups = template.groups || [];
    const parentWorld = getLayerParentWorld(layer, groups, (g) =>
      getGroupLocalTransformAtFrame(g, timeline, frame),
    );
    const local = getLayerLocalTransformAtFrame(layer, timeline, frame);
    return localToWorld(local, parentWorld);
  }

  function buildTemplateAtFrame(template, frame) {
    const timeline = normalizeTimeline(template.timeline);
    const groups = template.groups || [];
    return {
      ...template,
      groups: groups.map((g) => ({
        ...g,
        transform: getGroupLocalTransformAtFrame(g, timeline, frame),
      })),
      layers: (template.layers || []).map((layer) => ({
        ...layer,
        transform: getLayerWorldTransformAtFrame(layer, { ...template, timeline, groups }, frame),
      })),
    };
  }

  function hasAnyTimelineKeys(timeline) {
    const t = normalizeTimeline(timeline);
    return t.actions.length > 0 || t.keyframes.some(
      (kf) => Object.keys(kf.layers).length > 0 || Object.keys(kf.groups).length > 0,
    );
  }

  function prepareTemplateForRender(template, frame) {
    const t = {
      ...template,
      groups: template.groups || [],
      layers: (template.layers || []).map((l) => ({ ...l, groupId: l.groupId ?? null })),
      timeline: normalizeTimeline(template.timeline),
    };
    const hasGroups = t.groups.length > 0;
    const withTimeline = hasAnyTimelineKeys(t.timeline);
    const resolved = hasGroups || withTimeline ? buildTemplateAtFrame(t, frame) : t;
    return { ...resolved, layers: flattenLayersInStackOrder(resolved) };
  }

  global.TimelineRuntime = {
    normalizeTimeline,
    createTimelinePlaybackState,
    stepTimelinePlayback,
    flattenLayersInStackOrder,
    buildTemplateAtFrame,
    hasAnyTimelineKeys,
    prepareTemplateForRender,
  };
})(typeof window !== 'undefined' ? window : globalThis);
