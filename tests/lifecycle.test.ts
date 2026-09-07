import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { health, issueManagementUrl, managementUrl, setup, startService, status, stopService } from '../src/transports/local/lifecycle.js';
import { acquireServiceLock, releaseServiceLock, statePaths } from '../src/transports/local/paths.js';

const dir = mkdtempSync(join(tmpdir(), 'apple-connector-lifecycle-'));
process.env.APPLE_CONNECTOR_STATE_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

test('status reports stopped before setup', () => {
  const s = status();
  assert.equal(s.running, false);
  assert.equal(s.adminTokenFileExists, false);
  assert.ok(s.paths.dir.startsWith(dir));
});

test('health reports a stopped service without trusting a PID file', async () => {
  assert.deepEqual(await health(), { healthy: false, reason: 'Service is not running.' });
});

test('setup initialises the state directory, admin session and database', () => {
  const result = setup();
  assert.equal(result.paths.dir, dir);
  assert.equal(result.adminTokenCreated, true);
  assert.ok((result.adminToken?.length ?? 0) >= 32);
  const s = status();
  assert.equal(s.running, false);
  assert.equal(s.adminTokenFileExists, true);
  assert.ok((s.dbBytes ?? 0) > 0);
  const repeated = setup();
  assert.equal(repeated.adminTokenCreated, false);
  assert.equal(repeated.adminToken, undefined);
});

test('service lock atomically excludes a second owner and recovers a stale lock', () => {
  const paths = statePaths();
  acquireServiceLock(paths);
  assert.equal(existsSync(paths.serviceLock), true);
  assert.throws(() => acquireServiceLock(paths), { code: 'conflict' });
  releaseServiceLock(paths);
  writeFileSync(paths.serviceLock, 'not-a-pid\n', { mode: 0o600 });
  acquireServiceLock(paths);
  releaseServiceLock(paths);
  assert.equal(existsSync(paths.serviceLock), false);
});

test('start spawns the detached service, then stop shuts it down and removes the socket', async () => {
  await startService();
  const running = status();
  assert.equal(running.running, true);
  assert.ok(running.pid !== null && Number.isInteger(running.pid));
  assert.match(running.managementAddress ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(await health(), { healthy: true });
  assert.match(managementUrl(), /^http:\/\/127\.0\.0\.1:\d+\/\?bootstrap=/);
  const replacement = await issueManagementUrl();
  assert.match(replacement, /^http:\/\/127\.0\.0\.1:\d+\/\?bootstrap=/);
  const reused = await startService();
  assert.equal(reused.started, false);
  await stopService();
  const stopped = status();
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
  assert.throws(() => managementUrl(), { code: 'service_unavailable' });
});
