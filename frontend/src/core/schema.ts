export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';
export type EasingType = 'linear' | 'power2.out' | 'power2.in' | 'bounce.out' | 'elastic.out';

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  anchorX: number;
  anchorY: number;
}

export interface VariableBinding {
  type: 'variable';
  variableId: string;
}

export interface Variable {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'image' | 'number' | 'color' | 'video';
  defaultValue: string | number;
}

export interface LayerGroup {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  transform: Transform;
}

/** Порядок корневых элементов в панели слоёв (сверху = ближе к зрителю). */
export type RootStackEntry = { kind: 'layer' | 'group'; id: string };

export interface BaseLayer {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  transform: Transform;
  groupId: string | null;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string | VariableBinding;
  style: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fill: string | VariableBinding;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
    letterSpacing: number;
    strokeColor: string;
    strokeWidth: number;
    dropShadow: boolean;
    dropShadowBlur: number;
    dropShadowColor: string;
    dropShadowDistance: number;
  };
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string | VariableBinding;
  cornerRadius: number;
  fit: 'stretch' | 'contain' | 'cover';
}

export interface RectLayer extends BaseLayer {
  type: 'rect';
  fill: string | VariableBinding;
  cornerRadius: number;
  borderColor: string;
  borderWidth: number;
}

export interface ClockLayer extends BaseLayer {
  type: 'clock';
  mode: 'clock' | 'countup' | 'countdown';
  format: string;
  startTime?: number;
  targetTime?: number;
  style: TextLayer['style'];
}

export interface VideoLayer extends BaseLayer {
  type: 'video';
  src: string | VariableBinding;
  loop: boolean;
  fit: 'stretch' | 'contain' | 'cover';
}

export type Layer = TextLayer | ImageLayer | RectLayer | ClockLayer | VideoLayer;

/** Параметры группы «Позиция и размер» для ключей таймлайна */
export const POSITION_SIZE_PROPS = ['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY'] as const;
export type PositionSizeProp = (typeof POSITION_SIZE_PROPS)[number];
export type PositionSizeValues = Partial<Record<PositionSizeProp, number>>;

export interface BezierHandle {
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
}

export const DEFAULT_BEZIER: BezierHandle = { cp1x: 0.25, cp1y: 0.1, cp2x: 0.25, cp2y: 1 };

/** Ключевой кадр на таймлайне (локальные значения по слоям и группам) */
export interface TimelineKeyframe {
  id: string;
  frame: number;
  layers: Record<string, PositionSizeValues>;
  groups: Record<string, PositionSizeValues>;
  easing: EasingType;
  bezier?: BezierHandle;
}

export interface TimelineDirector {
  id: string;
  name: string;
  durationFrames: number;
  offsetFrames: number;
  autostart: boolean;
  loop: boolean;
  swing: boolean;
}

export type TimelineActionCommand = 'startDirector' | 'stopDirector' | 'setTag';

export type TimelineActionTag = 'Stop' | 'End scene';

export const TIMELINE_ACTION_TAGS: TimelineActionTag[] = ['Stop', 'End scene'];

export interface TimelineAction {
  id: string;
  directorId: string;
  frame: number;
  command: TimelineActionCommand;
  targetDirectorId: string | null;
  /** setTag command: which tag to set (e.g. Stop). */
  tag: TimelineActionTag | null;
}

export interface Timeline {
  fps: number;
  /** Номер последнего кадра (включительно): при 100 доступны кадры 0…100 */
  durationFrames: number;
  playbackMode: 'bounded' | 'infinite';
  directors: TimelineDirector[];
  trackDirectors: Record<string, string>;
  keyframes: TimelineKeyframe[];
  actions: TimelineAction[];
}

export interface Template {
  id: string;
  name: string;
  canvas: {
    width: number;
    height: number;
    background: string;
  };
  variables: Variable[];
  groups?: LayerGroup[];
  layers: Layer[];
  rootStack?: RootStackEntry[];
  groupStacks?: Record<string, RootStackEntry[]>;
  timeline: Timeline;
}

export function createDefaultTimeline(): Timeline {
  const defaultDirector: TimelineDirector = {
    id: 'default',
    name: 'default',
    durationFrames: 500,
    offsetFrames: 0,
    autostart: true,
    loop: false,
    swing: false,
  };
  return {
    fps: 50,
    durationFrames: 500,
    playbackMode: 'bounded',
    directors: [defaultDirector],
    trackDirectors: {},
    keyframes: [],
    actions: [],
  };
}

export function createDefaultTemplate(): Template {
  return {
    id: crypto.randomUUID(),
    name: 'Новый шаблон',
    canvas: { width: 1920, height: 1080, background: 'transparent' },
    variables: [],
    groups: [],
    layers: [],
    timeline: createDefaultTimeline(),
  };
}

export const POSITION_SIZE_LABELS: Record<PositionSizeProp, string> = {
  x: 'X',
  y: 'Y',
  width: 'Ширина',
  height: 'Высота',
  rotation: 'Угол°',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
};

export function layerToPositionSizeValues(layer: Layer): PositionSizeValues {
  const t = layer.transform;
  return {
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    rotation: t.rotation,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
  };
}

export function createDefaultTransform(x = 100, y = 100): Transform {
  return { x, y, width: 300, height: 80, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 };
}
