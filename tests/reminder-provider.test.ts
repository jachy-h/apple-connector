import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventKitReminderProvider } from '../src/providers/reminders/eventkit.js';
import type { EventKitHelperClient } from '../src/native/helper-client.js';

function helper(responses: Record<string, unknown>) {
  const calls: Array<{ action: string; payload: unknown }> = [];
  const client = {
    call: async (action: string, payload: unknown) => { calls.push({ action, payload }); return responses[action]; },
  } as unknown as EventKitHelperClient;
  return { provider: new EventKitReminderProvider(client), calls };
}

test('reminder list preserves due kinds and recurring state', async () => {
  const { provider } = helper({
    'reminders.list': {
      items: [
        { id: 'r1', listId: 'list', title: 'Date', body: '', completed: false, due: { kind: 'date', date: '2026-11-20' }, recurring: false },
        { id: 'r2', listId: 'list', title: 'Floating', body: '', completed: false, due: { kind: 'floating', date: '2026-11-20', time: '17:00:00' }, recurring: true },
        { id: 'r3', listId: 'list', title: 'Instant', body: '', completed: false, due: { kind: 'instant', at: '2026-11-20T17:00:00+08:00', timeZone: 'Asia/Shanghai' }, recurring: false },
      ],
      nextOffset: null,
    },
  });
  const page = await provider.list('list');
  assert.deepEqual(page.items.map((item) => item.due), [
    { kind: 'date', date: '2026-11-20' },
    { kind: 'floating', date: '2026-11-20', time: '17:00:00' },
    { kind: 'instant', at: '2026-11-20T17:00:00+08:00', timeZone: 'Asia/Shanghai' },
  ]);
  assert.deepEqual(page.items.map((item) => item.recurring), [false, true, false]);
});

test('reminder list rejects the stale string due shape and mismatched list ids', async () => {
  const stale = helper({
    'reminders.list': { items: [{ id: 'r1', listId: 'list', title: 'T', body: '', completed: false, due: '2026-11-20T00:00:00Z', recurring: false }], nextOffset: null },
  });
  await assert.rejects(stale.provider.list('list'), { code: 'protocol_error' });
  const mismatched = helper({
    'reminders.list': { items: [{ id: 'r1', listId: 'other', title: 'T', body: '', completed: false, due: null, recurring: false }], nextOffset: null },
  });
  await assert.rejects(mismatched.provider.list('list'), { code: 'protocol_error' });
});

test('patch sends the exact partial change and validates the receipt', async () => {
  const { provider, calls } = helper({ 'reminders.patchVerified': { id: 'r1', containerId: 'list' } });
  const change = { kind: 'reminders.patch' as const, containerId: 'list', id: 'r1', due: null, completed: false };
  assert.deepEqual(await provider.patch(change), { id: 'r1', containerId: 'list' });
  assert.deepEqual(calls, [{ action: 'reminders.patchVerified', payload: { change } }]);
});
