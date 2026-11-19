import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/database.js';
import { AgentOperations } from '../src/operations/agent.js';
import { WebWrites } from '../src/application/web-writes.js';
import { ServiceFacade } from '../src/transports/local/handlers.js';
import { DatabaseSync } from 'node:sqlite';
import { ConnectorError } from '../src/application/errors.js';

test('disk database reopens with credentials and private filesystem permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-db-'));
  const path = join(root, 'state', 'connector.sqlite');
  try {
    const first = new Store(path);
    const { token, client } = first.createClient({ name: 'Test', grants: [] });
    first.close();
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, 'state')).mode & 0o777, 0o700);
    const second = new Store(path);
    try {
      assert.equal(second.authenticate(token).id, client.id);
      second.deleteClient(client.id);
      assert.throws(() => second.authenticate(token), { code: 'permission_denied' });
    } finally { second.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('v5 databases strip approval from grants and cancel unfinished operations', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-v5-'));
  const path = join(root, 'connector.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      grants TEXT NOT NULL, policy_version INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER);
      CREATE TABLE operations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, provider TEXT NOT NULL,
        key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, policy_version INTEGER NOT NULL,
        state TEXT NOT NULL, payload TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
        result TEXT, UNIQUE(client_id, key_hash));
      PRAGMA user_version=5;`);
    legacy.prepare(`INSERT INTO clients(id,name,token_hash,grants) VALUES('client','Legacy','hash',?)`)
      .run(JSON.stringify([{ provider: 'reminders', containerIds: ['one'], actions: ['read'], approval: 'required', expiresAt: Date.now() + 60_000 }]));
    legacy.prepare(`INSERT INTO operations(id,client_id,provider,key_hash,request_hash,policy_version,state,payload,expires_at,created_at)
      VALUES('waiting','client','reminders','k1','r1',1,'prepared','{}',1,1),('approved','client','reminders','k2','r2',1,'approved','{}',1,2)`).run();
    legacy.close();
    const store = new Store(path);
    try {
      const grant = store.client('client').grants[0] as Record<string, unknown>;
      assert.equal('approval' in grant, false);
      assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 8);
      const states = store.db.prepare('SELECT id,state,payload FROM operations ORDER BY id').all() as Array<{ id: string; state: string; payload: string | null }>;
      assert.deepEqual(states.map((row) => ({ ...row })), [{ id: 'approved', state: 'cancelled', payload: null }, { id: 'waiting', state: 'cancelled', payload: null }]);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('client last-used timestamps update at most once per minute', () => {
  const store = new Store(':memory:');
  try {
    const created = store.createClient({ name: 'Usage', grants: [] });
    assert.equal(created.client.lastUsedAt, null);
    assert.equal(store.authenticate(created.token, 10_000).lastUsedAt, 10_000);
    assert.equal(store.authenticate(created.token, 40_000).lastUsedAt, 10_000);
    assert.equal(store.authenticate(created.token, 70_001).lastUsedAt, 70_001);
    assert.equal(store.listClients()[0]?.lastUsedAt, 70_001);
    assert.equal(store.client(created.client.id).policyVersion, 1);
  } finally { store.close(); }
});

test('Agent verification records the latest Agent name and timestamp', () => {
  const store = new Store(':memory:');
  try {
    const created = store.createClient({ name: 'Bound', grants: [] });
    assert.equal(created.client.agentName, null);
    assert.equal(created.client.verifiedAt, null);
    const first = store.verifyClient(created.client.id, 'Claude Code', 10_000);
    assert.equal(first.agentName, 'Claude Code');
    assert.equal(first.verifiedAt, 10_000);
    const second = store.verifyClient(created.client.id, 'Codex', 20_000);
    assert.equal(second.agentName, 'Codex');
    assert.equal(second.verifiedAt, 20_000);
    assert.equal(store.listClients()[0]?.agentName, 'Codex');
    assert.equal(store.listClients()[0]?.verifiedAt, 20_000);
    assert.throws(() => store.verifyClient('missing', 'Agent', 30_000), { code: 'permission_denied' });
  } finally { store.close(); }
});

test('v7 databases gain nullable Agent binding columns', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-v7-'));
  const path = join(root, 'connector.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      grants TEXT NOT NULL, policy_version INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER);
      PRAGMA user_version=7;`);
    legacy.prepare(`INSERT INTO clients(id,name,token_hash,grants) VALUES('client','Legacy','hash','[]')`).run();
    legacy.close();
    const store = new Store(path);
    try {
      const client = store.client('client');
      assert.equal(client.agentName, null);
      assert.equal(client.verifiedAt, null);
      assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 8);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('active clients can be deleted with their operations while audit history remains', () => {
  const store = new Store(':memory:');
  try {
    const created = store.createClient({ name: 'Delete me', grants: [] });
    store.db.prepare(`INSERT INTO operations(id,client_id,provider,key_hash,request_hash,policy_version,state,expires_at,created_at)
      VALUES('done',?,'reminders','k1','r1',1,'succeeded',10,1),('pending',?,'reminders','k2','r2',1,'executing',10,2)`)
      .run(created.client.id, created.client.id);
    assert.throws(() => store.deleteClient(created.client.id), { code: 'conflict' });
    store.db.prepare("UPDATE operations SET state='outcome_unknown' WHERE id='pending'").run();
    assert.deepEqual(store.deleteClient(created.client.id), { id: created.client.id });
    assert.throws(() => store.client(created.client.id), { code: 'permission_denied' });
    assert.equal((store.db.prepare('SELECT COUNT(*) AS count FROM operations').get() as { count: number }).count, 0);
    assert.equal(store.listClients().length, 0);
    assert.ok(store.auditEvents().some((event) => event.action === 'client_deleted' && event.clientId === created.client.id));
  } finally { store.close(); }
});

test('v4 databases gain a nullable last-used timestamp', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-v4-'));
  const path = join(root, 'connector.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      grants TEXT NOT NULL, policy_version INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version=4;`);
    legacy.prepare(`INSERT INTO clients(id,name,token_hash,grants) VALUES('client','Legacy','hash','[]')`).run();
    legacy.close();
    const store = new Store(path);
    try {
      assert.equal(store.client('client').lastUsedAt, null);
      assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 8);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('maintenance removes expired content but retains unknown outcomes', async () => {
  const store = new Store(':memory:');
  const now = Date.now();
  try {
    const { token } = store.createClient({ name: 'Test', grants: [{ provider: 'reminders', containerIds: ['test'], actions: ['create'], expiresAt: now + 3600_000 }] });
    const operations = new AgentOperations(store, {
      preflight: async () => {}, create: async () => ({ id: 'test', containerId: 'test' }), verify: async () => true,
    }, undefined, undefined, undefined, () => now);
    const plan = await operations.prepare(token, { idempotencyKey: 'test', change: { kind: 'reminders.create', containerId: 'test', title: 'SECRET' } });
    const unknown = await operations.prepare(token, { idempotencyKey: 'unknown', change: { kind: 'reminders.create', containerId: 'test', title: 'SECRET' } });
    store.db.prepare("UPDATE operations SET state='outcome_unknown',payload=NULL WHERE id=?").run(unknown.id);
    store.pruneOperations(now + 16 * 60_000);
    assert.equal(operations.get(token, plan.id).state, 'expired');
    assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM operations').all()).includes('SECRET'));
    store.pruneOperations(now + 31 * 86_400_000);
    assert.throws(() => operations.get(token, plan.id), { code: 'permission_denied' });
    assert.equal(operations.get(token, unknown.id).state, 'outcome_unknown');
    assert.throws(() => store.assertOperationCapacity(9 * 1024 * 1024), { code: 'service_unavailable' });
  } finally { store.close(); }
});

test('audit summary and explicit clearing retain no metadata or logical-byte budget', () => {
  const store = new Store(':memory:');
  try {
    store.audit({ at: 1, clientId: 'client', provider: 'notes', action: 'read', outcome: 'allowed', count: 2 });
    const before = store.auditSummary();
    assert.equal(before.count, 1);
    assert.ok(before.bytes > 0);
    store.clearAudit();
    assert.deepEqual(store.auditSummary(), { count: 0, bytes: 0 });
    assert.deepEqual(store.auditEvents(), []);
  } finally { store.close(); }
});

test('web writes are idempotent, isolated from clients, and retain no content after completion', async () => {
  const store = new Store(':memory:'); let writes = 0;
  const reminders = { preflight: async () => {}, create: async (change: { containerId: string }) => ({ id: `r-${++writes}`, containerId: change.containerId }), verify: async () => true };
  const notes = { preflight: async () => {}, create: async (change: { containerId: string }) => ({ id: 'n-1', containerId: change.containerId }), verify: async () => true };
  try {
    const web = new WebWrites(store, reminders, notes);
    const input = { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE TITLE', body: 'PRIVATE BODY' };
    const [one, two] = await Promise.all([web.submitReminders('web-key', input), web.submitReminders('web-key', input)]);
    assert.equal(writes, 1); assert.equal(one.id, two.id); assert.equal(one.state, 'succeeded');
    assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM web_operations').all()).includes('PRIVATE'));
    const audit = store.queryAudit({ source: 'web' });
    assert.equal(audit.total, 1); assert.ok(audit.items.every((event) => !event.clientId)); assert.ok((audit.items[0]?.durationMs ?? -1) >= 0);
    assert.throws(() => web.get('unknown'), { code: 'permission_denied' });
  } finally { store.close(); }
});

test('web reminder edits and deletions are idempotent and clear their payloads', async () => {
  const store = new Store(':memory:'); let updates = 0; let deletes = 0;
  const reminders = {
    preflight: async () => {}, create: async () => ({ id: 'unused', containerId: 'unused' }), verify: async () => true,
    update: async (change: { id: string; containerId: string }) => { updates++; return { id: change.id, containerId: change.containerId }; },
    remove: async (change: { id: string; containerId: string }) => { deletes++; return { id: change.id, containerId: change.containerId }; },
  };
  try {
    const web = new WebWrites(store, reminders);
    const update = { kind: 'reminders.update', containerId: 'test-list', id: 'r-1', title: 'PRIVATE TITLE', body: 'PRIVATE BODY', completed: true };
    const deletion = { kind: 'reminders.delete', containerId: 'test-list', id: 'r-1' };
    const [one, two] = await Promise.all([web.submitReminderUpdate('update-key', update), web.submitReminderUpdate('update-key', update)]);
    assert.equal(updates, 1); assert.equal(one.state, 'succeeded'); assert.deepEqual(one, two);
    await web.submitReminderDelete('delete-key', deletion);
    assert.equal(deletes, 1);
    assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM web_operations').all()).includes('PRIVATE'));
    assert.deepEqual(store.queryAudit({ source: 'web' }).items.map((item) => item.action).sort(), ['delete', 'update']);
  } finally { store.close(); }
});

test('web calendar creates, edits, and deletes use one durable idempotent operation each', async () => {
  const store = new Store(':memory:'); let creates = 0; let updates = 0; let deletes = 0;
  const reminders = { preflight: async () => {}, create: async () => ({ id: 'unused', containerId: 'unused' }), verify: async () => true };
  const calendars = {
    create: async (change: { containerId: string }) => ({ id: `event-${++creates}`, containerId: change.containerId }),
    update: async (change: { id: string; containerId: string }) => { updates++; return { id: change.id, containerId: change.containerId }; },
    remove: async (change: { id: string; containerId: string }) => { deletes++; return { id: change.id, containerId: change.containerId }; },
  };
  const input = { containerId: 'calendar-1', title: 'PRIVATE TITLE', start: '2028-02-29T09:00:00+08:00', end: '2028-02-29T10:00:00+08:00', allDay: false, location: 'PRIVATE', notes: 'PRIVATE' };
  try {
    const web = new WebWrites(store, reminders, undefined, Date.now, calendars);
    const [one, two] = await Promise.all([web.submitCalendarCreate('calendar-create', { kind: 'calendar.create', ...input }), web.submitCalendarCreate('calendar-create', { kind: 'calendar.create', ...input })]);
    assert.equal(creates, 1); assert.equal(one.state, 'succeeded'); assert.deepEqual(one, two);
    await web.submitCalendarUpdate('calendar-update', { kind: 'calendar.update', id: 'event-1', ...input });
    await web.submitCalendarDelete('calendar-delete', { kind: 'calendar.delete', containerId: input.containerId, id: 'event-1' });
    assert.equal(updates, 1); assert.equal(deletes, 1);
    assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM web_operations').all()).includes('PRIVATE'));
    assert.deepEqual(store.queryAudit({ source: 'web', provider: 'calendar' }).items.map((event) => event.action).sort(), ['create', 'delete', 'update']);
  } finally { store.close(); }
});

test('definite Web reminder mutation failures remain visible and are not reported as unknown', async () => {
  const store = new Store(':memory:');
  const reminders = {
    preflight: async () => {}, create: async () => ({ id: 'unused', containerId: 'unused' }), verify: async () => true,
    update: async () => { throw new ConnectorError('invalid_request', 'Reminder cannot be edited.'); },
  };
  try {
    const web = new WebWrites(store, reminders);
    const input = { kind: 'reminders.update', containerId: 'test-list', id: 'r-1', title: 'PRIVATE', body: '', completed: true };
    await assert.rejects(web.submitReminderUpdate('failed-update-key', input), { code: 'invalid_request' });
    assert.equal(web.get('failed-update-key').state, 'failed');
    assert.equal(store.db.prepare('SELECT payload FROM web_operations WHERE id=?').get('failed-update-key')?.payload, null);
    assert.equal(store.queryAudit({ source: 'web' }).items[0]?.outcome, 'failed');
  } finally { store.close(); }
});

test('management routes reminder update and delete requests to Web writes', async () => {
  const store = new Store(':memory:'); let updates = 0; let deletes = 0;
  const reminders = {
    preflight: async () => {}, create: async () => ({ id: 'unused', containerId: 'unused' }), verify: async () => true,
    update: async (change: { id: string; containerId: string }) => { updates++; return { id: change.id, containerId: change.containerId }; },
    remove: async (change: { id: string; containerId: string }) => { deletes++; return { id: change.id, containerId: change.containerId }; },
  };
  try {
    const operations = new AgentOperations(store, reminders);
    const web = new WebWrites(store, reminders);
    const facade = new ServiceFacade(store, operations, 'admin', 'test', undefined, undefined, undefined, undefined, undefined, undefined, web);
    const update = await facade.management('web.reminders.update', { idempotencyKey: '7632737c-ea5e-45bd-a8aa-a0179f84b950', change: { kind: 'reminders.update', containerId: 'test-list', id: 'r-1', title: 'Updated', body: '', completed: true } });
    const deletion = await facade.management('web.reminders.delete', { idempotencyKey: '0098919d-17e7-482d-b2f4-0bb79c3a5771', change: { kind: 'reminders.delete', containerId: 'test-list', id: 'r-1' } });
    assert.equal(update.ok, true); assert.equal(deletion.ok, true); assert.equal(updates, 1); assert.equal(deletes, 1);
  } finally { store.close(); }
});

test('management rejects legacy Notes Web endpoints before a reader or audit event', async () => {
  const store = new Store(':memory:');
  const reminderOps = new AgentOperations(store, { preflight: async () => {}, create: async () => ({ id: 'unused', containerId: 'unused' }), verify: async () => true });
  const facade = new ServiceFacade(store, reminderOps, 'admin', 'test', undefined,
    { search: async (folderId: string, query: string) => [{ id: 'note', folderId, title: 'private', snippet: query }], get: async () => ({ id: 'note', folderId: 'folder', title: 'private', snippet: '', body: 'private body' }) } as never,
    { list: async (listId: string) => ({ items: [{ id: 'r', listId, title: 'private', body: '', completed: false, due: null }], nextOffset: null }) } as never,
    { listEvents: async (calendarId: string) => ({ items: [{ calendarId, title: 'private', start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z', allDay: false, location: '', notes: '' }], nextOffset: null }) } as never);
  try {
    const response = await facade.management('web.notes.search', { folderId: 'folder', query: 'x', limit: 50 });
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.error.code, 'unsupported_operation');
    const audit = store.queryAudit({ source: 'web' });
    assert.equal(audit.total, 0); assert.equal(JSON.stringify(audit).includes('private'), false);
    const denied = await facade.agent('web.notes.search', { folderId: 'folder', query: 'x' }, 'not-a-client-token');
    assert.equal(denied.ok, false);
  } finally { store.close(); }
});

test('management audit and operation queries filter before paginating', () => {
  const store = new Store(':memory:');
  try {
    const one = store.createClient({ name: 'One', grants: [] }).client.id;
    const two = store.createClient({ name: 'Two', grants: [] }).client.id;
    store.audit({ at: 1, clientId: one, provider: 'notes', action: 'read', outcome: 'allowed', count: 1 });
    store.audit({ at: 2, clientId: two, provider: 'reminders', action: 'create', outcome: 'failed', count: 1, errorCode: 'service_unavailable' });
    store.audit({ at: 3, clientId: one, provider: 'notes', action: 'create', outcome: 'allowed', count: 1 });
    store.audit({ at: 4, source: 'web', provider: 'notes', action: 'read', outcome: 'succeeded', count: 1, target: 'Personal' });
    const audit = store.queryAudit({ clientId: one, provider: 'notes', limit: 1, offset: 1 });
    assert.equal(audit.total, 2);
    assert.deepEqual(audit.items.map((event) => event.at), [1]);
    const webAudit = store.queryAudit({ source: 'web', limit: 10 });
    assert.equal(webAudit.total, 1);
    assert.deepEqual(webAudit.items[0], { at: 4, source: 'web', provider: 'notes', action: 'read', outcome: 'succeeded', count: 1, target: 'Personal' });
    store.db.prepare(`INSERT INTO operations(id,client_id,provider,key_hash,request_hash,policy_version,state,expires_at,created_at)
      VALUES('one',?,'notes','k1','r1',1,'prepared',10,2),('two',?,'reminders','k2','r2',1,'succeeded',10,3)`).run(one, two);
    const operations = store.queryOperations({ provider: 'notes', limit: 10 });
    assert.equal(operations.total, 1);
    assert.equal(operations.items[0]?.id, 'one');
  } finally { store.close(); }
});

test('storage diagnostics expose counts and metadata-only recent errors', () => {
  const store = new Store(':memory:');
  try {
    store.audit({ at: 2, clientId: 'client', provider: 'reminders', action: 'create', outcome: 'outcome_unknown', count: 1, errorCode: 'outcome_unknown' });
    const diagnostics = store.diagnostics();
    assert.ok(diagnostics.pageSize > 0);
    assert.ok(diagnostics.pageCount > 0);
    assert.ok(diagnostics.freePages >= 0);
    assert.deepEqual(diagnostics.operationsByState, {});
    assert.deepEqual(diagnostics.recentErrors, [{ at: 2, provider: 'reminders', action: 'create', errorCode: 'outcome_unknown' }]);
    assert.equal(JSON.stringify(diagnostics).includes('client'), false);
  } finally { store.close(); }
});

test('v1 databases migrate operations to an explicit reminders provider', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-v1-'));
  const path = join(root, 'connector.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, grants TEXT NOT NULL, policy_version INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE operations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, policy_version INTEGER NOT NULL, state TEXT NOT NULL, payload TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, result TEXT, UNIQUE(client_id, key_hash));
      PRAGMA user_version=1;`);
    legacy.prepare(`INSERT INTO clients(id,name,token_hash,grants) VALUES('client','Legacy','hash','[]')`).run();
    legacy.prepare(`INSERT INTO operations(id,client_id,key_hash,request_hash,policy_version,state,expires_at,created_at) VALUES('op','client','k','r',1,'succeeded',0,0)`).run();
    legacy.close();
    const store = new Store(path);
    try {
      assert.equal(store.operationProvider('op'), 'reminders');
      assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 8);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('v6 databases drop transient onboarding state', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-v6-'));
  const path = join(root, 'connector.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE onboarding (id TEXT PRIMARY KEY, state TEXT NOT NULL, expires_at INTEGER NOT NULL,
      client_id TEXT, credential_file TEXT, failure_code TEXT, created_at INTEGER NOT NULL);
      PRAGMA user_version=6;`);
    legacy.close();
    const store = new Store(path);
    try {
      assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 8);
      assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='onboarding'").get(), undefined);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('audit events capture the authorization name and survive deletion', () => {
  const store = new Store(':memory:');
  try {
    const { client } = store.createClient({ name: 'Research Agent', grants: [] });
    store.audit({ at: 2, clientId: client.id, provider: 'calendar', action: 'read', outcome: 'allowed', count: 1, target: 'work' });
    assert.ok(store.auditEvents().every((event) => event.clientName === 'Research Agent'));
    store.deleteClient(client.id);
    const deleted = store.auditEvents().find((event) => event.action === 'client_deleted');
    assert.equal(deleted?.clientName, 'Research Agent');
  } finally { store.close(); }
});

test('deleting a lane removes only that lane history and keeps everything else', () => {
  const store = new Store(':memory:');
  try {
    const first = store.createClient({ name: 'First', grants: [] }).client;
    const second = store.createClient({ name: 'Second', grants: [] }).client;
    store.audit({ at: 3, clientId: first.id, provider: 'calendar', action: 'create', outcome: 'succeeded', count: 1, target: 'work' });
    store.audit({ at: 4, clientId: second.id, provider: 'reminders', action: 'delete', outcome: 'succeeded', count: 1, target: 'inbox' });
    store.audit({ at: 5, source: 'web', provider: 'calendar', action: 'read', outcome: 'succeeded', count: 2, target: 'work' });
    const deleted = store.deleteAuditLane({ kind: 'client', clientId: first.id });
    assert.ok(deleted.deleted >= 1);
    assert.equal(store.auditEvents().some((event) => event.clientId === first.id), false);
    assert.equal(store.auditEvents().filter((event) => event.clientId === second.id).length, 2);
    assert.equal(store.auditEvents().filter((event) => event.source === 'web').length, 1);
    assert.equal(store.deleteAuditLane({ kind: 'web' }).deleted, 1);
    assert.equal(store.auditEvents().filter((event) => event.source === 'web').length, 0);
  } finally { store.close(); }
});
