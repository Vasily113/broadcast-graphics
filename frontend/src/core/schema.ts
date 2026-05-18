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
  type: 'text' | 'image' | 'number' | 'color';
  defaultValue: string | number;
}

export interface BaseLayer {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  transform: Transform;
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
  format: string;        // e.g. 'HH:mm:ss', 'mm:ss'
  startTime?: number;    // unix seconds — for countup: when counting started
  targetTime?: number;   // unix seconds — for countdown: target moment
  style: TextLayer['style'];
}

export interface VideoLayer extends BaseLayer {
  type: 'video';
  src: string;
  loop: boolean;
  fit: 'stretch' | 'contain' | 'cover';
}

export type Layer = TextLayer | ImageLayer | RectLayer | ClockLayer | VideoLayer;

export interface Keyframe {
  time: number;
  properties: Record<string, number>;
  fromProperties?: Record<string, number>;
  easing: EasingType;
}

export interface AnimationTrack {
  layerId: string;
  inKeyframes: Keyframe[];
  outKeyframes: Keyframe[];
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
  layers: Layer[];
  tracks: AnimationTrack[];
}

export function createDefaultTemplate(): Template {
  return {
    id: crypto.randomUUID(),
    name: 'Новый шаблон',
    canvas: { width: 1920, height: 1080, background: 'transparent' },
    variables: [],
    layers: [],
    tracks: [],
  };
}

export function createDefaultTransform(x = 100, y = 100): Transform {
  return { x, y, width: 300, height: 80, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 };
}