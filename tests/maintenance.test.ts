import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runMaintenance } from '../src/application/maintenance.js';
import { appendServiceLog, MAX_LOG_AGE_MS, MAX_LOG_BYTES } from '../src/transports/local/logging.js';
import { Store } from '../src/storage/database.js';

test('service maintenance prunes expired plans and old audit rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-maintenance-'));
  const path = join(root, 'db.sqlite3');
  const store = new Store(path);
  const now = Date.now();
  try {
    const { client } = store.createClient({ name: 'Maintenance', grants: [] });
    const oldAt = now - 31 * 86_400_000;
    store.audit({ at: oldAt, clientId: client.id, action: 'read', outcome: 'allowed', count: 0 });
    runMaintenance(store, path, now);
    assert.equal(store.auditEvents().some((event) => event.at === oldAt), false);
    assert.ok(statSync(path).size > 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('service logger rotates at 5 MiB, keeps three files, and removes stale archives', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-logging-'));
  const path = join(root, 'service.log');
  const now = Date.now();
  try {
    for (const suffix of ['', '.1', '.2']) {
      const fd = openSync(`${path}${suffix}`, 'w', 0o600);
      writeSync(fd, Buffer.alloc(MAX_LOG_BYTES, 120));
      closeSync(fd);
    }
    appendServiceLog(path, 'rotated', now);
    assert.ok(statSync(path).size < MAX_LOG_BYTES);
    assert.equal(statSync(`${path}.1`).size, MAX_LOG_BYTES);
    assert.equal(statSync(`${path}.2`).size, MAX_LOG_BYTES);

    const stale = new Date(now - MAX_LOG_AGE_MS - 1);
    utimesSync(`${path}.2`, stale, stale);
    appendServiceLog(path, 'prune stale', now);
    assert.throws(() => statSync(`${path}.2`), { code: 'ENOENT' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
