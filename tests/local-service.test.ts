import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from 'node:http';
import { Store } from '../src/storage/database.js';
import { ConnectorError } from '../src/application/errors.js';
import { AgentOperations } from '../src/operations/agent.js';
import { HttpServiceClient } from '../src/transports/local/client.js';
import { ServiceFacade } from '../src/transports/local/handlers.js';
import type { ManagementDiagnostics } from '../src/transports/local/handlers.js';
import { LocalServer, m0GateWriter } from '../src/transports/local/service.js';
import { loadOrCreateAdminToken } from '../src/transports/local/paths.js';
import type { StatePaths } from '../src/transports/local/paths.js';
import type { RpcMethod } from '../src/transports/local/rpc.js';
import type { ReminderWriter } from '../src/providers/reminders/types.js';
import type { CalendarReader } from '../src/providers/calendar/eventkit.js';

interface Fixture {
  dir: string; store: Store; server: LocalServer; client: HttpServiceClient; adminToken: string;
  socketPath: string;
  admin: (method: RpcMethod, params?: Record<string, unknown>) => Promise<unknown>;
  agent: (token: string, method: RpcMethod, params?: Record<string, unknown>) => Promise<unknown>;
}

async function fixture(options: { writer?: ReminderWriter; diagnostics?: ManagementDiagnostics; calendarReader?: CalendarReader } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-test-'));
  const paths: StatePaths = {
    dir, db: join(dir, 'db.sqlite3'), adminTokenFile: join(dir, 'admin-token'),
    socket: join(dir, 'service.sock'), pidFile: join(dir, 'service.pid'), serviceLock: join(dir, 'service.lock'), adminUrlFile: join(dir, 'admin-url'), webPidFile: join(dir, 'web.pid'), webExpiresAtFile: join(dir, 'web-expires-at'),
    helperSocket: join(dir, 'helper.sock'), helperPidFile: join(dir, 'helper.pid'), helperLogFile: join(dir, 'helper.log'), logFile: join(dir, 'service.log'),
  };
  const adminToken = loadOrCreateAdminToken(paths);
  const store = new Store(paths.db);
  const operations = new AgentOperations(store, options.writer ?? m0GateWriter);
  const server = LocalServer.create({ socketPath: paths.socket, facade: new ServiceFacade(store, operations, adminToken, 'test-version', undefined, undefined, undefined, options.calendarReader, undefined, options.diagnostics) });
  await server.listen();
  const client = new HttpServiceClient(paths.socket);
  return {
    dir, store, server, client, adminToken, socketPath: paths.socket,
    admin: (method, params) => client.request(method, params, adminToken),
    agent: (token, method, params) => client.request(method, params, token),
  };
}

const closeFixture = async (f: Fixture) => { await f.server.close(); f.store.close(); rmSync(f.dir, { recursive: true, force: true }); };

async function pairClient(f: Fixture): Promise<{ id: string; token: string }> {
  const created = await f.admin('clients.create', {
    name: 'Test agent',
    grants: [{ provider: 'reminders', containerIds: ['test-list'], actions: ['create'], expiresAt: Date.now() + 3600_000 }],
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

test('capabilities reports Notes as unavailable with no operations', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f);
  const result = await f.agent(token, 'capabilities') as { version: string; capabilities: Array<{ provider: string; status: string; operations: string[] }> };
  assert.equal(result.version, 'test-version');
  assert.deepEqual(result.capabilities.map((c) => c.provider), ['calendar', 'reminders', 'notes']);
  assert.deepEqual(result.capabilities.map((c) => c.status), ['available', 'available', 'unavailable']);
  assert.deepEqual(result.capabilities[0]?.operations, ['list_calendars', 'list_events', 'create', 'update', 'delete']);
  assert.deepEqual(result.capabilities[1]?.operations, ['list_lists', 'list', 'create', 'update', 'patch', 'complete', 'delete']);
  assert.deepEqual(result.capabilities[2]?.operations, []);
});

test('local Calendar validation reports an actionable parameter error before native access', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f);
  await assert.rejects(
    f.agent(token, 'calendar.list_events', { calendarId: 'calendar', from: '2026-09-07T00:00:00', to: '2026-09-08T00:00:00+08:00' }),
    (error: unknown) => error instanceof ConnectorError && error.code === 'invalid_request' && error.message.includes('Invalid argument "from"') && !error.message.includes('calendar'),
  );
});

