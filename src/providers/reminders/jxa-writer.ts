import { JxaRunner } from '../../jxa/runner.js';
import { ConnectorError } from '../../application/errors.js';
import type { CreateReminder, ReminderReceipt, ReminderWriter } from './types.js';

/** Reminders adapter backed by the fixed JXA script registry. It is not wired into the service before M0 closes. */
export class JxaReminderWriter implements ReminderWriter {
  constructor(private readonly runner = new JxaRunner()) {}

  async preflight(input: CreateReminder): Promise<void> {
    await this.runner.run('reminders.preflight', { containerId: input.containerId });
  }

  async create(input: CreateReminder): Promise<ReminderReceipt> {
    const result = await this.runner.run('reminders.create', { change: input });
    if (!result || typeof result !== 'object') throw new ConnectorError('protocol_error', 'Native writer returned an invalid receipt.');
    const receipt = result as Record<string, unknown>;
    if (typeof receipt.id !== 'string' || typeof receipt.containerId !== 'string') {
      throw new ConnectorError('protocol_error', 'Native writer returned an invalid receipt.');
    }
    return { id: receipt.id, containerId: receipt.containerId };
  }

  async verify(receipt: ReminderReceipt, expected: CreateReminder): Promise<boolean> {
    const result = await this.runner.run('reminders.verify', { receipt, expected });
    return Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).verified === true);
  }
}
