import { ConnectorError } from '../../application/errors.js';
import { JxaRunner } from '../../jxa/runner.js';

export interface ReminderList { id: string; name: string }
export interface ReminderItem { id: string; listId: string; title: string; body: string; completed: boolean; due: string | null }
export interface ReminderPage { items: ReminderItem[]; nextOffset: number | null }
function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new ConnectorError('protocol_error', message); return value as Record<string, unknown>;
}
function text(value: unknown, message: string, maximum: number): string { if (typeof value !== 'string' || value.length > maximum) throw new ConnectorError('protocol_error', message); return value; }
function item(value: unknown): ReminderItem {
  const row = record(value, 'Native reader returned invalid reminder.');
  if (typeof row.completed !== 'boolean' || (row.due !== null && typeof row.due !== 'string')) throw new ConnectorError('protocol_error', 'Native reader returned invalid reminder.');
  return { id: text(row.id, 'Native reader returned invalid reminder.', 512), listId: text(row.listId, 'Native reader returned invalid reminder.', 512), title: text(row.title, 'Native reader returned invalid reminder.', 500), body: text(row.body, 'Native reader returned invalid reminder.', 32_000), completed: row.completed, due: row.due };
}
/** Reads only caller-supplied list IDs; no all-lists query is exposed to agents. */
export class JxaReminderReader {
  constructor(private readonly runner = new JxaRunner()) {}
  async listLists(containerIds: string[]): Promise<ReminderList[]> {
    const result = await this.runner.run('reminders.listLists', { containerIds });
    if (!Array.isArray(result)) throw new ConnectorError('protocol_error', 'Native reader returned invalid lists.');
    return result.map((value) => { const row = record(value, 'Native reader returned invalid list.'); return { id: text(row.id, 'Native reader returned invalid list.', 512), name: text(row.name, 'Native reader returned invalid list.', 500) }; });
  }
  async list(listId: string, offset = 0, limit = 50): Promise<ReminderPage> {
    const row = record(await this.runner.run('reminders.list', { listId, offset, limit }), 'Native reader returned invalid reminder page.');
    const nextOffset = row.nextOffset;
    if (!Array.isArray(row.items) || (nextOffset !== null && (!Number.isInteger(nextOffset) || typeof nextOffset !== 'number' || nextOffset < 0))) throw new ConnectorError('protocol_error', 'Native reader returned invalid reminder page.');
    return { items: row.items.map(item), nextOffset: nextOffset as number | null };
  }
}
