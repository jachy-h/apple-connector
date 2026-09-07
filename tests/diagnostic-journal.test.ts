import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadDiagnosticJournal, recoverJournaledReminderM1Diagnostic, runJournaledReminderM1Diagnostic } from '../src/application/diagnostic-journal.js';
import type { DiagnosticRunner } from '../src/application/reminder-m1-diagnostic.js';
import type { ScriptOperation } from '../src/jxa/protocol.js';

function response(operation: ScriptOperation) {
  if (operation === 'diagnostics.remindersM1Verify') return { verified: true };
  if (operation === 'diagnostics.remindersDeleteM1Probe') return { status: 'removed_verified', stableId: 'native-1' };
  return { stableId: 'native-1' };
}

test('M1 journal is private, durable before mutation, and supports exact recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-journal-'));
  try {
    const calls: Array<{ operation: ScriptOperation; payload?: Record<string, unknown> }> = [];
    const runner: DiagnosticRunner = { run: async (operation, payload) => { calls.push({ operation, ...(payload ? { payload } : {}) }); return response(operation); } };
    const completed = await runJournaledReminderM1Diagnostic(runner, dir, 'list-1', () => 100);
    assert.equal(statSync(completed.journalPath).mode & 0o777, 0o600);
    const journal = loadDiagnosticJournal(dir, completed.probeId);
    assert.equal(journal.recoveryStatus, 'removed_verified');
    assert.equal(journal.events[0]?.stage, 'create');
    assert.equal(journal.events[0]?.status, 'started');
    assert.equal(JSON.stringify(journal).includes('Connector-generated'), false);
    const recovered = await recoverJournaledReminderM1Diagnostic(runner, dir, completed.probeId, () => 200);
    assert.equal(recovered.status, 'removed_verified');
    const last = calls.at(-1)!;
    assert.equal(last.operation, 'diagnostics.remindersDeleteM1Probe');
    assert.equal(last.payload?.containerId, 'list-1');
    assert.equal(last.payload?.probeId, completed.probeId);
    assert.equal(last.payload?.nativeId, 'native-1');
    assert.doesNotThrow(() => JSON.parse(readFileSync(completed.journalPath, 'utf8')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
