import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HttpServiceClient } from '../dist/src/transports/local/client.js';
import { readAdminToken, statePaths } from '../dist/src/transports/local/paths.js';
import { EventKitHelperClient } from '../dist/src/native/helper-client.js';

const listId = process.argv[2];
const samples = Number.parseInt(process.argv[3] ?? '4', 10);
if (!listId || !Number.isInteger(samples) || samples < 1 || samples > 20) {
  console.error('Usage: node scripts/reminders-service-benchmark.mjs <dedicated-list-id> [samples=4]');
  process.exit(2);
}

const paths = statePaths();
const client = new HttpServiceClient(paths.socket);
const token = readAdminToken(paths);
const cleanupHelper = new EventKitHelperClient();
const results = [];

try {
  for (let index = 0; index < samples; index += 1) {
    const probeId = randomUUID();
    const startedAt = performance.now();
    const operation = await client.request('web.reminders.create', {
      idempotencyKey: probeId,
      change: {
        kind: 'reminders.create',
        containerId: listId,
        title: `Apple Connector AB Probe ${probeId}`,
        body: 'Temporary full-service performance probe; safe to remove.',
      },
    }, token);
    const completedAt = performance.now();
    if (operation.state !== 'succeeded' || !operation.result?.id) throw new Error(`Create did not succeed: ${JSON.stringify(operation)}`);
    const cleanupStartedAt = performance.now();
    const cleanup = await cleanupHelper.call('diagnostics.remindersABDelete', {
      containerId: listId,
      nativeId: operation.result.id,
      probeId,
    }, 90_000);
    results.push({
      sample: index + 1,
      temperature: index === 0 ? 'service-first-call' : 'service-hot',
      operationState: operation.state,
      createElapsedMs: Math.round((completedAt - startedAt) * 1000) / 1000,
      cleanupElapsedMs: Math.round((performance.now() - cleanupStartedAt) * 1000) / 1000,
      cleanupVerified: cleanup.removed === true,
    });
  }
  console.log(JSON.stringify({ provider: 'full-service-rpc-eventkit-helper', listId, results }, null, 2));
} finally {
  await cleanupHelper.close();
}
