import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventKitHelperClient } from '../../src/native/helper-client.js';

const darwin = process.platform === 'darwin';
const helperPath = resolve('dist/native/apple-connector-helper');

test('helper serves the JSONL protocol over a user-only Unix socket', { skip: !darwin }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-socket-'));
  const socketPath = join(dir, 'helper.sock');
  const child = spawn(helperPath, ['--socket', socketPath], { stdio: ['ignore', 'ignore', 'ignore'] });
  const client = new EventKitHelperClient({ socketPath });
  try {
    const hello = await client.call('hello', {}) as { protocolVersion?: unknown; helperVersion?: unknown };
    assert.equal(hello.protocolVersion, 2);
    assert.equal(typeof hello.helperVersion, 'string');
    const status = await client.call('permissions.status', {}) as { calendar?: unknown; reminders?: unknown };
    assert.equal(typeof status.calendar, 'string');
    assert.equal(typeof status.reminders, 'string');
    assert.equal(existsSync(join(dir, 'helper.pid')), true);
    assert.equal(readFileSync(join(dir, 'helper.pid'), 'utf8').trim(), String(child.pid));
    assert.match(readFileSync(join(dir, 'helper.log'), 'utf8'), /listening on/);
  } finally {
    await client.close();
    child.kill('SIGTERM');
    await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
    rmSync(dir, { recursive: true, force: true });
  }
});
