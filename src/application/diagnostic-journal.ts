import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError } from './errors.js';
import { runReminderM1Diagnostic } from './reminder-m1-diagnostic.js';
import type { DiagnosticRunner, ReminderM1Event } from './reminder-m1-diagnostic.js';

const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const eventSchema = z.object({
  probeId: z.string().regex(uuidPattern),
  stage: z.enum(['create', 'update_title', 'update_body', 'update_due', 'complete', 'verify', 'cleanup']),
  status: z.enum(['started', 'succeeded', 'failed']),
  at: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  stableId: z.string().min(1).max(512).optional(),
}).strict();
const journalSchema = z.object({
  version: z.literal(1),
  kind: z.literal('reminders-m1'),
  probeId: z.string().regex(uuidPattern),
  containerId: z.string().min(1).max(512),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  events: z.array(eventSchema).max(100),
  recoveryStatus: z.enum(['pending', 'removed_verified', 'not_found', 'ambiguous', 'outcome_unknown']).default('pending'),
}).strict();
export type DiagnosticJournal = z.infer<typeof journalSchema>;

export function diagnosticJournalPath(stateDir: string, probeId: string): string {
  if (!uuidPattern.test(probeId)) throw new ConnectorError('invalid_request', 'Invalid diagnostic probe UUID.');
  return join(resolve(stateDir), 'diagnostics', `reminders-m1-${probeId}.json`);
}

function persist(path: string, journal: DiagnosticJournal): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function loadDiagnosticJournal(stateDir: string, probeId: string): DiagnosticJournal {
  const path = diagnosticJournalPath(stateDir, probeId);
  try { return journalSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
  catch { throw new ConnectorError('invalid_request', 'Diagnostic journal is missing or invalid.'); }
}

/** Lists private journal metadata only; malformed files are ignored rather than executed or repaired. */
export function listDiagnosticJournals(stateDir: string): DiagnosticJournal[] {
  const directory = join(resolve(stateDir), 'diagnostics');
  try {
    return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && /^reminders-m1-[0-9a-f-]+\.json$/i.test(entry.name))
      .flatMap((entry) => { try { return [journalSchema.parse(JSON.parse(readFileSync(join(directory, entry.name), 'utf8')))]; } catch { return []; } })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch { return []; }
}

export async function runJournaledReminderM1Diagnostic(
  runner: DiagnosticRunner,
  stateDir: string,
  containerId: string,
  now: () => number = Date.now,
  onCreated?: (journal: Pick<DiagnosticJournal, 'probeId' | 'containerId' | 'createdAt'>) => void,
): Promise<{ journalPath: string; probeId: string; stableId: string }> {
  const probeId = randomUUID();
  const journalPath = diagnosticJournalPath(stateDir, probeId);
  const journal: DiagnosticJournal = {
    version: 1, kind: 'reminders-m1', probeId, containerId, createdAt: now(), updatedAt: now(), events: [], recoveryStatus: 'pending',
  };
  persist(journalPath, journal);
  onCreated?.({ probeId, containerId, createdAt: journal.createdAt });
  const record = (event: ReminderM1Event) => {
    journal.events.push(event);
    journal.updatedAt = now();
    if (event.stage === 'cleanup' && event.status === 'succeeded') journal.recoveryStatus = 'removed_verified';
    persist(journalPath, journal);
  };
  const result = await runReminderM1Diagnostic(runner, containerId, record, now, probeId);
  return { journalPath, probeId, stableId: result.stableId };
}

export async function recoverJournaledReminderM1Diagnostic(
  runner: DiagnosticRunner,
  stateDir: string,
  probeId: string,
  now: () => number = Date.now,
): Promise<{ journalPath: string; status: DiagnosticJournal['recoveryStatus'] }> {
  const journalPath = diagnosticJournalPath(stateDir, probeId);
  const journal = loadDiagnosticJournal(stateDir, probeId);
  const stableId = [...journal.events].reverse().find((event) => event.stableId)?.stableId;
  journal.events.push({ probeId, stage: 'cleanup', status: 'started', at: now(), ...(stableId ? { stableId } : {}) });
  journal.updatedAt = now();
  persist(journalPath, journal);
  try {
    const raw = await runner.run('diagnostics.remindersDeleteM1Probe', {
      containerId: journal.containerId, probeId, ...(stableId ? { nativeId: stableId } : {}),
    });
    const parsed = z.object({
      status: z.enum(['not_found', 'removed_verified', 'ambiguous', 'outcome_unknown']),
      stableId: z.string().min(1).max(512).nullable(),
    }).strict().parse(raw);
    journal.events.push({ probeId, stage: 'cleanup', status: 'succeeded', at: now(), ...(parsed.stableId ? { stableId: parsed.stableId } : {}) });
    journal.recoveryStatus = parsed.status;
  } catch (error) {
    journal.events.push({ probeId, stage: 'cleanup', status: 'failed', at: now(), ...(stableId ? { stableId } : {}) });
    journal.recoveryStatus = 'outcome_unknown';
    journal.updatedAt = now();
    persist(journalPath, journal);
    throw error;
  }
  journal.updatedAt = now();
  persist(journalPath, journal);
  return { journalPath, status: journal.recoveryStatus };
}
