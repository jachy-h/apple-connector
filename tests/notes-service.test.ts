import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appVersion } from '../src/application/version.js';
import { ReminderOperations } from '../src/operations/reminders.js';
import { Store } from '../src/storage/database.js';
import { ServiceFacade } from '../src/transports/local/handlers.js';
import { m0GateWriter } from '../src/transports/local/service.js';
import { JxaRunner } from '../src/jxa/runner.js';
import { JxaReminderReader } from '../src/providers/reminders/jxa-reader.js';
import { JxaCalendarReader } from '../src/providers/calendar/jxa-reader.js';

test('service rejects new Notes grants and plans in v0.7.0', async () => {
  const store = new Store(':memory:');
  const now = Date.now();
  try {
    assert.throws(() => store.createClient({ name: 'Notes client', grants: [{ provider: 'notes', containerIds: ['Agents'], actions: ['read'], approval: 'automatic', expiresAt: now + 3600_000 }] }), /temporarily unavailable/);
    const { token } = store.createClient({ name: 'Reminders client', grants: [{ provider: 'reminders', containerIds: ['Agents'], actions: ['read'], approval: 'automatic', expiresAt: now + 3600_000 }] });
    const facade = new ServiceFacade(store, new ReminderOperations(store, m0GateWriter, () => now), 'admin', appVersion);
    const prepared = await facade.agent('operations.prepare', {
      idempotencyKey: 'notes-service', change: { kind: 'notes.create', containerId: 'Agents', title: 'M0 gated note', body: 'private' },
    }, token);
    assert.equal(prepared.ok, false);
    if (!prepared.ok) assert.equal(prepared.error.code, 'unsupported_operation');
    assert.equal(store.listOperations().length, 0);
  } finally { store.close(); }
});

test('service derives Reminders enumeration and pages only from read grants', async () => {
  const store = new Store(':memory:');
  try {
    const { token } = store.createClient({ name: 'Reminders reader', grants: [{ provider: 'reminders', containerIds: ['allowed-list'], actions: ['read'], expiresAt: Date.now() + 3600_000 }] });
    const reader = new JxaReminderReader(new JxaRunner(async (request) => {
      const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
      const result = envelope.operation === 'reminders.listLists' ? [{ id: 'allowed-list', name: 'Agents' }]
        : { items: [{ id: 'r', listId: 'allowed-list', title: 'T', body: '', completed: false, due: null }], nextOffset: null };
      return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
    }));
    const facade = new ServiceFacade(store, new ReminderOperations(store, m0GateWriter), 'admin', appVersion, undefined, undefined, reader);
    const lists = await facade.agent('reminders.list_lists', {}, token);
    assert.equal(lists.ok, true);
    if (lists.ok) assert.deepEqual(lists.result, [{ id: 'allowed-list', name: 'Agents' }]);
    const page = await facade.agent('reminders.list', { listId: 'allowed-list' }, token);
    assert.equal(page.ok, true);
    const denied = await facade.agent('reminders.list', { listId: 'other' }, token);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'permission_denied');
  } finally { store.close(); }
});

test('service scopes Calendar reads to unique granted names and applies busy projection', async () => {
  const store = new Store(':memory:');
  try {
    const { token } = store.createClient({ name: 'Calendar reader', grants: [{ provider: 'calendar', containerIds: ['Agents'], actions: ['read'], fields: 'busy', expiresAt: Date.now() + 3600_000 }] });
    const reader = new JxaCalendarReader(new JxaRunner(async (request) => {
      const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
      const result = envelope.operation === 'calendar.listCalendars' ? [{ id: 'Agents', name: 'Agents' }] : { items: [{ id: 'event-1', calendarId: 'Agents', title: 'Private', start: '2028-02-29T09:00:00+08:00', end: '2028-02-29T10:00:00+08:00', allDay: false, location: 'Private', notes: 'Private' }], nextOffset: null };
      return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
    }));
    const facade = new ServiceFacade(store, new ReminderOperations(store, m0GateWriter), 'admin', appVersion, undefined, undefined, undefined, reader);
    const calendars = await facade.agent('calendar.list_calendars', {}, token);
    assert.equal(calendars.ok, true);
    const page = await facade.agent('calendar.list_events', { calendarId: 'Agents', from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00' }, token);
    assert.equal(page.ok, true);
    if (page.ok) assert.deepEqual((page.result as { items: unknown[] }).items, [{ start: '2028-02-29T09:00:00+08:00', end: '2028-02-29T10:00:00+08:00', allDay: false }]);
    const denied = await facade.agent('calendar.list_events', { calendarId: 'other', from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00' }, token);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'permission_denied');
  } finally { store.close(); }
});

test('legacy Notes grants are retained but legacy requests never call a Notes reader', async () => {
  const store = new Store(':memory:');
  try {
    const { client, token } = store.createClient({ name: 'Reader', grants: [{ provider: 'reminders', containerIds: ['allowed'], actions: ['read'], expiresAt: Date.now() + 3600_000 }] });
    store.db.prepare('UPDATE clients SET grants=? WHERE id=?').run(JSON.stringify([{ provider: 'notes', containerIds: ['allowed'], actions: ['read'], fields: 'full', approval: 'automatic', expiresAt: Date.now() + 3600_000 }]), client.id);
    const facade = new ServiceFacade(store, new ReminderOperations(store, m0GateWriter), 'admin', appVersion);
    const listed = await facade.agent('notes.list_folders', {}, token);
    assert.equal(listed.ok, false);
    if (!listed.ok) assert.equal(listed.error.code, 'unsupported_operation');
    const searched = await facade.agent('notes.search', { folderId: 'allowed', query: 'x' }, token);
    assert.equal(searched.ok, false);
    if (!searched.ok) assert.equal(searched.error.code, 'unsupported_operation');
  } finally { store.close(); }
});
