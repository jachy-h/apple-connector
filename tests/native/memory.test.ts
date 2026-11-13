import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventKitHelperClient } from '../../src/native/helper-client.js';

const darwin = process.platform === 'darwin';

type Receipt = { id: string; containerId: string };

function helperPid(): number {
  const children = execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).map(Number);
  for (const pid of children) {
    try {
      if (execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).includes('apple-connector-helper')) return pid;
    } catch { /* The child may have exited between enumeration and inspection. */ }
  }
  throw new Error('The native EventKit helper child process could not be found.');
}

function footprintMb(pid: number): number {
  const output = execFileSync('footprint', [String(pid)], { encoding: 'utf8' });
  const match = output.match(/Footprint:\s+([\d.]+)\s+(bytes?|KB|MB|GB)/i);
  if (!match) throw new Error(`Could not parse footprint output for PID ${pid}.`);
  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (unit.startsWith('g')) return value * 1024;
  if (unit.startsWith('m')) return value;
  if (unit.startsWith('k')) return value / 1024;
  return value / (1024 * 1024);
}

test('native helper keeps a flat footprint across 5,000 hello requests', { skip: !darwin }, async () => {
  const helper = new EventKitHelperClient();
  try {
    for (let index = 0; index < 20; index++) await helper.call('hello', {});
    const pid = helperPid();
    const before = footprintMb(pid);
    for (let index = 0; index < 5_000; index++) await helper.call('hello', {});
    const after = footprintMb(pid);
    assert.ok(after - before < 32, `Helper footprint grew by ${(after - before).toFixed(1)} MB across 5,000 hello requests.`);
  } finally {
    await helper.close();
  }
});

test('native helper keeps a flat footprint across reminders.list iterations', {
  skip: !darwin || !process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
}, async () => {
  const listId = process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID!;
  const helper = new EventKitHelperClient();
  const probe = randomUUID();
  const created: string[] = [];
  const cleanupErrors: string[] = [];
  try {
    for (let index = 0; index < 60; index++) {
      const receipt = await helper.call('reminders.createVerified', {
        change: { containerId: listId, title: `Apple Connector Memory Probe ${probe} ${index}`, body: '', completed: false },
      }, 60_000) as Receipt;
      created.push(receipt.id);
    }
    for (let index = 0; index < 20; index++) await helper.call('reminders.list', { listId, offset: 0, limit: 100 });
    const pid = helperPid();
    const before = footprintMb(pid);
    for (let index = 0; index < 250; index++) await helper.call('reminders.list', { listId, offset: 0, limit: 100 });
    const after = footprintMb(pid);
    assert.ok(after - before < 64, `Helper footprint grew by ${(after - before).toFixed(1)} MB across 250 reminders.list requests.`);
  } finally {
    for (const id of created) {
      try {
        await helper.call('reminders.deleteVerified', { change: { containerId: listId, id } }, 60_000);
      } catch (error) {
        cleanupErrors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await helper.close();
    if (cleanupErrors.length > 0) throw new Error(`Memory probe cleanup failed: ${cleanupErrors.join('; ')}`);
  }
});
