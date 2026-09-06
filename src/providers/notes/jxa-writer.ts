import { ConnectorError } from '../../application/errors.js';
import { JxaRunner } from '../../jxa/runner.js';
import type { CreateNote, NoteReceipt, NoteWriter } from './types.js';

/** Fixed Notes Apple Events adapter. It deliberately has no update or delete surface. */
export class JxaNoteWriter implements NoteWriter {
  constructor(private readonly runner = new JxaRunner()) {}

  async preflight(input: CreateNote): Promise<void> {
    await this.runner.run('notes.preflight', { containerId: input.containerId });
  }

  async create(input: CreateNote): Promise<NoteReceipt> {
    const result = await this.runner.run('notes.create', { change: input });
    if (!result || typeof result !== 'object') throw new ConnectorError('protocol_error', 'Native writer returned an invalid receipt.');
    const receipt = result as Record<string, unknown>;
    if (typeof receipt.id !== 'string' || typeof receipt.containerId !== 'string') {
      throw new ConnectorError('protocol_error', 'Native writer returned an invalid receipt.');
    }
    return { id: receipt.id, containerId: receipt.containerId };
  }

  async verify(receipt: NoteReceipt, expected: CreateNote): Promise<boolean> {
    const result = await this.runner.run('notes.verify', { receipt, expected });
    return Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).verified === true);
  }
}
