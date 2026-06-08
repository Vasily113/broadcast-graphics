import { z } from 'zod';

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

export const TimestampSecondsSchema = z.number().int().nonnegative();
export type TimestampSeconds = z.infer<typeof TimestampSecondsSchema>;