test('web calendar reads resolve an exact name to an EventKit ID before listing events', async (t) => {
  const calls: string[] = [];
  const calendarReader: CalendarReader = {
    listCalendars: async (ids) => { calls.push(`calendars:${ids.join(',')}`); return ids[0] === 'Work' ? [{ id: 'eventkit-work', name: 'Work' }] : []; },
    listEvents: async (id, from, to, offset, limit) => {
      calls.push(`events:${id}:${offset}:${limit}`);
      assert.equal(from, '2028-02-29T00:00:00+08:00'); assert.equal(to, '2028-03-01T00:00:00+08:00');
      return { items: [{ id: 'event-1', calendarId: id, title: 'Planning', start: '2028-02-29T09:00:00+08:00', end: '2028-02-29T10:00:00+08:00', allDay: false, location: '', notes: '' }], nextOffset: null };
    },
  };
  const f = await fixture({ calendarReader });
  t.after(() => closeFixture(f));
  const page = await f.admin('web.calendar.list_events', { calendarId: 'Work', from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00', offset: 0, limit: 50 }) as { calendar: { id: string; name: string }; items: Array<{ title: string }> };
  assert.deepEqual(page.calendar, { id: 'eventkit-work', name: 'Work' });
  assert.equal(page.items[0]?.title, 'Planning');
  assert.deepEqual(calls, ['calendars:Work', 'events:eventkit-work:0:50']);
  const audit = await f.admin('audit.list') as Array<{ provider: string; target: string }>;
  assert.equal(audit.at(-1)?.target, 'eventkit-work');
});

test('web calendar reads reject missing and ambiguous names before listing events', async (t) => {
  let eventCalls = 0;
  const f = await fixture({ calendarReader: {
    listCalendars: async (ids) => ids[0] === 'Duplicate' ? [{ id: 'one', name: 'Duplicate' }, { id: 'two', name: 'Duplicate' }] : [],
    listEvents: async () => { eventCalls++; return { items: [], nextOffset: null }; },
  } });
  t.after(() => closeFixture(f));
  const params = { from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00' };
  await assert.rejects(f.admin('web.calendar.list_events', { ...params, calendarId: 'Missing' }), { code: 'unsupported_operation' });
  await assert.rejects(f.admin('web.calendar.list_events', { ...params, calendarId: 'Duplicate' }), { code: 'conflict' });
  assert.equal(eventCalls, 0);
});

test('web calendar failures retain the native permission error code in audit metadata', async (t) => {
  const f = await fixture({ calendarReader: {
    listCalendars: async () => { throw new ConnectorError('permission_denied', 'Full EventKit access has not been granted to the helper.'); },
    listEvents: async () => ({ items: [], nextOffset: null }),
  } });
  t.after(() => closeFixture(f));
  await assert.rejects(f.admin('web.calendar.list_events', { calendarId: 'Personal', from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00' }), { code: 'permission_denied' });
  const audit = await f.admin('audit.list') as Array<{ errorCode?: string; target?: string }>;
  assert.equal(audit.at(-1)?.target, 'Personal');
  assert.equal(audit.at(-1)?.errorCode, 'permission_denied');
});

test('management can describe an authorization and read metadata-only diagnostics', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const created = await pairClient(f);
  const described = await f.agent(created.token, 'auth.describe', {}) as { name: string; grants: unknown[]; expiresAt: number; lastUsedAt: number | null; agentName: string | null; verifiedAt: number | null };
  assert.equal(described.name, 'Test agent');
  assert.equal(described.grants.length, 1);
  assert.ok(described.expiresAt > Date.now());
  assert.equal(typeof described.lastUsedAt, 'number');
  assert.equal(described.agentName, null);
  assert.equal(described.verifiedAt, null);
  assert.ok(!JSON.stringify(described).includes(created.token));
  const diagnostics = await f.admin('diagnostics.summary') as { version: string; nativeProtocolVersion: number; storage: unknown };
  assert.equal(diagnostics.version, 'test-version');
  assert.equal(diagnostics.nativeProtocolVersion, 1);
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
});

test('agents can verify themselves and management sees the binding immediately', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { id, token } = await pairClient(f);
  const verified = await f.agent(token, 'auth.verify', { agent: '  Claude Code  ' }) as { name: string; agentName: string; verifiedAt: number; expiresAt: number };
  assert.equal(verified.name, 'Test agent');
  assert.equal(verified.agentName, 'Claude Code');
  assert.ok(verified.verifiedAt > 0);
  assert.ok(verified.expiresAt > Date.now());
  const described = await f.agent(token, 'auth.describe', {}) as { agentName: string | null; verifiedAt: number | null };
  assert.equal(described.agentName, 'Claude Code');
  assert.equal(described.verifiedAt, verified.verifiedAt);
  const listed = await f.admin('clients.list') as Array<{ id: string; agentName: string | null; verifiedAt: number | null }>;
  assert.equal(listed.find((client) => client.id === id)?.agentName, 'Claude Code');
  assert.equal(listed.find((client) => client.id === id)?.verifiedAt, verified.verifiedAt);
  const audit = await f.admin('audit.list') as Array<{ action: string; clientId?: string }>;
  assert.ok(audit.some((event) => event.action === 'agent_verified' && event.clientId === id));
  await assert.rejects(f.agent(token, 'auth.verify', {}), { code: 'invalid_request' });
  await assert.rejects(f.agent(token, 'auth.verify', { agent: '' }), { code: 'invalid_request' });
  await assert.rejects(f.agent('wrong-token', 'auth.verify', { agent: 'Agent' }), { code: 'permission_denied' });
  await assert.rejects(f.admin('auth.verify', { agent: 'Admin' }), { code: 'permission_denied' });
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

test('prepare → commit → get; audit captured; staged content never leaves the service', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { token } = await pairClient(f);
  const change = { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE TITLE', body: 'PRIVATE BODY' };
  const plan = await f.agent(token, 'operations.prepare', { idempotencyKey: 'key-1', change }) as { id: string; state: string };
  assert.equal(plan.state, 'approved');
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
  assert.ok(!audit.some((e) => e.action === 'approved'));
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

test('deleting an authorization invalidates its token and removes its operations', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { id, token } = await pairClient(f);
  const plan = await f.agent(token, 'operations.prepare', { idempotencyKey: 'key-3', change: { kind: 'reminders.create', containerId: 'test-list', title: 'x' } }) as { id: string };
  assert.deepEqual(await f.admin('clients.delete', { id }), { id });
  await assert.rejects(f.agent(token, 'operations.commit', { id: plan.id }), { code: 'permission_denied' });
  await assert.rejects(f.agent(token, 'operations.prepare', { idempotencyKey: 'key-4', change: { kind: 'reminders.create', containerId: 'test-list', title: 'y' } }), { code: 'permission_denied' });
  const rows = await f.admin('operations.list') as Array<{ id: string }>;
  assert.equal(rows.some((row) => row.id === plan.id), false);
});

test('management records last use and deletes active authorizations', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const { id, token } = await pairClient(f);
  await f.agent(token, 'capabilities');
  const listed = await f.admin('clients.list') as Array<{ id: string; lastUsedAt: number | null }>;
  assert.equal(listed.find((client) => client.id === id)?.lastUsedAt !== null, true);
  await assert.rejects(f.agent(token, 'clients.delete', { id }), { code: 'permission_denied' });
  assert.deepEqual(await f.admin('clients.delete', { id }), { id });
  await assert.rejects(f.agent(token, 'auth.verify', { agent: 'Deleted' }), { code: 'permission_denied' });
  assert.deepEqual(await f.admin('clients.list'), []);
  const audit = await f.admin('audit.list') as Array<{ action: string; clientId?: string }>;
  assert.ok(audit.some((event) => event.action === 'client_deleted' && event.clientId === id));
});

test('agent container reads are audited with the target and never leak colors', async (t) => {
  const calendarReader: CalendarReader = {
    listCalendars: async () => [{ id: 'work', name: 'Work' }],
    listEvents: async (calendarId) => ({
      items: [{ id: 'event-1', calendarId, title: 'Planning', start: '2028-02-29T09:00:00+08:00', end: '2028-02-29T10:00:00+08:00', allDay: false, location: '', notes: '' }],
      nextOffset: null,
    }),
  };
  const f = await fixture({ calendarReader });
  t.after(() => closeFixture(f));
  const created = await f.admin('clients.create', {
    name: 'Reader Agent',
    grants: [{ provider: 'calendar', containerIds: ['work'], actions: ['read'], expiresAt: Date.now() + 3_600_000 }],
  }) as { token: string; client: { id: string } };
  const calendars = await f.agent(created.token, 'calendar.list_calendars') as Array<Record<string, unknown>>;
  assert.deepEqual(calendars, [{ id: 'work', name: 'Work' }]);
  await f.agent(created.token, 'calendar.list_events', { calendarId: 'work', from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00' });
  const audit = await f.admin('audit.list') as Array<{ action: string; provider?: string; target?: string; outcome: string; count: number; clientId?: string; clientName?: string }>;
  const read = audit.find((event) => event.action === 'read' && event.clientId === created.client.id);
  assert.equal(read?.provider, 'calendar');
  assert.equal(read?.target, 'work');
  assert.equal(read?.outcome, 'allowed');
  assert.equal(read?.count, 1);
  assert.equal(read?.clientName, 'Reader Agent');
});

test('management can delete one audit lane without touching authorizations or other history', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const first = await f.admin('clients.create', { name: 'First', grants: [] }) as { client: { id: string } };
  const second = await f.admin('clients.create', { name: 'Second', grants: [] }) as { client: { id: string } };
  const { token } = await pairClient(f);
  f.store.audit({ at: 10, clientId: first.client.id, provider: 'calendar', action: 'create', outcome: 'succeeded', count: 1, target: 'work' });
  f.store.audit({ at: 11, clientId: second.client.id, provider: 'reminders', action: 'delete', outcome: 'succeeded', count: 1, target: 'inbox' });
  f.store.audit({ at: 12, source: 'web', provider: 'calendar', action: 'read', outcome: 'succeeded', count: 1, target: 'work' });
  const deleted = await f.admin('audit.delete_lane', { kind: 'client', clientId: first.client.id }) as { deleted: number };
  assert.ok(deleted.deleted >= 1);
  const remaining = await f.admin('audit.list') as Array<{ clientId?: string; source?: string }>;
  assert.equal(remaining.some((event) => event.clientId === first.client.id), false);
  assert.ok(remaining.some((event) => event.clientId === second.client.id));
  assert.deepEqual(await f.admin('audit.delete_lane', { kind: 'web' }), { deleted: 1 });
  assert.equal((await f.admin('clients.list') as unknown[]).length, 3);
  await assert.rejects(f.admin('audit.delete_lane', { kind: 'client' }), { code: 'invalid_request' });
  await assert.rejects(f.agent(token, 'audit.delete_lane', { kind: 'web' }), { code: 'permission_denied' });
});

test('deleting an authorization keeps its name in audit history', async (t) => {
  const f = await fixture();
  t.after(() => closeFixture(f));
  const created = await f.admin('clients.create', { name: 'Deleted Agent', grants: [] }) as { client: { id: string } };
  await f.admin('clients.delete', { id: created.client.id });
  const audit = await f.admin('audit.list') as Array<{ action: string; clientId?: string; clientName?: string }>;
  assert.equal(audit.find((event) => event.action === 'client_created' && event.clientId === created.client.id)?.clientName, 'Deleted Agent');
  assert.equal(audit.find((event) => event.action === 'client_deleted' && event.clientId === created.client.id)?.clientName, 'Deleted Agent');
});
