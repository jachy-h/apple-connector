import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JxaRunner } from '../../src/jxa/runner.js';
import { JxaCalendarReader } from '../../src/providers/calendar/jxa-reader.js';
import { runReminderM1Diagnostic } from '../../src/application/reminder-m1-diagnostic.js';

test('real JXA loads EventKit without requesting permissions', { skip: process.platform !== 'darwin' }, async () => {
  const result = await new JxaRunner().run('diagnostics.probe') as Record<string, unknown>;
  assert.equal(result.eventKitBridge, true);
  assert.equal(result.personalDataRead, false);
  assert.equal(result.permissionsRequested, false);
  assert.equal(typeof result.calendarAuthorization, 'number');
});

test('real JXA preserves JSON text and date-only components in unsaved EventKit objects', { skip: process.platform !== 'darwin' }, async () => {
  const text = 'Probe \"quotes\"\n中文😀 <b>&</b> $(echo nope) `id` Application("Notes")';
  const result = await new JxaRunner().run('diagnostics.roundtrip', { text }) as Record<string, unknown>;
  assert.equal(result.title, text);
  assert.equal(result.notes, text);
  assert.equal(result.eventTitle, text);
  assert.deepEqual(result.due, { year: 2028, month: 2, day: 29, hourUnspecified: true });
  assert.equal(result.allDay, true);
  assert.equal(result.recurring, false);
  assert.equal(result.personalDataRead, false);
  assert.equal(result.permissionsRequested, false);
  assert.equal(result.saved, false);
});

test('M0 probe creates, rereads and removes only its own reminder in the opted-in test list', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.remindersCrud', {
    containerId: process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
  }) as Record<string, unknown>;
  assert.equal(result.containerId, process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID);
  assert.equal(result.createdAndRemoved, true);
});

test('M1 probe updates, completes and removes only its own reminder in the opted-in test list', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
}, async () => {
  const events: string[] = [];
  const result = await runReminderM1Diagnostic(new JxaRunner(), process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID!,
    (event) => events.push(`${event.stage}:${event.status}`));
  assert.match(result.probeId, /^[0-9a-f-]{36}$/);
  assert.ok(result.stableId.length > 0);
  assert.equal(result.cleanup.status, 'removed_verified');
  assert.deepEqual(events.filter((event) => event.endsWith(':succeeded')).map((event) => event.split(':')[0]),
    ['create', 'update_title', 'update_body', 'update_due', 'complete', 'verify', 'cleanup']);
});

test('M1 recovery deletion requires a caller-held probe UUID', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.remindersDeleteM1Probe', {
    containerId: process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
    probeId: randomUUID(),
  }) as Record<string, unknown>;
  assert.equal(result.status, 'not_found');
  assert.equal(result.stableId, null);
});

test('M0 UUID recovery is a verified no-op for a missing probe', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.remindersDeleteM0ProbeByUuid', {
    containerId: process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
    probeId: randomUUID(),
  }) as Record<string, unknown>;
  assert.equal(result.status, 'not_found');
  assert.equal(result.stableId, null);
});

test('EventKit checks only the supplied Reminders list identifier', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.remindersEventKitAccess', {
    containerId: process.env.APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID,
  }) as Record<string, unknown>;
  assert.equal(typeof result.matches, 'number');
  if (result.matches === 1) assert.equal(typeof result.allowsContentModifications, 'boolean');
});


test('M0 probe creates, rereads and removes only its own event in the opted-in test calendar', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.calendarCrud', {
    calendarName: process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME,
  }) as Record<string, unknown>;
  assert.equal(result.calendarName, process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME);
  assert.equal(result.createdAndRemoved, true);
});

test('EventKit probe obtains a stable event identifier in the opted-in test calendar', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_EVENTKIT_CALENDAR_TEST_NAME,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.calendarEventKitCrud', {
    calendarName: process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME,
  }) as Record<string, unknown>;
  assert.equal(typeof result.calendarIdentifier, 'string');
  assert.equal(result.stableEventIdentifier, true);
  assert.equal(result.createdAndRemoved, true);
});

test('EventKit identifies the opted-in test calendar without returning other calendar metadata', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.calendarEventKitAccess', {
    calendarName: process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME,
  }) as Record<string, unknown>;
  // Authorization status alone does not imply this process can enumerate EventKit calendars.
  // The M0 record captures this host's current zero-match result.
  assert.equal(typeof result.matches, 'number');
  if (result.matches === 1) assert.equal(typeof result.calendarIdentifier, 'string');
});

test('Calendar reader queries only the opted-in calendar in a bounded window without printing event content', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME,
}, async () => {
  const now = Date.now();
  const page = await new JxaCalendarReader().listEvents(
    process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME!,
    new Date(now - 30 * 86_400_000).toISOString(),
    new Date(now + 365 * 86_400_000).toISOString(),
    0,
    100,
  );
  assert.ok(page.items.length <= 100);
  assert.ok(page.items.every((event) => event.calendarId === process.env.APPLE_CONNECTOR_CALENDAR_TEST_NAME && Date.parse(event.end) > Date.parse(event.start)));
});

test('M0 probe creates, rereads and removes only its own note in the opted-in test folder', {
  skip: process.platform !== 'darwin' || !process.env.APPLE_CONNECTOR_NOTES_TEST_FOLDER_ID,
}, async () => {
  const result = await new JxaRunner().run('diagnostics.notesCrud', {
    folderId: process.env.APPLE_CONNECTOR_NOTES_TEST_FOLDER_ID,
  }) as Record<string, unknown>;
  assert.equal(result.folderId, process.env.APPLE_CONNECTOR_NOTES_TEST_FOLDER_ID);
  assert.equal(result.createdAndRemoved, true);
});
