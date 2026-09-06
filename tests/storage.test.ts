import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/database.js';
import { ReminderOperations } from '../src/operations/reminders.js';
import { DatabaseSync } from 'node:sqlite';

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
      second.revoke(client.id);
      assert.throws(() => second.authenticate(token), { code: 'permission_denied' });
    } finally { second.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('maintenance removes expired content but retains unknown outcomes', () => {
  const store = new Store(':memory:');
  const now = Date.now();
  try {
    const { token } = store.createClient({ name: 'Test', grants: [{ provider: 'reminders', containerIds: ['test'], actions: ['create'], expiresAt: now + 3600_000 }] });
    const operations = new ReminderOperations(store, {
      preflight: async () => {}, create: async () => ({ id: 'test', containerId: 'test' }), verify: async () => true,
    }, () => now);
    const plan = operations.prepare(token, { idempotencyKey: 'test', change: { kind: 'reminders.create', containerId: 'test', title: 'SECRET' } });
    const unknown = operations.prepare(token, { idempotencyKey: 'unknown', change: { kind: 'reminders.create', containerId: 'test', title: 'SECRET' } });
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
      assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
