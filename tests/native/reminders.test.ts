import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { EventKitHelperClient } from '../../src/native/helper-client.js';

const darwin = process.platform === 'darwin';
const listId = process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID;

type Receipt = { id: string; containerId: string };
type Row = { id: string; listId: string; title: string; body: string; completed: boolean; due: unknown; recurring: boolean };
type Page = { items: Row[]; nextOffset: number | null };

async function listAll(helper: EventKitHelperClient, target: string): Promise<Row[]> {
  const items: Row[] = [];
  let offset = 0;
  for (;;) {
    const page = await helper.call('reminders.list', { listId: target, offset, limit: 100 }, 60_000) as Page;
    items.push(...page.items);
    if (page.nextOffset === null) return items;
    offset = page.nextOffset;
  }
}

function row(rows: Row[], id: string): Row {
  const found = rows.find((item) => item.id === id);
  assert.ok(found, `Reminder ${id} is missing from the list`);
  return found;
}

test('native reminder due round-trip and patch preserve identity and fields', {
  skip: !darwin || !listId,
}, async () => {
  const helper = new EventKitHelperClient();
  const target = listId!;
  const title = `Apple Connector v0.10.0 Native Probe ${randomUUID()}`;
  const created: string[] = [];
  try {
    const receipt = await helper.call('reminders.createVerified', {
      change: { containerId: target, title, body: 'body-preserved', due: { kind: 'date', date: '2032-02-29' } },
    }, 60_000) as Receipt;
    created.push(receipt.id);
    let current = row(await listAll(helper, target), receipt.id);
    assert.deepEqual(current.due, { kind: 'date', date: '2032-02-29' });
    assert.equal(current.recurring, false);

    const patched = await helper.call('reminders.patchVerified', {
      change: { kind: 'reminders.patch', containerId: target, id: receipt.id, due: { kind: 'instant', at: '2032-03-01T17:30:00+08:00', timeZone: 'Asia/Shanghai' } },
    }, 60_000) as Receipt;
    assert.equal(patched.id, receipt.id);
    assert.equal(patched.containerId, receipt.containerId);
    current = row(await listAll(helper, target), receipt.id);
    assert.deepEqual(current.due, { kind: 'instant', at: '2032-03-01T17:30:00+08:00', timeZone: 'Asia/Shanghai' });
    assert.equal(current.title, title);
    assert.equal(current.body, 'body-preserved');
    assert.equal(current.completed, false);

    await helper.call('reminders.patchVerified', {
      change: { kind: 'reminders.patch', containerId: target, id: receipt.id, due: { kind: 'floating', date: '2032-03-02', time: '18:45' } },
    }, 60_000);
    current = row(await listAll(helper, target), receipt.id);
    assert.deepEqual(current.due, { kind: 'floating', date: '2032-03-02', time: '18:45:00' });

    await helper.call('reminders.patchVerified', {
      change: { kind: 'reminders.patch', containerId: target, id: receipt.id, due: null, completed: true },
    }, 60_000);
    current = row(await listAll(helper, target), receipt.id);
    assert.equal(current.due, null);
    assert.equal(current.completed, true);

    await helper.call('reminders.patchVerified', {
      change: { kind: 'reminders.patch', containerId: target, id: receipt.id, completed: false },
    }, 60_000);
    current = row(await listAll(helper, target), receipt.id);
    assert.equal(current.completed, false);

    await helper.call('reminders.completeVerified', { change: { kind: 'reminders.complete', containerId: target, id: receipt.id } }, 60_000);
    current = row(await listAll(helper, target), receipt.id);
    assert.equal(current.completed, true);

    await helper.call('reminders.deleteVerified', { change: { kind: 'reminders.delete', containerId: target, id: receipt.id } }, 60_000);
    assert.equal((await listAll(helper, target)).some((item) => item.id === receipt.id), false);
  } finally {
    for (const id of created) {
      try { await helper.call('reminders.deleteVerified', { change: { kind: 'reminders.delete', containerId: target, id } }, 60_000); } catch { /* already deleted or cleaned below */ }
    }
    await helper.close();
  }
});

test('native recurring reminders are listed and write operations are rejected', {
  skip: !darwin || !listId,
}, async () => {
  const helper = new EventKitHelperClient();
  const target = listId!;
  const title = `Apple Connector Recurring Probe ${randomUUID()}`;
  let id: string | undefined;
  try {
    const probe = await helper.call('diagnostics.recurrenceProbe', { containerId: target, title }, 60_000) as Receipt;
    id = probe.id;
    const current = row(await listAll(helper, target), id);
    assert.equal(current.recurring, true);
    assert.deepEqual(current.due, { kind: 'date', date: '2032-09-01' });
    await assert.rejects(helper.call('reminders.patchVerified', {
      change: { kind: 'reminders.patch', containerId: target, id, title: `${title} changed` },
    }, 60_000), { code: 'unsupported_operation' });
    await assert.rejects(helper.call('reminders.completeVerified', {
      change: { kind: 'reminders.complete', containerId: target, id },
    }, 60_000), { code: 'unsupported_operation' });
    await assert.rejects(helper.call('reminders.deleteVerified', {
      change: { kind: 'reminders.delete', containerId: target, id },
    }, 60_000), { code: 'unsupported_operation' });
  } finally {
    if (id) {
      try { await helper.call('diagnostics.recurrenceProbeDelete', { containerId: target, id }, 60_000); } catch { /* cleanup failure is surfaced by the next assertion */ }
      assert.equal((await listAll(helper, target)).some((item) => item.id === id), false);
    }
    await helper.close();
  }
});
