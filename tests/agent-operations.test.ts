import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentOperations } from '../src/operations/agent.js';
import type { AgentReminderMutator } from '../src/providers/reminders/eventkit.js';
import type { ReminderWriter } from '../src/providers/reminders/types.js';
import { Store } from '../src/storage/database.js';

function fixture(actions: Array<'read' | 'create' | 'update' | 'complete' | 'delete'> = ['update']) {
  const store = new Store(':memory:');
  const now = Date.now();
  const { token } = store.createClient({
    name: 'Patch client',
    grants: [{ provider: 'reminders', containerIds: ['test-list'], actions, expiresAt: now + 3600_000 }],
  });
  const patches: unknown[] = [];
  const writer: ReminderWriter & Partial<AgentReminderMutator> = {
    preflight: async () => {},
    create: async (change) => ({ id: 'created', containerId: change.containerId }),
    verify: async () => true,
    patch: async (change) => { patches.push(change); return { id: change.id, containerId: change.containerId }; },
  };
  const operations = new AgentOperations(store, writer, undefined, undefined, undefined, () => now);
  return { store, token, operations, patches };
}

test('patch uses the update grant, preserves a partial payload and is idempotent', async () => {
  const f = fixture();
  try {
    const change = { kind: 'reminders.patch', containerId: 'test-list', id: 'reminder-1', due: { kind: 'instant', at: '2026-11-20T17:00:00+08:00', timeZone: 'Asia/Shanghai' } };
    const first = await f.operations.submit(f.token, { idempotencyKey: 'patch-key', change });
    assert.equal(first.state, 'succeeded');
    assert.deepEqual(first.result, { id: 'reminder-1', containerId: 'test-list' });
    assert.equal(f.patches.length, 1);
    const replay = await f.operations.submit(f.token, { idempotencyKey: 'patch-key', change });
    assert.deepEqual(replay, first);
    assert.equal(f.patches.length, 1);
    await assert.rejects(f.operations.submit(f.token, { idempotencyKey: 'patch-key', change: { ...change, due: null } }), { code: 'conflict' });
  } finally { f.store.close(); }
});

test('patch preserves null due and false completion through the operation layer', async () => {
  const f = fixture();
  try {
    const result = await f.operations.submit(f.token, {
      idempotencyKey: 'clear-key',
      change: { kind: 'reminders.patch', containerId: 'test-list', id: 'reminder-1', due: null, completed: false },
    });
    assert.equal(result.state, 'succeeded');
    assert.deepEqual(f.patches, [{ kind: 'reminders.patch', containerId: 'test-list', id: 'reminder-1', due: null, completed: false }]);
  } finally { f.store.close(); }
});

test('patch is denied without an update grant', async () => {
  const f = fixture(['read']);
  try {
    await assert.rejects(f.operations.submit(f.token, {
      idempotencyKey: 'denied-key',
      change: { kind: 'reminders.patch', containerId: 'test-list', id: 'reminder-1', title: 'new title' },
    }), { code: 'permission_denied' });
    assert.equal(f.patches.length, 0);
  } finally { f.store.close(); }
});
