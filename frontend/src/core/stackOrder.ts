import { Layer, RootStackEntry, Template } from './schema';

export function normalizeStack(template: Template, parentId: string | null): RootStackEntry[] {
  const groups = template.groups ?? [];
  const childGroupIds = new Set(groups.filter((g) => (g.parentId ?? null) === parentId).map((g) => g.id));
  const childLayerIds = new Set(
    template.layers
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
    childGroupIds.forEach((id) => {
      if (!seen.has(`group:${id}`)) valid.push({ kind: 'group', id });
    });
    childLayerIds.forEach((id) => {
      if (!seen.has(`layer:${id}`)) valid.push({ kind: 'layer', id });
    });
    return valid;
  }

  const stack: RootStackEntry[] = [];
  groups.filter((g) => (g.parentId ?? null) === parentId).forEach((g) => stack.push({ kind: 'group', id: g.id }));
  template.layers
    .filter((l) => childLayerIds.has(l.id))
    .forEach((l) => stack.push({ kind: 'layer', id: l.id }));
  return stack;
}

export function normalizeRootStack(template: Template): RootStackEntry[] {
  return normalizeStack(template, null);
}

function emitGroupLayers(
  template: Template,
  groupId: string,
  out: Layer[],
): void {
  for (const entry of normalizeStack(template, groupId)) {
    if (entry.kind === 'layer') {
      const layer = template.layers.find((l) => l.id === entry.id);
      if (layer) out.push(layer);
    } else {
      emitGroupLayers(template, entry.id, out);
    }
  }
}

/** Paint order: back → front (matches layers panel top = front). */
export function flattenLayersInStackOrder(template: Template): Layer[] {
  const rootStack = normalizeRootStack(template);
  const ordered: Layer[] = [];

  for (const entry of rootStack) {
    if (entry.kind === 'layer') {
      const layer = template.layers.find((l) => l.id === entry.id);
      if (layer && !layer.groupId) ordered.push(layer);
    } else {
      emitGroupLayers(template, entry.id, ordered);
    }
  }

  const placed = new Set(ordered.map((l) => l.id));
  template.layers.forEach((l) => {
    if (!placed.has(l.id)) ordered.push(l);
  });

  return ordered;
}

export function rebuildLayersArray(template: Template): Layer[] {
  return flattenLayersInStackOrder(template);
}

export function removeFromRootStack(stack: RootStackEntry[], kind: 'layer' | 'group', id: string): RootStackEntry[] {
  return stack.filter((e) => !(e.kind === kind && e.id === id));
}

export function addToRootStack(
  stack: RootStackEntry[],
  entry: RootStackEntry,
  position: 'start' | 'end' = 'start',
): RootStackEntry[] {
  const filtered = removeFromRootStack(stack, entry.kind, entry.id);
  return position === 'start' ? [entry, ...filtered] : [...filtered, entry];
}

export function normalizeAllStacks(template: Template): Pick<Template, 'rootStack' | 'groupStacks'> {
  const groupStacks: Record<string, RootStackEntry[]> = {};
  (template.groups ?? []).forEach((g) => {
    groupStacks[g.id] = normalizeStack(template, g.id);
  });
  return {
    rootStack: normalizeStack(template, null),
    groupStacks,
  };
}
