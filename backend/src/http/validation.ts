import type { Response } from 'express';
import type { ZodError } from 'zod';

export function sendValidationError(res: Response, error: ZodError) {
  return res.status(400).json({
    error: 'Validation failed',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
