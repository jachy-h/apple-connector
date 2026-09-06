import { z } from 'zod';
import { ConnectorError } from '../../application/errors.js';
import { JxaRunner } from '../../jxa/runner.js';

export interface CalendarContainer { id: string; name: string }
export interface CalendarEvent { calendarId: string; title: string; start: string; end: string; allDay: boolean; location: string; notes: string }
export interface CalendarPage { items: CalendarEvent[]; nextOffset: number | null }
const text = (limit: number) => z.string().max(limit);
const containerSchema = z.object({ id: text(512), name: text(500) }).strict();
const eventSchema = z.object({ calendarId: text(512), title: text(500), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }), allDay: z.boolean(), location: text(2_000), notes: text(32_000) }).strict();
const pageSchema = z.object({ items: z.array(eventSchema).max(100), nextOffset: z.number().int().nonnegative().nullable() }).strict();

/** Calendar scopes are exact names and native calls reject missing or ambiguous names. */
export class JxaCalendarReader {
  constructor(private readonly runner = new JxaRunner()) {}
  async listCalendars(containerIds: string[]): Promise<CalendarContainer[]> {
    const result = await this.runner.run('calendar.listCalendars', { containerIds });
    if (!Array.isArray(result)) throw new ConnectorError('protocol_error', 'Native reader returned invalid calendars.');
    return result.map((item) => containerSchema.parse(item));
  }
  async listEvents(calendarId: string, from: string, to: string, offset = 0, limit = 50): Promise<CalendarPage> {
    const result = pageSchema.parse(await this.runner.run('calendar.listEvents', { calendarId, from, to, offset, limit }));
    if (result.items.some((item) => item.calendarId !== calendarId || Date.parse(item.end) <= Date.parse(item.start))) throw new ConnectorError('protocol_error', 'Native reader returned invalid calendar events.');
    return result;
  }
}
