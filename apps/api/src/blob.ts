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

type Storage = Pick<BlobStore, 'put' | 'get' | 'delete'>;

/** HMAC signed URLs served by the API's /files route, shared by every backend. */
function signedStore(storage: Storage, secret: string, publicBase: string): BlobStore {
  const sign = (method: string, key: string, exp: number) =>
    createHmac('sha256', secret).update(`${method}\n${key}\n${exp}`).digest('hex');
  return {
    ...storage,
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

/** Local disk, for node dev and tests. A Worker has no persistent disk. */
export function filesystemBlob(root: string, secret: string, publicBase: string): BlobStore {
  const pathFor = (key: string) => join(root, safeKey(key));
  return signedStore(
    {
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
    },
    secret,
    publicBase,
  );
}

/** The subset of the Workers R2 binding the store needs. */
export type R2BucketLike = {
  put(key: string, value: Uint8Array | ArrayBuffer): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

/** Cloudflare R2 through the FILES binding: persistent across requests and isolates. */
export function r2Blob(bucket: R2BucketLike, secret: string, publicBase: string): BlobStore {
  return signedStore(
    {
      async put(key, body) {
        await bucket.put(safeKey(key), body);
      },
      async get(key) {
        const object = await bucket.get(safeKey(key));
        return object ? new Uint8Array(await object.arrayBuffer()) : null;
      },
      async delete(key) {
        await bucket.delete(safeKey(key));
      },
    },
    secret,
    publicBase,
  );
}

export class BlobUnavailableError extends Error {
  constructor() {
    super('file storage is not configured (FILES R2 binding missing)');
  }
}

/** Used when no R2 binding is bound: fail loudly instead of writing to a per-request VFS. */
export function unavailableBlob(secret: string, publicBase: string): BlobStore {
  const fail = async (): Promise<never> => {
    throw new BlobUnavailableError();
  };
  return signedStore({ put: fail, get: fail, delete: fail }, secret, publicBase);
}
