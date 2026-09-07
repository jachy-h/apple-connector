import { ConnectorError } from '../../application/errors.js';
import { EventKitHelperClient } from '../../native/helper-client.js';
import type { CreateReminder, DeleteReminder, ReminderReceipt, ReminderWriter, UpdateReminder } from './types.js';
import type { ReminderItem, ReminderList, ReminderPage } from './jxa-reader.js';

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object') throw new ConnectorError('protocol_error', 'EventKit helper returned invalid data.'); return value as Record<string, unknown>; }
export interface ReminderReader { listLists(containerIds: string[]): Promise<ReminderList[]>; list(listId: string, offset?: number, limit?: number): Promise<ReminderPage>; }
export interface WebReminderMutator { update(input: UpdateReminder): Promise<ReminderReceipt>; remove(input: DeleteReminder): Promise<ReminderReceipt>; }
export class EventKitReminderProvider implements ReminderReader, ReminderWriter, WebReminderMutator {
  constructor(private readonly helper: EventKitHelperClient) {}
  async listLists(containerIds: string[]): Promise<ReminderList[]> { const value = await this.helper.call('reminders.listLists', { containerIds }); if (!Array.isArray(value)) throw new ConnectorError('protocol_error', 'EventKit helper returned invalid lists.'); return value.map((x) => { const r = record(x); if (typeof r.id !== 'string' || typeof r.name !== 'string') throw new ConnectorError('protocol_error', 'EventKit helper returned invalid list.'); return { id: r.id, name: r.name }; }); }
  async list(listId: string, offset = 0, limit = 50): Promise<ReminderPage> { const r = record(await this.helper.call('reminders.list', { listId, offset, limit })); if (!Array.isArray(r.items) || (r.nextOffset !== null && (!Number.isInteger(r.nextOffset) || typeof r.nextOffset !== 'number'))) throw new ConnectorError('protocol_error', 'EventKit helper returned invalid page.'); const items: ReminderItem[] = r.items.map((x) => { const v = record(x); if (typeof v.id !== 'string' || typeof v.listId !== 'string' || v.listId !== listId || typeof v.title !== 'string' || typeof v.body !== 'string' || typeof v.completed !== 'boolean' || (v.due !== null && typeof v.due !== 'string')) throw new ConnectorError('protocol_error', 'EventKit helper returned invalid reminder.'); return { id: v.id, listId: v.listId, title: v.title, body: v.body, completed: v.completed, due: v.due as string | null }; }); return { items, nextOffset: r.nextOffset as number | null }; }
  // The EventKit action performs permission, target and writable checks immediately before
  // saving. Keeping them in that one request eliminates a second native round trip and the
  // check/save race; TypeScript has already validated policy before reaching this adapter.
  async preflight(_input: CreateReminder): Promise<void> {}
  async create(input: CreateReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.createVerified', { change: input }, 60_000)); if (typeof r.id !== 'string' || typeof r.containerId !== 'string') throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid receipt.'); return { id: r.id, containerId: r.containerId }; }
  async verify(): Promise<boolean> { return true; } // createVerified performs an EventKit store re-read atomically in one helper request.
  async update(input: UpdateReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.updateVerified', { change: input }, 60_000)); if (r.id !== input.id || r.containerId !== input.containerId) throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid update receipt.'); return { id: input.id, containerId: input.containerId }; }
  async remove(input: DeleteReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.deleteVerified', { change: input }, 60_000)); if (r.id !== input.id || r.containerId !== input.containerId) throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid delete receipt.'); return { id: input.id, containerId: input.containerId }; }
}
