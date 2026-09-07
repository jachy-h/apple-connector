import { ConnectorError } from '../application/errors.js';

export const PROTOCOL_VERSION = 1;
export const MAX_INPUT_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const scriptRegistry = {
  'diagnostics.probe': { path: 'diagnostics/probe.js', mutates: false },
  'diagnostics.findTestContainers': { path: 'diagnostics/find-test-containers.js', mutates: false, timeoutMs: 60_000 },
  'diagnostics.roundtrip': { path: 'diagnostics/roundtrip.js', mutates: false },
  // This creates and removes only a clearly-labelled, newly-created probe reminder in a caller-specified list.
  'diagnostics.remindersCrud': { path: 'diagnostics/reminders-crud.js', mutates: true, timeoutMs: 60_000 },
  // Creates, updates, completes and removes only a UUID-labelled probe in a caller-specified list.
  'diagnostics.remindersUpdateCrud': { path: 'diagnostics/reminders-update-crud.js', mutates: true, timeoutMs: 60_000 },
  // M1 is split at native-call boundaries so a timeout identifies the last attempted mutation.
  'diagnostics.remindersM1Create': { path: 'diagnostics/reminders-m1-step.js', mutates: true, timeoutMs: 30_000 },
  'diagnostics.remindersM1UpdateTitle': { path: 'diagnostics/reminders-m1-step.js', mutates: true, timeoutMs: 30_000 },
  'diagnostics.remindersM1UpdateBody': { path: 'diagnostics/reminders-m1-step.js', mutates: true, timeoutMs: 30_000 },
  'diagnostics.remindersM1UpdateDue': { path: 'diagnostics/reminders-m1-step.js', mutates: true, timeoutMs: 30_000 },
  'diagnostics.remindersM1Complete': { path: 'diagnostics/reminders-m1-step.js', mutates: true, timeoutMs: 30_000 },
  'diagnostics.remindersM1Verify': { path: 'diagnostics/reminders-m1-step.js', mutates: false, timeoutMs: 30_000 },
  // Recovery-only deletion requires the UUID held before the original write; ambiguous matches reject.
  'diagnostics.remindersDeleteM1Probe': { path: 'diagnostics/reminders-delete-m1-probe.js', mutates: true, timeoutMs: 60_000 },
  'diagnostics.calendarCrud': { path: 'diagnostics/calendar-crud.js', mutates: true, timeoutMs: 60_000 },
  'diagnostics.notesCrud': { path: 'diagnostics/notes-crud.js', mutates: true, timeoutMs: 60_000 },
  'diagnostics.calendarEventKitCrud': { path: 'diagnostics/calendar-eventkit-crud.js', mutates: true, timeoutMs: 60_000 },
  'diagnostics.calendarEventKitAccess': { path: 'diagnostics/calendar-eventkit-access.js', mutates: false, timeoutMs: 60_000 },
  'diagnostics.remindersEventKitAccess': { path: 'diagnostics/reminders-eventkit-access.js', mutates: false, timeoutMs: 60_000 },
  'reminders.preflight': { path: 'reminders/write.js', mutates: false, timeoutMs: 60_000 },
  'reminders.create': { path: 'reminders/write.js', mutates: true, timeoutMs: 60_000 },
  'reminders.verify': { path: 'reminders/write.js', mutates: false, timeoutMs: 60_000 },
  'notes.preflight': { path: 'notes/write.js', mutates: false, timeoutMs: 60_000 },
  'notes.create': { path: 'notes/write.js', mutates: true, timeoutMs: 60_000 },
  'notes.verify': { path: 'notes/write.js', mutates: false, timeoutMs: 60_000 },
  'notes.listFolders': { path: 'notes/read.js', mutates: false, timeoutMs: 60_000 },
  'notes.get': { path: 'notes/read.js', mutates: false, timeoutMs: 60_000 },
  'notes.search': { path: 'notes/read.js', mutates: false, timeoutMs: 60_000 },
  'diagnostics.notesDeleteProbe': { path: 'diagnostics/notes-delete.js', mutates: true, timeoutMs: 60_000 },
  'reminders.listLists': { path: 'reminders/read.js', mutates: false, timeoutMs: 60_000 },
  'reminders.list': { path: 'reminders/read.js', mutates: false, timeoutMs: 60_000 },
  'reminders.listEventKit': { path: 'reminders/eventkit-read.js', mutates: false, timeoutMs: 25_000 },
  'diagnostics.remindersDeleteProbe': { path: 'diagnostics/reminders-delete.js', mutates: true, timeoutMs: 60_000 },
  'diagnostics.remindersDeleteM0ProbeByUuid': { path: 'diagnostics/reminders-delete-m0-probe.js', mutates: true, timeoutMs: 60_000 },
  'calendar.listCalendars': { path: 'calendar/read.js', mutates: false, timeoutMs: 60_000 },
  'calendar.listEvents': { path: 'calendar/read.js', mutates: false, timeoutMs: 60_000 },
} as const;
export type ScriptOperation = keyof typeof scriptRegistry;

export interface ScriptRequest {
  protocolVersion: 1;
  requestId: string;
  operation: ScriptOperation;
  payload: Record<string, unknown>;
}

export function decodeResponse(raw: string, request: ScriptRequest): unknown {
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    throw new ConnectorError('protocol_error', 'Native response is not valid JSON.');
  }
  if (!value || typeof value !== 'object') {
    throw new ConnectorError('protocol_error', 'Native response is not an object.');
  }
  const response = value as Record<string, unknown>;
  if (response.protocolVersion !== PROTOCOL_VERSION || response.requestId !== request.requestId ||
      response.operation !== request.operation || typeof response.ok !== 'boolean') {
    throw new ConnectorError('protocol_error', 'Native response identity or version mismatch.');
  }
  if (!response.ok) {
    const error = response.error as Record<string, unknown> | undefined;
    // Translate a fixed set of codes, never native message text.
    if (error?.code === 'permission_denied') {
      throw new ConnectorError('permission_denied', 'macOS access was denied.');
    }
    if (error?.code === 'unsupported_operation') {
      throw new ConnectorError('unsupported_operation', 'Native operation is not supported.');
    }
    throw new ConnectorError('service_unavailable', 'Native operation failed.');
  }
  if (!Object.hasOwn(response, 'result')) {
    throw new ConnectorError('protocol_error', 'Native response has no result.');
  }
  return response.result;
}
