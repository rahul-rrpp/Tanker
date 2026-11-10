import type { RequestHandler, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { storage } from '../lib/storage';
import { AppError, ErrorCode } from '../utils/errors';

export interface StoredFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

type Kind = 'pdf' | 'png' | 'jpeg' | 'webp';

const MIME: Record<Kind, { mime: string; ext: string }> = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

/** Identifies the real file type from its leading bytes; the client-declared type is never trusted. */
export function sniffFileType(buf: Buffer): Kind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const maxBytes = () => Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);

/** Multipart parser kept in memory (bounded by size and count) so files can be inspected before storage. */
export function multipart(opts: { field: string; maxFiles?: number }): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes(), files: opts.maxFiles ?? 1, fields: 20, fieldSize: 8 * 1024 },
  });
  const handler = (opts.maxFiles ?? 1) > 1 ? upload.array(opts.field, opts.maxFiles) : upload.single(opts.field);
  return (req, res, next) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(AppError.badRequest(`File is too large. Maximum size is ${env.MAX_UPLOAD_MB} MB.`, ErrorCode.FILE_REJECTED));
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(AppError.badRequest('Too many files attached', ErrorCode.FILE_REJECTED));
        return next(AppError.badRequest('Upload could not be processed', ErrorCode.FILE_REJECTED));
      }
      next(err);
    });
  };
}

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || 'file';
}

/** Validates (type by magic bytes, size) and stores an uploaded file. */
export async function storeUpload(
  file: Express.Multer.File | undefined,
  folder: 'company-documents' | 'company-logos' | 'support-attachments' | 'trip-documents' | 'kyc-documents',
  allowed: Kind[],
): Promise<StoredFile> {
  if (!file || file.size === 0) throw AppError.badRequest('Choose a file to upload', ErrorCode.FILE_REJECTED);
  if (file.size > maxBytes()) throw AppError.badRequest(`File is too large. Maximum size is ${env.MAX_UPLOAD_MB} MB.`, ErrorCode.FILE_REJECTED);
  const kind = sniffFileType(file.buffer);
  if (!kind || !allowed.includes(kind)) {
    const names = allowed.map((k) => k.toUpperCase()).join(', ');
    throw AppError.badRequest(`Unsupported file type. Allowed: ${names}.`, ErrorCode.FILE_REJECTED);
  }
  const { mime, ext } = MIME[kind];
  const storageKey = await storage.put(folder, file.buffer, ext);
  const original = cleanName(file.originalname);
  const fileName = original.toLowerCase().endsWith(`.${ext}`) || (ext === 'jpg' && /\.jpe?g$/i.test(original)) ? original : `${original}.${ext}`;
  return { storageKey, fileName, mimeType: mime, sizeBytes: file.size };
}

/** Streams a stored file. Inline display is limited to PDFs and images; everything else downloads. */
export function sendStoredFile(res: Response, file: { storageKey: string; fileName: string; mimeType: string }, inline = false) {
  if (!storage.exists(file.storageKey)) throw AppError.notFound('File is no longer available');
  const safeInline = inline && /^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.mimeType);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  storage.read(file.storageKey).pipe(res);
}
