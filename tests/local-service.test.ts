import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from 'node:http';
import { Store } from '../src/storage/database.js';
import { ReminderOperations } from '../src/operations/reminders.js';
import { HttpServiceClient } from '../src/transports/local/client.js';
import { ServiceFacade } from '../src/transports/local/handlers.js';
import type { ManagementDiagnostics } from '../src/transports/local/handlers.js';
import { LocalServer, m0GateWriter } from '../src/transports/local/service.js';
import { loadOrCreateAdminToken } from '../src/transports/local/paths.js';
import type { StatePaths } from '../src/transports/local/paths.js';
import type { RpcMethod } from '../src/transports/local/rpc.js';
import type { ReminderWriter } from '../src/providers/reminders/types.js';

interface Fixture {
  dir: string; store: Store; server: LocalServer; client: HttpServiceClient; adminToken: string;
  socketPath: string;
  admin: (method: RpcMethod, params?: Record<string, unknown>) => Promise<unknown>;
  agent: (token: string, method: RpcMethod, params?: Record<string, unknown>) => Promise<unknown>;
}

async function fixture(options: { writer?: ReminderWriter; diagnostics?: ManagementDiagnostics } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-test-'));
  const paths: StatePaths = {
    dir, db: join(dir, 'db.sqlite3'), adminTokenFile: join(dir, 'admin-token'),
    socket: join(dir, 'service.sock'), pidFile: join(dir, 'service.pid'), serviceLock: join(dir, 'service.lock'), adminUrlFile: join(dir, 'admin-url'), logFile: join(dir, 'service.log'),
  };
  const adminToken = loadOrCreateAdminToken(paths);
  const store = new Store(paths.db);
  const operations = new ReminderOperations(store, options.writer ?? m0GateWriter);
  const server = LocalServer.create({ socketPath: paths.socket, facade: new ServiceFacade(store, operations, adminToken, 'test-version', undefined, undefined, undefined, undefined, undefined, options.diagnostics) });
  await server.listen();
  const client = new HttpServiceClient(paths.socket);
  return {
    dir, store, server, client, adminToken, socketPath: paths.socket,
    admin: (method, params) => client.request(method, params, adminToken),
    agent: (token, method, params) => client.request(method, params, token),
  };
}

const closeFixture = async (f: Fixture) => { await f.server.close(); f.store.close(); rmSync(f.dir, { recursive: true, force: true }); };

async function pairClient(f: Fixture, approval: 'automatic' | 'required' = 'automatic'): Promise<{ id: string; token: string }> {
  const created = await f.admin('clients.create', {
    name: 'Test agent',
    grants: [{ provider: 'reminders', containerIds: ['test-list'], actions: ['create'], fields: 'full', approval, expiresAt: Date.now() + 3600_000 }],
  }) as { client: { id: string }; token: string };
  return { id: created.client.id, token: created.token };
}

test('agent calls require a client token; client credentials cannot reach management methods', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f);
  await assert.rejects(f.agent('wrong-token', 'capabilities'), { code: 'permission_denied' });
  // Real client credentials cannot reach management methods.
  await assert.rejects(f.agent(token, 'clients.list'), { code: 'permission_denied' });
});

test('a wrong admin token is rejected', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const wrongAdmin = new HttpServiceClient(f.socketPath);
  await assert.rejects(wrongAdmin.request('clients.list', undefined, 'not-the-admin-token'), { code: 'permission_denied' });
  await assert.rejects(wrongAdmin.request('clients.create', { name: 'x', grants: [] }, 'not-the-admin-token'), { code: 'permission_denied' });
});

test('malformed envelopes are rejected at the HTTP boundary', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const post = (body: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ socketPath: f.socketPath, path: '/rpc', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post(JSON.stringify({ method: 'clients.not-a-method', params: {} }))).status, 400);
  const missingAuth = await post(JSON.stringify({ method: 'capabilities', params: {} }));
  assert.equal(missingAuth.status, 200);
  assert.equal(JSON.parse(missingAuth.body).ok, false);
});

