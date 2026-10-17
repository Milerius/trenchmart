import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

export type BlobStore = {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  signedGet(key: string, exp: number): string;
  signedPut(key: string, exp: number): string;
  verify(
    key: string,
    exp: number,
    signature: string,
    method: 'GET' | 'PUT',
    nowMs: number,
  ): boolean;
};

function safeKey(key: string): string {
  const normalized = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.startsWith('..') || normalized.includes('\0')) throw new Error('bad blob key');
  return normalized;
}

export function filesystemBlob(root: string, secret: string, publicBase: string): BlobStore {
  const sign = (method: string, key: string, exp: number) =>
    createHmac('sha256', secret).update(`${method}\n${key}\n${exp}`).digest('hex');
  const pathFor = (key: string) => join(root, safeKey(key));
  return {
    async put(key, body) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        return await readFile(pathFor(key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    signedGet(key, exp) {
      return `${publicBase}/api/v1/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign('GET', key, exp)}`;
    },
    signedPut(key, exp) {
      return `${publicBase}/api/v1/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign('PUT', key, exp)}`;
    },
    verify(key, exp, signature, method, nowMs) {
      if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
      const expected = sign(method, key, exp);
      if (expected.length !== signature.length) return false;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    },
  };
}
