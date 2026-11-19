import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { defaultStateDir, legacyStateDir, migrateStateDirectory, migrateStateDirectoryWithStop } from '../src/transports/local/paths.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));

function fixture(): { root: string; from: string; to: string } {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-migration-'));
  return { root, from: join(root, 'apple-connector'), to: join(root, '.apple-connector') };
}

function createLegacy(from: string): void {
  mkdirSync(join(from, 'profiles'), { recursive: true, mode: 0o700 });
  chmodSync(from, 0o700);
  writeFileSync(join(from, 'db.sqlite3'), 'database', { mode: 0o600 });
  writeFileSync(join(from, 'admin-token'), 'admin-token\n', { mode: 0o600 });
  writeFileSync(join(from, 'profiles', 'client.token'), 'client-token\n', { mode: 0o600 });
  writeFileSync(join(from, 'agent.token'), 'legacy-agent-token\n', { mode: 0o600 });
}

test('default state directory is the dot directory and the legacy path remains recognizable', () => {
  assert.ok(defaultStateDir().endsWith('/.apple-connector'));
  assert.ok(legacyStateDir().endsWith('/apple-connector'));
  assert.notEqual(defaultStateDir(), legacyStateDir());
});

test('CLI migrate-state reports the move through the JSON envelope', () => {
  const root = mkdtempSync(join(tmpdir(), 'apple-connector-migrate-cli-'));
  try {
    const from = join(root, 'apple-connector');
    createLegacy(from);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: root };
    delete env.APPLE_CONNECTOR_STATE_DIR;
    const result = spawnSync(process.execPath, [cli, 'migrate-state', '--json'], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { ok: boolean; data: { migrated: boolean; from: string; to: string } };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.migrated, true);
    assert.equal(payload.data.from, from);
    assert.equal(payload.data.to, join(root, '.apple-connector'));
    assert.equal(existsSync(join(root, '.apple-connector', 'db.sqlite3')), true);
    assert.equal(existsSync(from), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migration moves every historical file and preserves permissions', () => {
  const f = fixture();
  try {
    createLegacy(f.from);
    const result = migrateStateDirectory(f.from, f.to);
    assert.equal(result.migrated, true);
    assert.equal(existsSync(f.from), false);
    assert.equal(readFileSync(join(f.to, 'db.sqlite3'), 'utf8'), 'database');
    assert.equal(readFileSync(join(f.to, 'admin-token'), 'utf8'), 'admin-token\n');
    assert.equal(readFileSync(join(f.to, 'agent.token'), 'utf8'), 'legacy-agent-token\n');
    assert.equal(readFileSync(join(f.to, 'profiles', 'client.token'), 'utf8'), 'client-token\n');
    assert.equal(statSync(f.to).mode & 0o777, 0o700);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('an empty new directory is replaced, but a non-empty one is never merged', () => {
  const f = fixture();
  try {
    createLegacy(f.from);
    mkdirSync(f.to);
    assert.equal(migrateStateDirectory(f.from, f.to).migrated, true);
    assert.equal(existsSync(join(f.to, 'db.sqlite3')), true);

    const conflict = fixture();
    try {
      createLegacy(conflict.from);
      mkdirSync(conflict.to);
      writeFileSync(join(conflict.to, 'keep.txt'), 'keep');
      assert.throws(() => migrateStateDirectory(conflict.from, conflict.to), { code: 'conflict' });
      assert.equal(existsSync(join(conflict.from, 'db.sqlite3')), true);
      assert.equal(readFileSync(join(conflict.to, 'keep.txt'), 'utf8'), 'keep');
    } finally { rmSync(conflict.root, { recursive: true, force: true }); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('migration is a no-op without a legacy directory and refuses a live legacy service', () => {
  const missing = fixture();
  try {
    assert.equal(migrateStateDirectory(missing.from, missing.to).migrated, false);
  } finally { rmSync(missing.root, { recursive: true, force: true }); }

  const live = fixture();
  try {
    createLegacy(live.from);
    writeFileSync(join(live.from, 'service.pid'), `${process.pid}\n`, { mode: 0o600 });
    assert.throws(() => migrateStateDirectory(live.from, live.to), { code: 'service_unavailable' });
    assert.equal(existsSync(join(live.from, 'db.sqlite3')), true);
  } finally { rmSync(live.root, { recursive: true, force: true }); }
});

test('explicit migration stops a live legacy service before moving the directory', async () => {
  const f = fixture();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    createLegacy(f.from);
    writeFileSync(join(f.from, 'service.pid'), `${child.pid}\n`, { mode: 0o600 });
    writeFileSync(join(f.from, 'service.sock'), '', { mode: 0o600 });
    const result = await migrateStateDirectoryWithStop(f.from, f.to);
    assert.equal(result.migrated, true);
    assert.equal(result.stoppedService, true);
    assert.equal(existsSync(f.from), false);
    assert.equal(existsSync(join(f.to, 'db.sqlite3')), true);
  } finally {
    child.kill('SIGKILL');
    rmSync(f.root, { recursive: true, force: true });
  }
});