test('capabilities reports the service version and verified read adapters', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f);
  const result = await f.agent(token, 'capabilities') as { version: string; capabilities: Array<{ provider: string; status: string; operations: string[] }> };
  assert.equal(result.version, 'test-version');
  assert.deepEqual(result.capabilities.map((c) => c.provider), ['calendar', 'reminders', 'notes']);
  assert.deepEqual(result.capabilities.map((c) => c.status), ['available', 'available', 'available']);
  assert.deepEqual(result.capabilities[0]?.operations, ['list_calendars', 'list_events']);
  assert.deepEqual(result.capabilities[1]?.operations, ['list_lists', 'list', 'create']);
  assert.deepEqual(result.capabilities[2]?.operations, ['list_folders', 'get', 'search']);
});

test('management can replace policy, rotate credentials, and read metadata-only diagnostics', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const created = await pairClient(f, 'required');
  const plan = await f.agent(created.token, 'operations.prepare', { idempotencyKey: 'policy-plan', change: { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE' } }) as { id: string };
  const updated = await f.admin('clients.update', { id: created.id, name: 'Narrowed', grants: [] }) as { name: string; policyVersion: number };
  assert.deepEqual(updated, { id: created.id, name: 'Narrowed', grants: [], policyVersion: 2, revoked: false });
  const rows = await f.admin('operations.list') as Array<{ id: string; state: string }>;
  assert.equal(rows.find((row) => row.id === plan.id)?.state, 'cancelled');
  const rotated = await f.admin('clients.rotate', { id: created.id }) as { token: string };
  await assert.rejects(f.agent(created.token, 'capabilities'), { code: 'permission_denied' });
  assert.equal((await f.agent(rotated.token, 'capabilities') as { version: string }).version, 'test-version');
  const diagnostics = await f.admin('diagnostics.summary') as { version: string; nativeProtocolVersion: number; storage: unknown };
  assert.equal(diagnostics.version, 'test-version');
  assert.equal(diagnostics.nativeProtocolVersion, 1);
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
});

test('management can reject a prepared operation without attempting a native write', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f, 'required');
  const plan = await f.agent(token, 'operations.prepare', { idempotencyKey: 'reject-plan', change: { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE' } }) as { id: string };
  const preview = await f.admin('operations.preview', { id: plan.id }) as { id: string; provider: string; state: string; expiresAt: number; change: { containerId: string; title: string } };
  assert.equal(preview.id, plan.id); assert.equal(preview.provider, 'reminders'); assert.equal(preview.state, 'prepared'); assert.ok(preview.expiresAt > Date.now());
  assert.deepEqual(preview.change, { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE', body: '' });
  assert.deepEqual(await f.admin('operations.reject', { id: plan.id }), { rejected: plan.id });
  const rows = await f.admin('operations.list') as Array<{ id: string; state: string }>;
  assert.equal(rows.find((row) => row.id === plan.id)?.state, 'cancelled');
  await assert.rejects(f.admin('operations.reject', { id: plan.id }), { code: 'conflict' });
  await assert.rejects(f.admin('operations.preview', { id: plan.id }), { code: 'conflict' });
});

test('management diagnostics expose only fixed journaled actions', async (t) => {
  let started = 0; let recovered = 0;
  const f = await fixture({ diagnostics: {
    startReminderM1: (containerId) => { started++; return { probeId: 'f8f5501f-e6a0-469a-8b99-9671943d1cbd', containerId, createdAt: 1 }; },
    listReminderM1: () => [{ probeId: 'f8f5501f-e6a0-469a-8b99-9671943d1cbd', recoveryStatus: 'pending' }],
    recoverReminderM1: (probeId) => { recovered++; return { probeId, status: 'recovering' }; },
    findContainers: async (name) => ({ query: name, reminderLists: [], noteFolders: [], personalDataRead: false }),
    runProbe: async () => ({ personalDataRead: false, writeAttempted: false }),
  } });
  t.after(() => closeFixture(f));
  const startedResult = await f.admin('diagnostics.reminders_m1.start', { containerId: 'dedicated-list' }) as { containerId: string };
  assert.equal(startedResult.containerId, 'dedicated-list'); assert.equal(started, 1);
  assert.equal((await f.admin('diagnostics.reminders_m1.list') as unknown[]).length, 1);
  await f.admin('diagnostics.reminders_m1.recover', { probeId: 'f8f5501f-e6a0-469a-8b99-9671943d1cbd' });
  assert.equal(recovered, 1);
  assert.deepEqual(await f.admin('diagnostics.find_containers', { name: 'Dedicated test' }), { query: 'Dedicated test', reminderLists: [], noteFolders: [], personalDataRead: false });
  assert.deepEqual(await f.admin('diagnostics.probe'), { personalDataRead: false, writeAttempted: false });
  await assert.rejects(f.admin('diagnostics.read_summary', { clientId: 'f8f5501f-e6a0-469a-8b99-9671943d1cbd', provider: 'reminders', containerId: 'test-list', limit: 10 }), { code: 'permission_denied' });
  await assert.rejects(f.admin('diagnostics.reminders_m1.start', { containerId: '' }), { code: 'invalid_request' });
});

test('prepare → approve → commit → get; audit captured; staged content never leaves the service', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f, 'required');
  const change = { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE TITLE', body: 'PRIVATE BODY' };
  const plan = await f.agent(token, 'operations.prepare', { idempotencyKey: 'key-1', change }) as { id: string; state: string };
  assert.equal(plan.state, 'prepared');
  await assert.rejects(f.agent(token, 'operations.commit', { id: plan.id }), { code: 'approval_required' });
  await f.admin('operations.approve', { id: plan.id });
  // The M0 gate writer refuses the native step during preflight, before any durable intent is written.
  // The plan stays approved and nothing reaches Apple; this is an honest refusal, not a success claim.
  await assert.rejects(f.agent(token, 'operations.commit', { id: plan.id }), { code: 'service_unavailable' });
  const got = await f.agent(token, 'operations.get', { id: plan.id }) as { state: string };
  assert.equal(got.state, 'approved');
  const listings = await f.admin('operations.list') as Array<{ id: string; state: string }>;
  assert.equal(listings.length, 1);
  assert.ok(!JSON.stringify(listings).includes('PRIVATE'));
  const audit = await f.admin('audit.list') as Array<{ action: string; outcome: string }>;
  assert.ok(!JSON.stringify(audit).includes('PRIVATE'));
  assert.ok(audit.some((e) => e.action === 'approved' && e.outcome === 'allowed'));
});

test('stub writer completes the full write path with one mutation for concurrent commits', async (t) => {
  let writes = 0;
  const writer: ReminderWriter = {
    preflight: async () => {},
    create: async (change) => { writes++; return { id: `n-${writes}`, containerId: change.containerId }; },
    verify: async () => true,
  };
  const f = await fixture({ writer });
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f);
  const change = { kind: 'reminders.create', containerId: 'test-list', title: 'ok' };
  const plan = await f.agent(token, 'operations.prepare', { idempotencyKey: 'key-2', change }) as { id: string };
  assert.equal((await f.agent(token, 'operations.prepare', { idempotencyKey: 'key-2', change }) as { id: string }).id, plan.id);
  const states = await Promise.all([
    f.agent(token, 'operations.commit', { id: plan.id }),
    f.agent(token, 'operations.commit', { id: plan.id }),
  ]);
  assert.equal(writes, 1);
  assert.equal((states[0] as { state: string } | undefined)?.state, 'succeeded');
  assert.deepEqual(states[0], states[1]);
});

test('revocation cancels pending plans and blocks new access', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { id, token } = await pairClient(f, 'required');
  const plan = await f.agent(token, 'operations.prepare', { idempotencyKey: 'key-3', change: { kind: 'reminders.create', containerId: 'test-list', title: 'x' } }) as { id: string };
  await f.admin('clients.revoke', { id });
  await assert.rejects(f.agent(token, 'operations.commit', { id: plan.id }), { code: 'permission_denied' });
  await assert.rejects(f.agent(token, 'operations.prepare', { idempotencyKey: 'key-4', change: { kind: 'reminders.create', containerId: 'test-list', title: 'y' } }), { code: 'permission_denied' });
  const rows = await f.admin('operations.list') as Array<{ id: string; state: string }>;
  assert.equal(rows.find((r) => r.id === plan.id)?.state, 'cancelled');
});
