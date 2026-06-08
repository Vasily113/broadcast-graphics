import { z } from 'zod';
import { IdSchema } from '../common/id.js';

export const EasingSchema = z.enum([
  'linear',
  'power2.out',
  'power2.in',
  'bounce.out',
  'elastic.out',
]);
export type EasingType = z.infer<typeof EasingSchema>;

export const PositionSizePropSchema = z.enum(['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY']);
export type PositionSizeProp = z.infer<typeof PositionSizePropSchema>;

export const PositionSizeValuesSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
});
export type PositionSizeValues = z.infer<typeof PositionSizeValuesSchema>;

export const BezierHandleSchema = z.object({
  cp1x: z.number(),
  cp1y: z.number(),
  cp2x: z.number(),
  cp2y: z.number(),
});
export type BezierHandle = z.infer<typeof BezierHandleSchema>;

export const TimelineKeyframeSchema = z.object({
  id: IdSchema,
  frame: z.number().int().nonnegative(),
  layers: z.record(PositionSizeValuesSchema),
  groups: z.record(PositionSizeValuesSchema),
  easing: EasingSchema,
  bezier: BezierHandleSchema.optional(),
});
export type TimelineKeyframe = z.infer<typeof TimelineKeyframeSchema>;

export const TimelineDirectorSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  durationFrames: z.number().int().positive(),
  offsetFrames: z.number().int().nonnegative(),
  autostart: z.boolean(),
  loop: z.boolean(),
});
export type TimelineDirector = z.infer<typeof TimelineDirectorSchema>;

export const TimelineActionCommandSchema = z.enum(['startDirector', 'stopDirector']);
export type TimelineActionCommand = z.infer<typeof TimelineActionCommandSchema>;

export const TimelineActionSchema = z.object({
  id: IdSchema,
  directorId: IdSchema,
  frame: z.number().int().nonnegative(),
  command: TimelineActionCommandSchema,
  targetDirectorId: IdSchema.nullable(),
});
export type TimelineAction = z.infer<typeof TimelineActionSchema>;

export const TimelineSchema = z.object({
  fps: z.number().positive(),
  durationFrames: z.number().int().positive(),
  playbackMode: z.enum(['bounded', 'infinite']),
  directors: z.array(TimelineDirectorSchema),
  trackDirectors: z.record(IdSchema),
  keyframes: z.array(TimelineKeyframeSchema),
  actions: z.array(TimelineActionSchema),
});
export type Timeline = z.infer<typeof TimelineSchema>;

export function createDefaultTimeline(): Timeline {
  return {
    fps: 50,
    durationFrames: 500,
    playbackMode: 'bounded',
    directors: [{ id: 'default', name: 'default', durationFrames: 500, offsetFrames: 0, autostart: true, loop: false }],
    trackDirectors: {},
    keyframes: [],
    actions: [],
  };
}
