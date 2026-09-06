import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JxaRunner } from '../src/jxa/runner.js';
import { JxaNoteReader } from '../src/providers/notes/jxa-reader.js';

test('Notes reader sends explicit folder scopes and validates bounded native output', async () => {
  const requests: Array<{ operation: string; payload: Record<string, unknown> }> = [];
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string; payload: Record<string, unknown> };
    requests.push({ operation: envelope.operation, payload: envelope.payload });
    const result = envelope.operation === 'notes.listFolders' ? [{ id: 'f', name: 'Agents' }]
      : envelope.operation === 'notes.get' ? { id: 'n', folderId: 'f', title: 'T', snippet: 'S', body: 'Body' }
      : [{ id: 'n', folderId: 'f', title: 'T', snippet: 'S' }];
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
  });
  const reader = new JxaNoteReader(runner);
  assert.deepEqual(await reader.listFolders(['f']), [{ id: 'f', name: 'Agents' }]);
  assert.equal((await reader.get('f', 'n')).body, 'Body');
  assert.deepEqual(await reader.search('f', 'title', 3), [{ id: 'n', folderId: 'f', title: 'T', snippet: 'S' }]);
  assert.deepEqual(requests, [
    { operation: 'notes.listFolders', payload: { containerIds: ['f'] } },
    { operation: 'notes.get', payload: { folderId: 'f', id: 'n' } },
    { operation: 'notes.search', payload: { folderId: 'f', query: 'title', limit: 3 } },
  ]);
});

test('Notes reader rejects malformed native data before it reaches callers', async () => {
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result: [{ id: 2 }] });
  });
  await assert.rejects(new JxaNoteReader(runner).listFolders(['f']), { code: 'protocol_error' });
});
