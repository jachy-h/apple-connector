import { ConnectorError } from '../application/errors.js';
import { dateOnlySchema, instantSchema, timeZoneSchema } from '../transports/validation.js';

/** Common UTC-offset → IANA timezone mapping used when --due carries no --time-zone. */
const OFFSET_TO_TZ: Record<string, string> = {
  'Z': 'UTC',
  '+00:00': 'UTC',
  '-00:00': 'UTC',
  '+01:00': 'Europe/Berlin',
  '+02:00': 'Europe/Athens',
  '+03:00': 'Europe/Moscow',
  '+05:30': 'Asia/Kolkata',
  '+07:00': 'Asia/Bangkok',
  '+08:00': 'Asia/Shanghai',
  '+09:00': 'Asia/Tokyo',
  '+10:00': 'Australia/Sydney',
  '-03:00': 'America/Sao_Paulo',
  '-05:00': 'America/New_York',
  '-06:00': 'America/Chicago',
  '-07:00': 'America/Denver',
  '-08:00': 'America/Los_Angeles',
};

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  const v = rest[i + 1];
  return i >= 0 && v && !v.startsWith('--') ? v : undefined;
}

function timeZoneForOffset(at: string): string {
  const match = /(Z|[+-]\d{2}:\d{2})$/.exec(at);
  if (!match) return 'UTC';
  return OFFSET_TO_TZ[match[1]!] ?? 'UTC';
}

export type DueInput = { kind: 'instant'; at: string; timeZone: string } | { kind: 'date'; date: string };

/**
 * Parse reminder due-date flags from CLI args: --due <RFC 3339> (timed) or
 * --due-date <YYYY-MM-DD> (all-day), with optional --time-zone <IANA>.
 * Returns an empty object when no due flag is present.
 */
export function parseDueInput(rest: string[]): { due?: DueInput } {
  const at = flag(rest, '--due');
  const date = flag(rest, '--due-date');
  if (at && date) throw new ConnectorError('invalid_request', 'Use either --due or --due-date, not both.');
  if (date) {
    if (!dateOnlySchema.safeParse(date).success) {
      throw new ConnectorError('invalid_request', '--due-date must be a valid YYYY-MM-DD date, for example "2026-10-06".');
    }
    return { due: { kind: 'date', date } };
  }
  if (at) {
    if (!instantSchema.safeParse(at).success) {
      throw new ConnectorError('invalid_request', '--due must be an RFC 3339 datetime with an explicit timezone, for example "2026-10-06T14:00:00+08:00".');
    }
    const timeZone = flag(rest, '--time-zone') ?? timeZoneForOffset(at);
    if (!timeZoneSchema.safeParse(timeZone).success) {
      throw new ConnectorError('invalid_request', `--time-zone must be a valid IANA timezone, for example "Asia/Shanghai" (received "${timeZone}").`);
    }
    return { due: { kind: 'instant', at, timeZone } };
  }
  return {};
}