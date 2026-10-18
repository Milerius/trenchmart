/* global process, Buffer, URL, URLSearchParams, console */
// Mock X API for the X OAuth E2E (playwright.xoauth.config.ts). The API's X_API_URL points
// here. The authorization code picks the outcome, so one server covers every case:
//   code-ok     token + /2/users/me succeed (@mileriseme)
//   code-401    token exchange 401 (X rejects the client id/secret)
//   code-me403  token ok, /2/users/me 403 (X plan does not allow it)
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_X_PORT || 8818);
const CLIENT = Buffer.from(
  `${process.env.X_CLIENT_ID ?? 'e2e-client'}:${process.env.X_CLIENT_SECRET ?? 'e2e-secret'}`,
).toString('base64');
const tokens = new Map();

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', 'http://mock').pathname;
    if (path === '/health') return send(200, { ok: true });
    if (req.method === 'POST' && path === '/2/oauth2/token') {
      const form = new URLSearchParams(raw);
      const code = form.get('code') ?? '';
      if (code === 'code-401' || req.headers.authorization !== `Basic ${CLIENT}`)
        return send(401, {
          error: 'unauthorized_client',
          error_description: 'Missing valid authorization header',
        });
      if (!form.get('code_verifier') || !code.startsWith('code-'))
        return send(400, { error: 'invalid_request', error_description: 'bad code' });
      const token = `at-${code}`;
      tokens.set(token, code);
      return send(200, {
        access_token: token,
        token_type: 'bearer',
        scope: 'users.read tweet.read',
      });
    }
    if (req.method === 'GET' && path === '/2/users/me') {
      const code = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!code) return send(401, { title: 'Unauthorized' });
      if (code === 'code-me403')
        return send(403, {
          title: 'Forbidden',
          detail: 'Your client app does not have access to this endpoint.',
        });
      return send(200, { data: { id: '1601092300893499392', username: 'mileriseme' } });
    }
    send(404, { title: 'Not Found' });
  });
}).listen(port, '127.0.0.1', () => console.log(`mock X on ${port}`));
