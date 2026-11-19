import { ConnectorError } from '../../application/errors.js';
import { EventKitHelperClient } from '../../native/helper-client.js';
import type { CompleteReminder, CreateReminder, DeleteReminder, PatchReminder, ReminderItem, ReminderList, ReminderPage, ReminderReceipt, ReminderWriter, UpdateReminder } from './types.js';
import { reminderPageSchema } from './types.js';

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object') throw new ConnectorError('protocol_error', 'EventKit helper returned invalid data.'); return value as Record<string, unknown>; }
export interface ReminderReader { listLists(containerIds: string[]): Promise<ReminderList[]>; list(listId: string, offset?: number, limit?: number): Promise<ReminderPage>; }
export interface WebReminderMutator { update(input: UpdateReminder): Promise<ReminderReceipt>; remove(input: DeleteReminder): Promise<ReminderReceipt>; }
export interface AgentReminderMutator extends WebReminderMutator { complete(input: CompleteReminder): Promise<ReminderReceipt>; patch(input: PatchReminder): Promise<ReminderReceipt>; }
export class EventKitReminderProvider implements ReminderReader, ReminderWriter, AgentReminderMutator {
  constructor(private readonly helper: EventKitHelperClient) {}
  async listLists(containerIds: string[]): Promise<ReminderList[]> { const value = await this.helper.call('reminders.listLists', { containerIds }); if (!Array.isArray(value)) throw new ConnectorError('protocol_error', 'EventKit helper returned invalid lists.'); return value.map((x) => { const r = record(x); if (typeof r.id !== 'string' || typeof r.name !== 'string') throw new ConnectorError('protocol_error', 'EventKit helper returned invalid list.'); return { id: r.id, name: r.name }; }); }
  async list(listId: string, offset = 0, limit = 50): Promise<ReminderPage> {
    const parsed = reminderPageSchema.safeParse(await this.helper.call('reminders.list', { listId, offset, limit }));
    if (!parsed.success || parsed.data.items.some((item: ReminderItem) => item.listId !== listId)) throw new ConnectorError('protocol_error', 'EventKit helper returned invalid reminder page.');
    return parsed.data;
  }
  // The EventKit action performs permission, target and writable checks immediately before
  // saving. Keeping them in that one request eliminates a second native round trip and the
  // check/save race; TypeScript has already validated policy before reaching this adapter.
  async preflight(_input: CreateReminder): Promise<void> {}
  async create(input: CreateReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.createVerified', { change: input }, 60_000)); if (typeof r.id !== 'string' || typeof r.containerId !== 'string') throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid receipt.'); return { id: r.id, containerId: r.containerId }; }
  async verify(): Promise<boolean> { return true; } // createVerified performs an EventKit store re-read atomically in one helper request.
  async update(input: UpdateReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.updateVerified', { change: input }, 60_000)); if (r.id !== input.id || r.containerId !== input.containerId) throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid update receipt.'); return { id: input.id, containerId: input.containerId }; }
  async patch(input: PatchReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.patchVerified', { change: input }, 60_000)); if (r.id !== input.id || r.containerId !== input.containerId) throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid patch receipt.'); return { id: input.id, containerId: input.containerId }; }
  async complete(input: CompleteReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.completeVerified', { change: input }, 60_000)); if (r.id !== input.id || r.containerId !== input.containerId) throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid completion receipt.'); return { id: input.id, containerId: input.containerId }; }
  async remove(input: DeleteReminder): Promise<ReminderReceipt> { const r = record(await this.helper.call('reminders.deleteVerified', { change: input }, 60_000)); if (r.id !== input.id || r.containerId !== input.containerId) throw new ConnectorError('protocol_error', 'EventKit helper returned an invalid delete receipt.'); return { id: input.id, containerId: input.containerId }; }
}
