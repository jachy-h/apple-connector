import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AdminWebServer } from '../src/transports/admin/server.js';
import { appVersion } from '../src/application/version.js';
import { ReminderOperations } from '../src/operations/reminders.js';
import { Store } from '../src/storage/database.js';
import { ServiceFacade } from '../src/transports/local/handlers.js';
import { m0GateWriter } from '../src/transports/local/service.js';

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function call(origin: URL, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolveCall, reject) => {
    const req = request({ hostname: origin.hostname, port: origin.port, path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolveCall({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end(options.body);
  });
}

test('management site exchanges a one-time loopback link for a CSRF-protected admin session', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-admin-'));
  const store = new Store(':memory:');
  const facade = new ServiceFacade(store, new ReminderOperations(store, m0GateWriter), 'admin-token', appVersion);
  const server = new AdminWebServer({ facade, staticRoot: root });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Apple Connector</title>');
  t.after(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const link = new URL(await server.listen());

  assert.equal((await call(link, '/')).status, 401);
  assert.equal((await call(link, '/', { headers: { host: 'example.invalid' } })).status, 403);
  const bootstrap = await call(link, `${link.pathname}${link.search}`);
  assert.equal(bootstrap.status, 303);
  const cookie = bootstrap.headers['set-cookie'];
  assert.ok(Array.isArray(cookie) && cookie[0]);
  const session = cookie[0]!.split(';')[0]!;
  assert.equal((await call(link, `${link.pathname}${link.search}`)).status, 403, 'a bootstrap link is one-time');
  assert.equal((await call(link, '/', { headers: { cookie: session } })).status, 200);

  const sessionInfo = await call(link, '/api/bootstrap', { headers: { cookie: session } });
  assert.equal(sessionInfo.status, 200);
  const csrf = (JSON.parse(sessionInfo.body) as { csrf: string }).csrf;
  const rpc = (method: string, token = csrf) => call(link, '/api/rpc', {
    method: 'POST', headers: { cookie: session, origin: link.origin, 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ method, params: {} }),
  });
  const clients = await rpc('clients.list');
  assert.equal(clients.status, 200);
  assert.deepEqual(JSON.parse(clients.body), { ok: true, result: [] });
  assert.equal((await rpc('clients.list', 'wrong')).status, 403);
  const agentMethod = await rpc('capabilities');
  assert.equal(agentMethod.status, 200);
  assert.equal((JSON.parse(agentMethod.body) as { ok: boolean }).ok, false);
});
