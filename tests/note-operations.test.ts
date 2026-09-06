import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/storage/database.js';
import { NoteOperations } from '../src/operations/notes.js';

test('note creation plan enforces scope, approval, idempotency and durable verification', async () => {
  const store = new Store(':memory:');
  const now = Date.now();
  let writes = 0;
  try {
    const { token } = store.createClient({ name: 'Notes agent', grants: [{ provider: 'notes', containerIds: ['Agents'], actions: ['create'], approval: 'required', expiresAt: now + 3600_000 }] });
    const operations = new NoteOperations(store, {
      preflight: async () => {},
      create: async () => { writes++; return { id: 'note-1', containerId: 'Agents' }; },
      verify: async () => true,
    }, () => now);
    const request = { idempotencyKey: 'note-create', change: { kind: 'notes.create' as const, containerId: 'Agents', title: 'Hello', body: '<untrusted>' } };
    const plan = operations.prepare(token, request);
    assert.equal(plan.state, 'prepared');
    assert.throws(() => operations.prepare(token, { ...request, change: { ...request.change, body: 'other' } }), { code: 'conflict' });
    await assert.rejects(operations.commit(token, plan.id), { code: 'approval_required' });
    operations.approve(plan.id);
    const result = await operations.commit(token, plan.id);
    assert.equal(result.state, 'succeeded');
    assert.deepEqual(result.result, { id: 'note-1', containerId: 'Agents' });
    assert.equal(writes, 1);
    assert.equal(store.operationProvider(plan.id), 'notes');
    assert.equal(JSON.stringify(store.db.prepare('SELECT payload FROM operations WHERE id=?').get(plan.id)).includes('<untrusted>'), false);
  } finally { store.close(); }
});

test('note creation rejects a client without a Notes grant', () => {
  const store = new Store(':memory:');
  try {
    const { token } = store.createClient({ name: 'Agent', grants: [{ provider: 'reminders', containerIds: ['Agents'], actions: ['create'], expiresAt: Date.now() + 3600_000 }] });
    const operations = new NoteOperations(store, { preflight: async () => {}, create: async () => ({ id: 'x', containerId: 'Agents' }), verify: async () => true });
    assert.throws(() => operations.prepare(token, { idempotencyKey: 'x', change: { kind: 'notes.create', containerId: 'Agents', title: 'X' } }), { code: 'permission_denied' });
  } finally { store.close(); }
});
