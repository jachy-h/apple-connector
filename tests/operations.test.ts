import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/storage/database.js';
import { authorize, projectCalendarEvent } from '../src/policy/authorize.js';
import { ReminderOperations } from '../src/operations/reminders.js';
import { createReminderSchema } from '../src/providers/reminders/types.js';
import type { ReminderWriter } from '../src/providers/reminders/types.js';

function fixture(approval: 'automatic' | 'required' = 'automatic') {
  const store = new Store(':memory:');
  let clock = Date.now();
  const { client, token } = store.createClient({ name: 'Test client', grants: [{
    provider: 'reminders', containerIds: ['test-list'], actions: ['create'], fields: 'full', approval,
    expiresAt: clock + 3600_000,
  }] });
  let writes = 0;
  const writer: ReminderWriter = {
    preflight: async () => {},
    create: async (change) => { writes++; return { id: `test-${writes}`, containerId: change.containerId }; },
    verify: async () => true,
  };
  const operations = new ReminderOperations(store, writer, () => clock);
  const request = { idempotencyKey: 'key', change: { kind: 'reminders.create', containerId: 'test-list', title: 'PRIVATE TITLE', body: 'PRIVATE BODY' } };
  return { store, token, client, writer, operations, request, writes: () => writes, advance: (ms: number) => { clock += ms; } };
}

test('default deny, expired scopes, unknown input and busy-field projection', () => {
  const f = fixture();
  try {
    assert.throws(() => authorize(f.client, 'notes', 'test-list', 'read'), { code: 'permission_denied' });
    assert.throws(() => authorize(f.client, 'reminders', 'other-list', 'create'), { code: 'permission_denied' });
    assert.throws(() => authorize(f.client, 'reminders', 'test-list', 'create', Date.now() + 7200_000), { code: 'permission_denied' });
    assert.throws(() => f.operations.prepare(f.token, { ...f.request, user_approved: true }));
    assert.deepEqual(projectCalendarEvent({ id: 'private-id', title: 'secret', url: 'secret', start: 'a', end: 'b', allDay: false, futurePrivateField: 'secret' }, 'busy'), { start: 'a', end: 'b', allDay: false });
  } finally { f.store.close(); }
});

test('one mutation for concurrent retries and no content retained after success', async () => {
  const f = fixture();
  try {
    const plan = f.operations.prepare(f.token, f.request);
    assert.deepEqual(f.operations.prepare(f.token, f.request), plan);
    const results = await Promise.all([f.operations.commit(f.token, plan.id), f.operations.commit(f.token, plan.id)]);
    assert.equal(f.writes(), 1);
    assert.equal(results[0]?.state, 'succeeded');
    assert.deepEqual(results[0], results[1]);
    const rows = f.store.db.prepare('SELECT * FROM operations').all();
    assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
    assert.ok(!JSON.stringify(f.store.auditEvents()).includes('PRIVATE'));
    assert.throws(() => f.operations.prepare(f.token, { ...f.request, change: { ...f.request.change, title: 'different' } }), { code: 'conflict' });
  } finally { f.store.close(); }
});

test('approval, ownership and expiration enforced before execution', async () => {
  const f = fixture('required');
  try {
    const plan = f.operations.prepare(f.token, f.request);
    await assert.rejects(f.operations.commit(f.token, plan.id), { code: 'approval_required' });
    const other = f.store.createClient({ name: 'Other', grants: [] });
    assert.throws(() => f.operations.get(other.token, plan.id), { code: 'permission_denied' });
    await assert.rejects(f.operations.commit(other.token, plan.id), { code: 'permission_denied' });
    f.operations.approve(plan.id);
    f.advance(16 * 60_000);
    await assert.rejects(f.operations.commit(f.token, plan.id), { code: 'conflict' });
    assert.equal(f.writes(), 0);
  } finally { f.store.close(); }
});

test('revocation during native preflight prevents mutation', async () => {
  const f = fixture();
  try {
    f.writer.preflight = async () => { f.store.revoke(f.client.id); };
    const plan = f.operations.prepare(f.token, f.request);
    await assert.rejects(f.operations.commit(f.token, plan.id), { code: 'permission_denied' });
    assert.equal(f.writes(), 0);
    assert.throws(() => f.store.authenticate(f.token), { code: 'permission_denied' });
    assert.equal(f.store.db.prepare('SELECT payload FROM operations WHERE id=?').get(plan.id)?.payload, null);
  } finally { f.store.close(); }
});

test('unknown native result is never automatically replayed', async () => {
  const f = fixture();
  try {
    let attempts = 0;
    f.writer.create = async () => { attempts++; throw new Error('Native timeout containing SECRET'); };
    const plan = f.operations.prepare(f.token, f.request);
    await assert.rejects(f.operations.commit(f.token, plan.id), { code: 'outcome_unknown' });
    assert.equal((await f.operations.commit(f.token, plan.id)).state, 'outcome_unknown');
    assert.equal(attempts, 1);
    assert.ok(!JSON.stringify(f.store.auditEvents()).includes('SECRET'));
  } finally { f.store.close(); }
});

test('crash recovery and audit pruning preserve idempotency', async () => {
  const f = fixture();
  try {
    const plan = f.operations.prepare(f.token, f.request);
    f.store.db.prepare("UPDATE operations SET state='executing' WHERE id=?").run(plan.id);
    const recovered = new ReminderOperations(f.store, f.writer);
    f.store.pruneAudit(Date.now(), { days: 1, maxRows: 1, maxBytes: 1 });
    assert.equal(f.store.auditEvents().length, 0);
    assert.equal((await recovered.commit(f.token, plan.id)).state, 'outcome_unknown');
    assert.equal(f.writes(), 0);
  } finally { f.store.close(); }
});

test('failed audit intent prevents native write', async () => {
  const f = fixture();
  try {
    const plan = f.operations.prepare(f.token, f.request);
    f.store.db.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'disk failure'); END;`);
    await assert.rejects(f.operations.commit(f.token, plan.id));
    assert.equal(f.writes(), 0);
    assert.equal(f.operations.get(f.token, plan.id).state, 'approved');
  } finally { f.store.close(); }
});

test('audit rejects arbitrary metadata and respects row and age budgets', () => {
  const f = fixture();
  try {
    const now = Date.now();
    for (let i = 0; i < 5; i++) f.store.audit({ at: now, clientId: f.client.id, action: 'read', outcome: 'allowed', count: i });
    f.store.pruneAudit(now, { days: 1, maxRows: 2, maxBytes: 10_000 });
    assert.equal(f.store.auditEvents().length, 2);
    f.store.pruneAudit(now + 2 * 86_400_000, { days: 1, maxRows: 2, maxBytes: 10_000 });
    assert.equal(f.store.auditEvents().length, 0);
    const tokens = f.store.db.prepare('SELECT token_hash FROM clients').all();
    assert.ok(!JSON.stringify(tokens).includes(f.token));
  } finally { f.store.close(); }
});

test('date-only reminders do not become UTC instants and invalid dates fail', () => {
  const f = fixture();
  try {
    const parsed = createReminderSchema.parse({ ...f.request.change, due: { kind: 'date', date: '2028-02-29' } });
    assert.deepEqual(parsed.due, { kind: 'date', date: '2028-02-29' });
    assert.throws(() => createReminderSchema.parse({ ...f.request.change, due: { kind: 'date', date: '2026-02-29' } }));
    assert.throws(() => createReminderSchema.parse({ ...f.request.change, due: { kind: 'instant', at: '2026-10-01T10:00:00', timeZone: 'Asia/Shanghai' } }));
  } finally { f.store.close(); }
});
