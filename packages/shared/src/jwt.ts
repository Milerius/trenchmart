import { arrayBufferOf } from './money';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson(payload);
  const key = await hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt<T extends Record<string, unknown>>(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const key = await hmacKey(secret, ['verify']);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    arrayBufferOf(fromB64url(sig)),
    new TextEncoder().encode(`${header}.${body}`),
  );
  if (!ok) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T & { exp?: number };
    if (typeof json.exp === 'number' && json.exp * 1000 < nowMs) return null;
    return json;
  } catch {
    return null;
  }
}
