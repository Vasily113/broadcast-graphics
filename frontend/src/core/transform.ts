import { Layer, LayerGroup, Transform, createDefaultTransform } from './schema';

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  anchorX: 0,
  anchorY: 0,
};

export function composeTransforms(parent: Transform, local: Transform): Transform {
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

export function getGroupChain(groupId: string | null | undefined, groups: LayerGroup[]): LayerGroup[] {
  const chain: LayerGroup[] = [];
  let id = groupId ?? null;
  const seen = new Set<string>();
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

export function accumulateParentTransform(
  chain: LayerGroup[],
  getTransform: (group: LayerGroup) => Transform,
): Transform {
  let acc = { ...IDENTITY_TRANSFORM, width: 0, height: 0 };
  for (const g of chain) {
    acc = composeTransforms(acc, getTransform(g));
  }
  return acc;
}

export function localToWorld(
  local: Transform,
  parentWorld: Transform,
): Transform {
  return composeTransforms(parentWorld, local);
}

export function worldToLocal(world: Transform, parentWorld: Transform): Transform {
  return {
    x: world.x - parentWorld.x,
    y: world.y - parentWorld.y,
    width: world.width,
    height: world.height,
    rotation: world.rotation - parentWorld.rotation,
    scaleX: parentWorld.scaleX !== 0 ? world.scaleX / parentWorld.scaleX : world.scaleX,
    scaleY: parentWorld.scaleY !== 0 ? world.scaleY / parentWorld.scaleY : world.scaleY,
    anchorX: world.anchorX,
    anchorY: world.anchorY,
  };
}

export function getLayerParentWorld(
  layer: Layer,
  groups: LayerGroup[],
  getGroupTransform: (group: LayerGroup) => Transform,
): Transform {
  const chain = getGroupChain(layer.groupId, groups);
  return accumulateParentTransform(chain, getGroupTransform);
}

export function createDefaultGroup(name = 'Группа', x = 0, y = 0): LayerGroup {
  return {
    id: crypto.randomUUID(),
    name,
    parentId: null,
    visible: true,
    locked: false,
    transform: { ...createDefaultTransform(x, y), width: 0, height: 0 },
  };
}
