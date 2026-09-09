import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCalendarEventSchema } from '../src/providers/calendar/types.js';
import { dueSchema } from '../src/providers/reminders/types.js';
import { calendarListEventsSchema, validationMessage } from '../src/transports/validation.js';

test('shared instant contract accepts RFC 3339 offsets with optional fractional seconds', () => {
  for (const from of ['2026-09-07T00:00:00+08:00', '2026-09-06T16:00:00Z', '2026-09-07T00:00:00.123+08:00']) {
    assert.equal(calendarListEventsSchema.safeParse({ calendarId: 'calendar', from, to: '2026-09-08T00:00:00+08:00' }).success, true);
  }
  assert.equal(createCalendarEventSchema.safeParse({ kind: 'calendar.create', containerId: 'calendar', title: 'Test', start: '2026-09-07T00:00:00Z', end: '2026-09-07T01:00:00Z', allDay: false }).success, true);
  assert.equal(dueSchema.safeParse({ kind: 'instant', at: '2026-09-07T00:00:00+08:00', timeZone: 'Asia/Shanghai' }).success, true);
});

test('shared validation rejects timezone-less and non-increasing instants without echoing content', () => {
  const noZone = calendarListEventsSchema.safeParse({ calendarId: 'calendar', from: '2026-09-07T00:00:00', to: '2026-09-08T00:00:00+08:00' });
  assert.equal(noZone.success, false);
  if (!noZone.success) assert.equal(validationMessage(noZone.error), 'Invalid argument "from": expected an RFC 3339 datetime with an explicit timezone, for example "2026-09-07T00:00:00+08:00" or "2026-09-06T16:00:00Z"; fractional seconds are optional.');
  const reverse = calendarListEventsSchema.safeParse({ calendarId: 'calendar', from: '2026-09-08T00:00:00+08:00', to: '2026-09-07T00:00:00+08:00' });
  assert.equal(reverse.success, false);
  if (!reverse.success) assert.equal(validationMessage(reverse.error), 'Invalid arguments "from" and "to": "to" must be later than "from".');
  const secret = dueSchema.safeParse({ kind: 'instant', at: 'not-a-date', timeZone: 'private value' });
  assert.equal(secret.success, false);
  if (!secret.success) assert.ok(!validationMessage(secret.error).includes('private value'));
});
