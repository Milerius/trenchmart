import { proxy } from '@/lib/api-proxy';

// Same-origin /api/v1 proxy to the API Worker; see lib/api-proxy.ts (M-03).
export const dynamic = 'force-dynamic';

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
