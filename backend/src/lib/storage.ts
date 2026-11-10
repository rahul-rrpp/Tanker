import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env';

/**
 * Storage abstraction. Files are stored under random keys (never user-supplied names) and are only
 * served through authorised API endpoints. Swap LocalDiskStorage for an S3/GCS driver in production
 * by implementing this interface and selecting it with STORAGE_DRIVER.
 */
export interface StorageDriver {
  put(folder: string, buffer: Buffer, extension: string): Promise<string>;
  read(key: string): Readable;
  exists(key: string): boolean;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z-]+\/\d{4}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

class LocalDiskStorage implements StorageDriver {
  private readonly root: string;

  constructor(dir: string) {
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    const full = normalize(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error('Path traversal blocked');
    return full;
  }

  async put(folder: string, buffer: Buffer, extension: string): Promise<string> {
    const key = `${folder}/${new Date().getUTCFullYear()}/${randomUUID()}.${extension}`;
    const full = this.pathFor(key);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buffer, { flag: 'wx' });
    return key;
  }

  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  exists(key: string): boolean {
    try {
      return existsSync(this.pathFor(key));
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export const storage: StorageDriver = new LocalDiskStorage(env.UPLOAD_DIR);
