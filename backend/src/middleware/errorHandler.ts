import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';
import { AppError, ErrorCode } from '../utils/errors';
import { fail } from '../utils/response';
import { formatZodError } from './validate';

export const notFoundHandler: RequestHandler = (req, res) => {
  fail(res, 404, `Route ${req.method} ${req.path} not found`, ErrorCode.NOT_FOUND);
};

const UNIQUE_FIELD_MESSAGES: Record<string, { code: ErrorCode; message: string }> = {
  phone: { code: ErrorCode.PHONE_ALREADY_REGISTERED, message: 'This mobile number is already registered' },
  email: { code: ErrorCode.EMAIL_ALREADY_REGISTERED, message: 'This email is already registered' },
  panNumber: { code: ErrorCode.CONFLICT, message: 'An agency with this PAN is already registered' },
  gstNumber: { code: ErrorCode.GST_ALREADY_REGISTERED, message: 'A business with this GST number is already registered' },
  licenceNumber: { code: ErrorCode.CONFLICT, message: 'This driving licence is already registered' },
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode === 429 && (err.details as { retryAfterSeconds?: number })?.retryAfterSeconds) {
      res.setHeader('Retry-After', String((err.details as { retryAfterSeconds: number }).retryAfterSeconds));
    }
    return fail(res, err.statusCode, err.message, err.code, err.details);
  }
  if (err instanceof ZodError) {
    return fail(res, 400, 'Please correct the highlighted fields', ErrorCode.VALIDATION_ERROR, formatZodError(err));
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = ([] as string[]).concat((err.meta?.target as string[] | string | undefined) ?? []);
    const field = Object.keys(UNIQUE_FIELD_MESSAGES).find((f) => target.some((t) => t.includes(f)));
    const mapped = field ? UNIQUE_FIELD_MESSAGES[field] : { code: ErrorCode.CONFLICT, message: 'Record already exists' };
    return fail(res, 409, mapped.message, mapped.code);
  }
  // body-parser errors (malformed JSON, payload too large)
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.type) {
    return fail(res, err.status, err.status === 413 ? 'Request body too large' : 'Malformed request body', ErrorCode.BAD_REQUEST);
  }

  // Database CHECK / trigger violations (defence in depth behind application validation).
  if (err instanceof Prisma.PrismaClientUnknownRequestError || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2004')) {
    logger.warn({ err, path: req.path }, 'Database constraint rejected the request');
    return fail(res, 400, 'The request violates a data rule', ErrorCode.BAD_REQUEST);
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return fail(res, 500, 'Something went wrong. Please try again.', ErrorCode.INTERNAL_ERROR);
};
