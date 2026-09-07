import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runReminderM1Diagnostic } from '../src/application/reminder-m1-diagnostic.js';
import type { DiagnosticRunner, ReminderM1Event } from '../src/application/reminder-m1-diagnostic.js';
import type { ScriptOperation } from '../src/jxa/protocol.js';

function result(operation: ScriptOperation): unknown {
  if (operation === 'diagnostics.remindersM1Verify') return { verified: true };
  if (operation === 'diagnostics.remindersDeleteM1Probe') return { status: 'removed_verified', stableId: 'native-1' };
  return { stableId: 'native-1' };
}

test('M1 diagnostic records bounded phases and always performs verified cleanup', async () => {
  const calls: ScriptOperation[] = [];
  const events: ReminderM1Event[] = [];
  const runner: DiagnosticRunner = { run: async (operation) => { calls.push(operation); return result(operation); } };
  const completed = await runReminderM1Diagnostic(runner, 'list-1', (event) => events.push(event), () => 10,
    '00000000-0000-4000-8000-000000000001');
  assert.equal(completed.cleanup.status, 'removed_verified');
  assert.deepEqual(calls, ['diagnostics.remindersM1Create', 'diagnostics.remindersM1UpdateTitle',
    'diagnostics.remindersM1UpdateBody', 'diagnostics.remindersM1UpdateDue', 'diagnostics.remindersM1Complete',
    'diagnostics.remindersM1Verify', 'diagnostics.remindersDeleteM1Probe']);
  assert.equal(events.filter((event) => event.status === 'started').length, 7);
  assert.equal(events.filter((event) => event.status === 'succeeded').length, 7);
  assert.equal(events.find((event) => event.stage === 'create' && event.status === 'succeeded')?.stableId, 'native-1');
});

test('M1 diagnostic never replays a failed write and cleans up by retained stable ID', async () => {
  const calls: Array<{ operation: ScriptOperation; payload: Record<string, unknown> | undefined }> = [];
  const runner: DiagnosticRunner = { run: async (operation, payload) => {
    calls.push({ operation, payload });
    if (operation === 'diagnostics.remindersM1UpdateBody') throw new Error('timeout');
    return result(operation);
  } };
  await assert.rejects(runReminderM1Diagnostic(runner, 'list-1'));
  assert.equal(calls.filter((call) => call.operation === 'diagnostics.remindersM1UpdateBody').length, 1);
  assert.equal(calls.at(-1)?.operation, 'diagnostics.remindersDeleteM1Probe');
  assert.equal(calls.at(-1)?.payload?.nativeId, 'native-1');
});

test('M1 diagnostic reports unknown outcome when cleanup cannot be verified', async () => {
  const runner: DiagnosticRunner = { run: async (operation) => operation === 'diagnostics.remindersDeleteM1Probe'
    ? { status: 'outcome_unknown', stableId: 'native-1' } : result(operation) };
  await assert.rejects(runReminderM1Diagnostic(runner, 'list-1'), { code: 'outcome_unknown' });
});
