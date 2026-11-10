import type { Response } from 'express';

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

export interface ApiFailure {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
}

export function ok<T>(res: Response, message: string, data: T, status = 200) {
  const body: ApiSuccess<T> = { success: true, message, data };
  return res.status(status).json(body);
}

export function created<T>(res: Response, message: string, data: T) {
  return ok(res, message, data, 201);
}

export function fail(res: Response, status: number, message: string, code: string, details?: unknown) {
  const body: ApiFailure = { success: false, message, error: details === undefined ? { code } : { code, details } };
  return res.status(status).json(body);
}
