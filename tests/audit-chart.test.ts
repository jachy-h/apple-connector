import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuditEvent } from '../src/audit/schema.js';
import {
  AUDIT_ACTIONS, AUDIT_HEAT_COLORS, auditHeatLevel, auditHeatmapDays, auditHeatmapWindow,
  buildAuditHeatmaps, collapseAuditEvents, localDayKey,
} from '../src/web/audit-chart.js';

const event = (patch: Partial<AuditEvent> = {}): AuditEvent => ({
  at: 1, source: 'client', action: 'read', outcome: 'allowed', count: 0, ...patch,
} as AuditEvent);

const local = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const now = local(11, 18, 15, 30);

test('GitHub-style heat levels use fixed thresholds and five greens', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 50].map(auditHeatLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(AUDIT_HEAT_COLORS.length, 5);
  assert.deepEqual([...AUDIT_ACTIONS], ['read', 'create', 'update', 'complete', 'delete']);
});

test('the heatmap window covers six full local days plus today', () => {
  const days = auditHeatmapDays(now);
  assert.deepEqual(days.map((day) => day.key), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
  assert.equal(localDayKey(now), '2026-11-18');
  assert.equal(auditHeatmapWindow(now).from, local(11, 12, 0));
  assert.equal(auditHeatmapWindow(now).to, now);
});

test('one operation keeps a single event with its terminal outcome', () => {
  const events = [
    event({ at: 10, operationId: 'op', action: 'delete', outcome: 'allowed', target: 'work', provider: 'calendar' }),
    event({ at: 12, operationId: 'op', action: 'delete', outcome: 'succeeded', target: 'work', provider: 'calendar' }),
    event({ at: 20, operationId: 'op2', action: 'update', outcome: 'allowed', target: 'work', provider: 'calendar' }),
    event({ at: 21, operationId: 'op2', action: 'update', outcome: 'failed', target: 'work', provider: 'calendar', errorCode: 'invalid_request' }),
    event({ at: 30, action: 'read', outcome: 'allowed', target: 'work', provider: 'calendar' }),
  ];
  const collapsed = collapseAuditEvents(events);
  assert.equal(collapsed.length, 3);
  const byOperation = new Map(collapsed.filter((item) => item.operationId).map((item) => [item.operationId, item]));
  assert.equal(byOperation.get('op')?.outcome, 'succeeded');
  assert.equal(byOperation.get('op')?.at, 12);
  assert.equal(byOperation.get('op2')?.outcome, 'failed');
  assert.ok(collapsed.some((item) => item.at === 30));
});

test('events without a container target or operation are not counted', () => {
  const events = [
    event({ at: now, provider: 'calendar', action: 'read', outcome: 'succeeded', count: 3 }),
    event({ at: now, action: 'client_created', outcome: 'allowed' }),
    event({ at: now, provider: 'notes', action: 'read', outcome: 'allowed', target: 'Notes' }),
  ];
  assert.deepEqual(collapseAuditEvents(events), []);
});

test('heatmaps group operations by authorization, day and hour', () => {
  const clients = [
    { id: 'b', name: 'Agent A', revoked: false },
    { id: 'a', name: 'Agent A', revoked: false },
    { id: 'c', name: 'Idle', revoked: false },
  ];
  const events = [
    event({ at: local(11, 18, 10, 0), clientId: 'a', clientName: 'Agent A', provider: 'calendar', action: 'read', outcome: 'allowed', target: 'work' }),
    event({ at: local(11, 18, 10, 20), clientId: 'a', clientName: 'Agent A', provider: 'calendar', action: 'create', outcome: 'succeeded', target: 'work' }),
    event({ at: local(11, 18, 11, 0), clientId: 'a', clientName: 'Agent A', operationId: 'op', provider: 'calendar', action: 'create', outcome: 'allowed', target: 'work' }),
    event({ at: local(11, 18, 11, 5), clientId: 'a', clientName: 'Agent A', operationId: 'op', provider: 'calendar', action: 'create', outcome: 'succeeded', target: 'work' }),
    event({ at: local(11, 17, 23, 0), clientId: 'a', clientName: 'Agent A', provider: 'calendar', action: 'delete', outcome: 'succeeded', target: 'work' }),
    event({ at: local(11, 12, 0, 30), clientId: 'gone', clientName: 'Deleted C', provider: 'calendar', action: 'create', outcome: 'succeeded', target: 'work' }),
    event({ at: local(11, 18, 15, 0), source: 'web', provider: 'calendar', action: 'read', outcome: 'succeeded', target: 'work' }),
    event({ at: local(11, 11, 12, 0), clientId: 'a', provider: 'calendar', action: 'read', outcome: 'succeeded', target: 'work' }),
    event({ at: local(11, 18, 12, 0), clientId: 'a', provider: 'calendar', action: 'read', outcome: 'succeeded' }),
  ];
  const heatmaps = buildAuditHeatmaps(events, clients, now);
  assert.deepEqual(heatmaps.map((lane) => lane.key), ['client:a', 'client:b', 'client:c', 'client:gone', 'web']);
  assert.equal(heatmaps[0]?.disambiguate, true);
  assert.equal(heatmaps[1]?.disambiguate, true);
  assert.equal(heatmaps[2]?.total, 0);

  const agent = heatmaps[0]!;
  assert.equal(agent.total, 4);
  assert.equal(agent.cells[6]![10]!.count, 2);
  assert.equal(agent.cells[6]![11]!.count, 1);
  assert.equal(agent.cells[5]![23]!.count, 1);
  assert.deepEqual(agent.actionTotals, { read: 1, create: 2, update: 0, complete: 0, delete: 1 });
  assert.deepEqual(agent.outcomeTotals, { allowed: 1, succeeded: 3, denied: 0, failed: 0, outcome_unknown: 0 });

  const deleted = heatmaps.find((lane) => lane.key === 'client:gone')!;
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.name, 'Deleted C');
  assert.equal(deleted.cells[0]![0]!.count, 1);

  const web = heatmaps.at(-1)!;
  assert.equal(web.ref.kind, 'web');
  assert.equal(web.cells[6]![15]!.count, 1);
});
