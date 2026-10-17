import { createServer } from 'node:http';
import { runIsolatedSandbox, SANDBOX_BUDGET_MS, SANDBOX_MEMORY_MB } from '@trenchmart/scanner';

const port = Number(process.env.PORT || 8790);
const token = process.env.INTERNAL_TOKEN || '';
const toolchainCache = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/ms-playwright';

/**
 * Hetzner sandbox runner. Jobs arrive as a webhook. This process does not poll.
 * Toolchains stay on disk at PLAYWRIGHT_BROWSERS_PATH. The script itself runs
 * with no network egress and a hard timeout.
 */
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, toolchainCache, budgetMs: SANDBOX_BUDGET_MS }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/jobs') {
    res.writeHead(404);
    res.end();
    return;
  }
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401);
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString()) as {
    source?: string;
    timeoutMs?: number;
  };
  const timeoutMs = Math.min(body.timeoutMs ?? SANDBOX_BUDGET_MS, 20_000);
  const result = runIsolatedSandbox(body.source ?? '', Date.now(), { timeoutMs });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ...result, toolchainCache, memoryMb: SANDBOX_MEMORY_MB }));
});

server.listen(port, () => {
  console.log(`sandbox runner listening on ${port}`);
});
