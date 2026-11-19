import type { AuditEvent } from '../audit/schema.js';

export type AuditAction = 'read' | 'create' | 'update' | 'complete' | 'delete';
export type AuditOutcome = 'allowed' | 'denied' | 'succeeded' | 'failed' | 'outcome_unknown';
export type AuditProvider = 'calendar' | 'reminders';
export type AuditLaneRef = { kind: 'client'; clientId: string } | { kind: 'web' };
export type AuditHeatLevel = 0 | 1 | 2 | 3 | 4;

export interface AuditLaneClient { id: string; name: string; revoked: boolean }

export interface AuditHeatCell {
  dayKey: string;
  hour: number;
  count: number;
  actions: Record<AuditAction, number>;
  outcomes: Record<AuditOutcome, number>;
}

export interface AuditHeatmapDay { key: string; at: number }

export interface AuditHeatmap {
  key: string;
  ref: AuditLaneRef;
  name: string;
  deleted: boolean;
  disambiguate: boolean;
  days: AuditHeatmapDay[];
  /** Indexed as [day][hour], with days ordered from oldest to today. */
  cells: AuditHeatCell[][];
  total: number;
  actionTotals: Record<AuditAction, number>;
  outcomeTotals: Record<AuditOutcome, number>;
}

/** Bottom-to-top operation order used only for labels and tooltips. */
export const AUDIT_ACTIONS: readonly AuditAction[] = ['read', 'create', 'update', 'complete', 'delete'];

/** GitHub contribution-graph greens on a light page. */
export const AUDIT_HEAT_COLORS: readonly string[] = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

const HEAT_DAYS = 7;

const emptyActions = (): Record<AuditAction, number> => ({ read: 0, create: 0, update: 0, complete: 0, delete: 0 });
const emptyOutcomes = (): Record<AuditOutcome, number> => ({ allowed: 0, denied: 0, succeeded: 0, failed: 0, outcome_unknown: 0 });

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export function isAuditProvider(value: string | undefined): value is AuditProvider {
  return value === 'calendar' || value === 'reminders';
}

/** Local calendar day as `YYYY-MM-DD`; heatmap buckets follow the browser time zone. */
export function localDayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayStart(now: number, offset: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.getTime();
}

/** The heatmap always shows the current local day plus the previous six. */
export function auditHeatmapDays(now: number): AuditHeatmapDay[] {
  return Array.from({ length: HEAT_DAYS }, (_, index) => {
    const at = dayStart(now, index - (HEAT_DAYS - 1));
    return { key: localDayKey(at), at };
  });
}

/** Data window: from local midnight six days ago through now. */
export function auditHeatmapWindow(now: number): { from: number; to: number } {
  return { from: dayStart(now, -(HEAT_DAYS - 1)), to: now };
}

/**
 * GitHub-style fixed thresholds. Fixed levels keep different authorizations comparable:
 * 1, 2–3, 4–7, and 8+ operations in one hour.
 */
export function auditHeatLevel(count: number): AuditHeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 7) return 3;
  return 4;
}

/**
 * One operation can write an `allowed` event and a terminal event. Keep a single event per
 * operation so a write is counted once; terminal outcomes win over `allowed`.
 */
export function collapseAuditEvents(events: readonly AuditEvent[]): AuditEvent[] {
  const groups = new Map<string, AuditEvent[]>();
  const singles: AuditEvent[] = [];
  for (const event of events) {
    if (!isAuditProvider(event.provider) || !isAuditAction(event.action)) continue;
    if (!event.target && !event.operationId) continue;
    if (event.operationId) {
      const group = groups.get(event.operationId) ?? [];
      group.push(event);
      groups.set(event.operationId, group);
    } else {
      singles.push(event);
    }
  }
  const rank: Record<string, number> = { allowed: 0, denied: 1, succeeded: 2, failed: 2, outcome_unknown: 3 };
  const chosen = [...singles];
  for (const group of groups.values()) {
    group.sort((left, right) => left.at - right.at);
    let best = group[0]!;
    for (const event of group) {
      const value = rank[event.outcome] ?? 0;
      const bestValue = rank[best.outcome] ?? 0;
      if (value > bestValue || (value === bestValue && event.at >= best.at)) best = event;
    }
    chosen.push(best);
  }
  return chosen;
}

function emptyCells(days: readonly AuditHeatmapDay[]): AuditHeatCell[][] {
  return days.map((day) => Array.from({ length: 24 }, (_, hour) => ({
    dayKey: day.key, hour, count: 0, actions: emptyActions(), outcomes: emptyOutcomes(),
  })));
}

/**
 * Build one heatmap per authorization record, plus the local management page and any
 * deleted authorizations that still have history.
 */
export function buildAuditHeatmaps(
  events: readonly AuditEvent[], clients: readonly AuditLaneClient[], now: number,
): AuditHeatmap[] {
  const days = auditHeatmapDays(now);
  const dayIndex = new Map(days.map((day, index) => [day.key, index]));
  const groups = new Map<string, AuditEvent[]>();
  const webEvents: AuditEvent[] = [];
  for (const event of collapseAuditEvents(events)) {
    if (event.source === 'web') { webEvents.push(event); continue; }
    if (!event.clientId) continue;
    const group = groups.get(event.clientId) ?? [];
    group.push(event);
    groups.set(event.clientId, group);
  }

  const lanes: Array<{ key: string; ref: AuditLaneRef; name: string; deleted: boolean; events: AuditEvent[] }> = [];
  for (const client of clients) {
    lanes.push({ key: `client:${client.id}`, ref: { kind: 'client', clientId: client.id }, name: client.name, deleted: false, events: groups.get(client.id) ?? [] });
    groups.delete(client.id);
  }
  for (const [clientId, group] of groups) {
    const named = [...group].reverse().find((event) => event.clientName)?.clientName;
    lanes.push({ key: `client:${clientId}`, ref: { kind: 'client', clientId }, name: named ?? '', deleted: true, events: group });
  }
  if (webEvents.length) lanes.push({ key: 'web', ref: { kind: 'web' }, name: '', deleted: false, events: webEvents });

  const nameCounts = new Map<string, number>();
  for (const lane of lanes) {
    if (lane.key === 'web') continue;
    nameCounts.set(lane.name, (nameCounts.get(lane.name) ?? 0) + 1);
  }

  return lanes.map((lane) => {
    const cells = emptyCells(days);
    const actionTotals = emptyActions();
    const outcomeTotals = emptyOutcomes();
    let total = 0;
    for (const event of lane.events) {
      const index = dayIndex.get(localDayKey(event.at));
      if (index === undefined) continue;
      const hour = new Date(event.at).getHours();
      const cell = cells[index]![hour]!;
      cell.count += 1;
      cell.actions[event.action as AuditAction] += 1;
      cell.outcomes[event.outcome] += 1;
      actionTotals[event.action as AuditAction] += 1;
      outcomeTotals[event.outcome] += 1;
      total += 1;
    }
    return {
      key: lane.key,
      ref: lane.ref,
      name: lane.name,
      deleted: lane.deleted,
      disambiguate: lane.key !== 'web' && (nameCounts.get(lane.name) ?? 0) > 1,
      days,
      cells,
      total,
      actionTotals,
      outcomeTotals,
    };
  }).sort((left, right) =>
    Number(left.key === 'web') - Number(right.key === 'web')
    || Number(left.deleted) - Number(right.deleted)
    || left.name.localeCompare(right.name)
    || left.key.localeCompare(right.key));
}

