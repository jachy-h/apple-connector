import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JxaRunner } from '../src/jxa/runner.js';
import { JxaNoteWriter } from '../src/providers/notes/jxa-writer.js';
import type { CreateNote } from '../src/providers/notes/types.js';

const change: CreateNote = { kind: 'notes.create', containerId: 'Agents', title: 'Title', body: '<untrusted>\ntext' };

test('JXA Notes writer uses only fixed operations and validates its receipt', async () => {
  const operations: string[] = [];
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
    operations.push(envelope.operation);
    const result = envelope.operation === 'notes.create' ? { id: 'note-id', containerId: 'Agents' }
      : envelope.operation === 'notes.verify' ? { verified: true } : {};
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
  });
  const writer = new JxaNoteWriter(runner);
  await writer.preflight(change);
  const receipt = await writer.create(change);
  assert.deepEqual(receipt, { id: 'note-id', containerId: 'Agents' });
  assert.equal(await writer.verify(receipt, change), true);
  assert.deepEqual(operations, ['notes.preflight', 'notes.create', 'notes.verify']);
});

test('JXA Notes writer rejects an invalid native receipt', async () => {
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result: { id: 3 } });
  });
  await assert.rejects(new JxaNoteWriter(runner).create(change), { code: 'protocol_error' });
});
