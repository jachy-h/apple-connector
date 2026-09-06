import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JxaRunner } from '../src/jxa/runner.js';
import { JxaReminderReader } from '../src/providers/reminders/jxa-reader.js';

test('Reminders reader passes explicit list scopes and validates pagination', async () => {
  const calls: string[] = [];
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string; payload: Record<string, unknown> };
    calls.push(JSON.stringify({ operation: envelope.operation, payload: envelope.payload }));
    const result = envelope.operation === 'reminders.listLists' ? [{ id: 'list', name: 'Agents' }]
      : { items: [{ id: 'r', listId: 'list', title: 'Title', body: 'Body', completed: false, due: null }], nextOffset: null };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
  });
  const reader = new JxaReminderReader(runner);
  assert.deepEqual(await reader.listLists(['list']), [{ id: 'list', name: 'Agents' }]);
  assert.deepEqual(await reader.list('list', 2, 3), { items: [{ id: 'r', listId: 'list', title: 'Title', body: 'Body', completed: false, due: null }], nextOffset: null });
  assert.deepEqual(calls, [
    JSON.stringify({ operation: 'reminders.listLists', payload: { containerIds: ['list'] } }),
    JSON.stringify({ operation: 'reminders.list', payload: { listId: 'list', offset: 2, limit: 3 } }),
  ]);
});

test('Reminders reader rejects malformed native pages', async () => {
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result: { items: [{}], nextOffset: 'later' } });
  });
  await assert.rejects(new JxaReminderReader(runner).list('list'), { code: 'protocol_error' });
});
