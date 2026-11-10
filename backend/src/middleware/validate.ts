import type { RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { AppError, ErrorCode } from '../utils/errors';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function formatZodError(error: z.ZodError) {
  return error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

/**
 * Validates and normalises request input. Parsed values replace the raw ones on `req.body`;
 * parsed query/params are exposed on `res.locals.query` / `res.locals.params` (Express 5 makes
 * `req.query` read-only).
 */
export function validateRequest(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const issues: ReturnType<typeof formatZodError> = [];
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        issues.push(...formatZodError(result.error));
        continue;
      }
      if (key === 'body') req.body = result.data;
      else res.locals[key] = result.data;
    }
    if (issues.length > 0) {
      return next(new AppError(400, ErrorCode.VALIDATION_ERROR, 'Please correct the highlighted fields', issues));
    }
    next();
  };
}
