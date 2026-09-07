import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../dist/src/storage/database.js';
import { WebWrites } from '../dist/src/application/web-writes.js';
import { EventKitHelperClient } from '../dist/src/native/helper-client.js';
import { EventKitReminderProvider } from '../dist/src/providers/reminders/eventkit.js';

const listId = process.argv[2];
const samples = Number.parseInt(process.argv[3] ?? '4', 10);
if (!listId || !Number.isInteger(samples) || samples < 1 || samples > 20) {
  console.error('Usage: node scripts/reminders-stack-benchmark.mjs <dedicated-list-id> [samples=4]');
  process.exit(2);
}

const stateDir = mkdtempSync(join(tmpdir(), 'apple-connector-stack-benchmark-'));
const store = new Store(join(stateDir, 'db.sqlite3'));
const helper = new EventKitHelperClient();
const provider = new EventKitReminderProvider(helper);
const writes = new WebWrites(store, provider);
const results = [];

try {
  for (let index = 0; index < samples; index += 1) {
    const probeId = randomUUID();
    const startedAt = performance.now();
    const operation = await writes.submitReminders(probeId, {
      kind: 'reminders.create',
      containerId: listId,
      title: `Apple Connector AB Probe ${probeId}`,
      body: 'Temporary stack performance probe; safe to remove.',
    });
    const completedAt = performance.now();
    if (operation.state !== 'succeeded' || !operation.result?.id) throw new Error(`Create did not succeed: ${JSON.stringify(operation)}`);
    const cleanupStartedAt = performance.now();
    const cleanup = await helper.call('diagnostics.remindersABDelete', { containerId: listId, nativeId: operation.result.id, probeId }, 90_000);
    results.push({
      sample: index + 1,
      temperature: index === 0 ? 'cold' : 'hot',
      operationState: operation.state,
      createElapsedMs: Math.round((completedAt - startedAt) * 1000) / 1000,
      cleanupElapsedMs: Math.round((performance.now() - cleanupStartedAt) * 1000) / 1000,
      cleanupVerified: cleanup.removed === true,
    });
  }
  console.log(JSON.stringify({ provider: 'typescript-webwrites-eventkit-helper', listId, results }, null, 2));
} finally {
  await helper.close();
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
}
