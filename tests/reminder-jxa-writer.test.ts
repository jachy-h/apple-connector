import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JxaRunner } from '../src/jxa/runner.js';
import { JxaReminderWriter } from '../src/providers/reminders/jxa-writer.js';
import type { CreateReminder } from '../src/providers/reminders/types.js';

const change: CreateReminder = { kind: 'reminders.create', containerId: 'Agents', title: 'Title', body: 'Body' };

test('JXA reminder writer uses only fixed operations and validates its receipt', async () => {
  const seen: string[] = [];
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string; payload: Record<string, unknown> };
    seen.push(envelope.operation);
    let result: unknown = {};
    if (envelope.operation === 'reminders.create') result = { id: 'native-id', containerId: 'Agents' };
    if (envelope.operation === 'reminders.verify') result = { verified: true };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
  });
  const writer = new JxaReminderWriter(runner);
  await writer.preflight(change);
  const receipt = await writer.create(change);
  assert.deepEqual(receipt, { id: 'native-id', containerId: 'Agents' });
  assert.equal(await writer.verify(receipt, change), true);
  assert.deepEqual(seen, ['reminders.preflight', 'reminders.create', 'reminders.verify']);
});

test('JXA reminder writer rejects malformed native receipts', async () => {
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result: {} });
  });
  await assert.rejects(new JxaReminderWriter(runner).create(change), { code: 'protocol_error' });
});
