import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDueInput } from '../src/cli/due.js';

test('parseDueInput returns empty object without due flags', () => {
  assert.deepEqual(parseDueInput(['--list-id', 'x', '--title', 'y']), {});
});

test('parseDueInput parses --due with offset and maps timezone', () => {
  assert.deepEqual(parseDueInput(['--due', '2026-10-06T14:00:00+08:00']), {
    due: { kind: 'instant', at: '2026-10-06T14:00:00+08:00', timeZone: 'Asia/Shanghai' },
  });
});

test('parseDueInput accepts Z and fractional seconds', () => {
  assert.deepEqual(parseDueInput(['--due', '2026-10-06T06:00:00.123Z']), {
    due: { kind: 'instant', at: '2026-10-06T06:00:00.123Z', timeZone: 'UTC' },
  });
});

test('parseDueInput honors explicit --time-zone', () => {
  assert.deepEqual(parseDueInput(['--due', '2026-10-06T14:00:00+08:00', '--time-zone', 'Asia/Tokyo']), {
    due: { kind: 'instant', at: '2026-10-06T14:00:00+08:00', timeZone: 'Asia/Tokyo' },
  });
});

test('parseDueInput parses --due-date as all-day', () => {
  assert.deepEqual(parseDueInput(['--due-date', '2026-10-06']), {
    due: { kind: 'date', date: '2026-10-06' },
  });
});

test('parseDueInput rejects --due and --due-date together', () => {
  assert.throws(() => parseDueInput(['--due', '2026-10-06T14:00:00+08:00', '--due-date', '2026-10-06']), { code: 'invalid_request' });
});

test('parseDueInput rejects malformed --due', () => {
  assert.throws(() => parseDueInput(['--due', '2026-10-06 14:00']), { code: 'invalid_request' });
  assert.throws(() => parseDueInput(['--due', '2026-10-06T14:00:00']), { code: 'invalid_request' });
});

test('parseDueInput rejects malformed --due-date', () => {
  assert.throws(() => parseDueInput(['--due-date', '2026-13-40']), { code: 'invalid_request' });
  assert.throws(() => parseDueInput(['--due-date', '10/06/2026']), { code: 'invalid_request' });
});

test('parseDueInput rejects invalid --time-zone', () => {
  assert.throws(() => parseDueInput(['--due', '2026-10-06T14:00:00+08:00', '--time-zone', 'Mars/Olympus']), { code: 'invalid_request' });
});