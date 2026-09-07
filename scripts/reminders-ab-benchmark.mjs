import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const listId = process.argv[2];
const samples = Number.parseInt(process.argv[3] ?? '4', 10);
if (!listId || !Number.isInteger(samples) || samples < 1 || samples > 20) {
  console.error('Usage: node scripts/reminders-ab-benchmark.mjs <dedicated-list-id> [samples=4]');
  process.exit(2);
}

const executable = resolve('dist/native/apple-connector-helper');
const childStartedAt = performance.now();
const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
lines.on('line', (line) => {
  let response;
  try { response = JSON.parse(line); } catch { return; }
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  clearTimeout(entry.timer);
  if (response.ok) entry.resolve(response.result);
  else entry.reject(new Error(`${response.error?.code ?? 'unknown'}: ${response.error?.message ?? 'helper request failed'}`));
});

function call(action, payload, timeoutMs = 90_000) {
  const id = randomUUID();
  const startedAt = performance.now();
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${action} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { timer, resolve: (result) => resolveCall({ result, elapsedMs: performance.now() - startedAt }), reject });
    child.stdin.write(`${JSON.stringify({ version: 1, id, action, payload })}\n`);
  });
}

const results = [];
try {
  const hello = await call('hello', {}, 5_000);
  const helloAt = performance.now();
  for (let index = 0; index < samples; index += 1) {
    const probeId = randomUUID();
    const title = `Apple Connector AB Probe ${probeId}`;
    const created = await call('reminders.createVerified', { change: { kind: 'reminders.create', containerId: listId, title, body: 'Temporary A/B performance probe; safe to remove.' } });
    const cleaned = await call('diagnostics.remindersABDelete', { containerId: listId, nativeId: created.result.id, probeId });
    results.push({
      sample: index + 1,
      temperature: index === 0 ? 'cold' : 'hot',
      createElapsedMs: Math.round(created.elapsedMs * 1000) / 1000,
      nativeTimings: created.result.timings,
      cleanupElapsedMs: Math.round(cleaned.elapsedMs * 1000) / 1000,
      cleanupVerified: cleaned.result.removed === true,
    });
  }
  console.log(JSON.stringify({
    provider: 'eventkit-helper',
    listId,
    processToHelloMs: Math.round((helloAt - childStartedAt) * 1000) / 1000,
    helloElapsedMs: Math.round(hello.elapsedMs * 1000) / 1000,
    results,
  }, null, 2));
} finally {
  child.stdin.end();
  setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
}
