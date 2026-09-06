import { ConnectorError } from '../../application/errors.js';
import { JxaRunner } from '../../jxa/runner.js';

export interface NoteFolder { id: string; name: string }
export interface NoteSummary { id: string; folderId: string; title: string; snippet: string }
export interface NoteDocument extends NoteSummary { body: string }

function records(value: unknown, message: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object')) throw new ConnectorError('protocol_error', message);
  return value as Record<string, unknown>[];
}
function text(value: unknown, message: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new ConnectorError('protocol_error', message);
  return value;
}

/** Read adapter accepts explicit folder IDs only; it never performs global Notes enumeration for an agent. */
export class JxaNoteReader {
  constructor(private readonly runner = new JxaRunner()) {}

  async listFolders(containerIds: string[]): Promise<NoteFolder[]> {
    const rows = records(await this.runner.run('notes.listFolders', { containerIds }), 'Native reader returned invalid folders.');
    return rows.map((row) => ({ id: text(row.id, 'Native reader returned invalid folder.', 512), name: text(row.name, 'Native reader returned invalid folder.', 500) }));
  }
  async get(folderId: string, id: string): Promise<NoteDocument> {
    const row = await this.runner.run('notes.get', { folderId, id });
    if (!row || typeof row !== 'object') throw new ConnectorError('protocol_error', 'Native reader returned an invalid note.');
    const value = row as Record<string, unknown>;
    return { id: text(value.id, 'Native reader returned an invalid note.', 512), folderId: text(value.folderId, 'Native reader returned an invalid note.', 512),
      title: text(value.title, 'Native reader returned an invalid note.', 500), snippet: text(value.snippet, 'Native reader returned an invalid note.', 2_000),
      body: text(value.body, 'Native reader returned an invalid note.', 32_000) };
  }
  async search(folderId: string, query: string, limit = 50): Promise<NoteSummary[]> {
    const rows = records(await this.runner.run('notes.search', { folderId, query, limit }), 'Native reader returned invalid search results.');
    return rows.map((row) => ({ id: text(row.id, 'Native reader returned invalid search result.', 512), folderId: text(row.folderId, 'Native reader returned invalid search result.', 512),
      title: text(row.title, 'Native reader returned invalid search result.', 500), snippet: text(row.snippet, 'Native reader returned invalid search result.', 2_000) }));
  }
}
