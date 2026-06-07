import { z } from 'zod';
import { IdSchema } from '../common/id.js';
import { TimelineSchema, createDefaultTimeline } from '../timeline/schema.js';

export const BlendModeSchema = z.enum(['normal', 'add', 'multiply', 'screen']);
export type BlendMode = z.infer<typeof BlendModeSchema>;

export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  anchorX: z.number(),
  anchorY: z.number(),
});
export type Transform = z.infer<typeof TransformSchema>;

export const VariableBindingSchema = z.object({
  type: z.literal('variable'),
  variableId: IdSchema,
});
export type VariableBinding = z.infer<typeof VariableBindingSchema>;

export const VariableSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'image', 'number', 'color', 'video']),
  defaultValue: z.union([z.string(), z.number()]),
});
export type Variable = z.infer<typeof VariableSchema>;

export const LayerGroupSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  parentId: IdSchema.nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
  transform: TransformSchema,
});
export type LayerGroup = z.infer<typeof LayerGroupSchema>;

export const RootStackEntrySchema = z.object({
  kind: z.enum(['layer', 'group']),
  id: IdSchema,
});
export type RootStackEntry = z.infer<typeof RootStackEntrySchema>;

const BindableStringSchema = z.union([z.string(), VariableBindingSchema]);

const BaseLayerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number(),
  blendMode: BlendModeSchema,
  transform: TransformSchema,
  groupId: IdSchema.nullable(),
});

export const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.string(),
  fill: BindableStringSchema,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number(),
  letterSpacing: z.number(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  dropShadow: z.boolean(),
  dropShadowBlur: z.number(),
  dropShadowColor: z.string(),
  dropShadowDistance: z.number(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TextLayerSchema = BaseLayerSchema.extend({
  type: z.literal('text'),
  content: BindableStringSchema,
  style: TextStyleSchema,
});
export type TextLayer = z.infer<typeof TextLayerSchema>;

export const ImageLayerSchema = BaseLayerSchema.extend({
  type: z.literal('image'),
  src: BindableStringSchema,
  cornerRadius: z.number(),
  fit: z.enum(['stretch', 'contain', 'cover']),
});
export type ImageLayer = z.infer<typeof ImageLayerSchema>;

export const RectLayerSchema = BaseLayerSchema.extend({
  type: z.literal('rect'),
  fill: BindableStringSchema,
  cornerRadius: z.number(),
  borderColor: z.string(),
  borderWidth: z.number(),
});
export type RectLayer = z.infer<typeof RectLayerSchema>;

export const ClockLayerSchema = BaseLayerSchema.extend({
  type: z.literal('clock'),
  mode: z.enum(['clock', 'countup', 'countdown']),
  format: z.string(),
  startTime: z.number().optional(),
  targetTime: z.number().optional(),
  style: TextStyleSchema,
});
export type ClockLayer = z.infer<typeof ClockLayerSchema>;

export const VideoLayerSchema = BaseLayerSchema.extend({
  type: z.literal('video'),
  src: BindableStringSchema,
  loop: z.boolean(),
  fit: z.enum(['stretch', 'contain', 'cover']),
});
export type VideoLayer = z.infer<typeof VideoLayerSchema>;

export const LayerSchema = z.discriminatedUnion('type', [
  TextLayerSchema,
  ImageLayerSchema,
  RectLayerSchema,
  ClockLayerSchema,
  VideoLayerSchema,
]);
export type Layer = z.infer<typeof LayerSchema>;

export const TemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    background: z.string(),
  }),
  variables: z.array(VariableSchema),
  groups: z.array(LayerGroupSchema).optional(),
  layers: z.array(LayerSchema),
  rootStack: z.array(RootStackEntrySchema).optional(),
  groupStacks: z.record(z.array(RootStackEntrySchema)).optional(),
  timeline: TimelineSchema,
});
export type Template = z.infer<typeof TemplateSchema>;

export function createDefaultTransform(x = 100, y = 100): Transform {
  return { x, y, width: 300, height: 80, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 };
}

export function createDefaultTemplate(id: string, name = 'Новый шаблон'): Template {
  return {
    id,
    name,
    canvas: { width: 1920, height: 1080, background: 'transparent' },
    variables: [],
    groups: [],
    layers: [],
    timeline: createDefaultTimeline(),
  };
}
