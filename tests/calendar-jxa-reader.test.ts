import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JxaRunner } from '../src/jxa/runner.js';
import { JxaCalendarReader } from '../src/providers/calendar/jxa-reader.js';

test('Calendar reader uses explicit unique-name scopes and validates event output', async () => {
  const calls: Array<{ operation: string; payload: Record<string, unknown> }> = [];
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string; payload: Record<string, unknown> };
    calls.push({ operation: envelope.operation, payload: envelope.payload });
    const result = envelope.operation === 'calendar.listCalendars' ? [{ id: 'Agents', name: 'Agents' }] : {
      items: [{ calendarId: 'Agents', title: 'Planning', start: '2028-02-29T09:00:00+08:00', end: '2028-02-29T10:00:00+08:00', allDay: false, location: 'Room', notes: 'Private' }], nextOffset: null,
    };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result });
  });
  const reader = new JxaCalendarReader(runner);
  assert.deepEqual(await reader.listCalendars(['Agents']), [{ id: 'Agents', name: 'Agents' }]);
  assert.equal((await reader.listEvents('Agents', '2028-02-29T00:00:00+08:00', '2028-03-01T00:00:00+08:00', 2, 3)).items[0]?.title, 'Planning');
  assert.deepEqual(calls, [
    { operation: 'calendar.listCalendars', payload: { containerIds: ['Agents'] } },
    { operation: 'calendar.listEvents', payload: { calendarId: 'Agents', from: '2028-02-29T00:00:00+08:00', to: '2028-03-01T00:00:00+08:00', offset: 2, limit: 3 } },
  ]);
});

test('Calendar reader rejects malformed or cross-container native events', async () => {
  const runner = new JxaRunner(async (request) => {
    const envelope = JSON.parse(request.input) as { operation: string; requestId: string };
    return JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, operation: envelope.operation, ok: true, result: { items: [{ calendarId: 'other', title: 'x', start: '2028-02-29T10:00:00+08:00', end: '2028-02-29T09:00:00+08:00', allDay: false, location: '', notes: '' }], nextOffset: null } });
  });
  await assert.rejects(new JxaCalendarReader(runner).listEvents('Agents', '2028-02-29T00:00:00+08:00', '2028-03-01T00:00:00+08:00'), { code: 'protocol_error' });
});
