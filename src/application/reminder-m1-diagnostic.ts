import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError } from './errors.js';
import type { ScriptOperation } from '../jxa/protocol.js';

export type ReminderM1Stage = 'create' | 'update_title' | 'update_body' | 'update_due' | 'complete' | 'verify' | 'cleanup';
export interface ReminderM1Event {
  probeId: string;
  stage: ReminderM1Stage;
  status: 'started' | 'succeeded' | 'failed';
  at: number;
  durationMs?: number;
  stableId?: string;
}
export interface DiagnosticRunner {
  run(operation: ScriptOperation, payload?: Record<string, unknown>): Promise<unknown>;
}

const stableIdResult = z.object({ stableId: z.string().min(1).max(512) }).strict();
const verifyResult = z.object({ verified: z.boolean() }).strict();
const cleanupResult = z.object({
  status: z.enum(['not_found', 'removed_verified', 'ambiguous', 'outcome_unknown']),
  stableId: z.string().min(1).max(512).nullable(),
}).strict();

const stages: ReadonlyArray<[ReminderM1Stage, ScriptOperation]> = [
  ['update_title', 'diagnostics.remindersM1UpdateTitle'],
  ['update_body', 'diagnostics.remindersM1UpdateBody'],
  ['update_due', 'diagnostics.remindersM1UpdateDue'],
  ['complete', 'diagnostics.remindersM1Complete'],
];

/** Runs bounded native phases and reports only stage metadata; writes are never replayed. */
export async function runReminderM1Diagnostic(
  runner: DiagnosticRunner,
  containerId: string,
  onEvent: (event: ReminderM1Event) => void = () => {},
  now: () => number = Date.now,
  retainedProbeId: string = randomUUID(),
): Promise<{ probeId: string; stableId: string; cleanup: z.infer<typeof cleanupResult> }> {
  if (!containerId || containerId.length > 512) throw new ConnectorError('invalid_request', 'A valid Reminders list ID is required.');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(retainedProbeId)) {
    throw new ConnectorError('invalid_request', 'A valid retained probe UUID is required.');
  }
  const probeId = retainedProbeId;
  let stableId: string | undefined;
  let primaryError: unknown;
  const call = async <T>(stage: ReminderM1Stage, operation: ScriptOperation, payload: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => {
    const startedAt = now();
    onEvent({ probeId, stage, status: 'started', at: startedAt, ...(stableId ? { stableId } : {}) });
    try {
      const result = schema.parse(await runner.run(operation, payload));
      if (stage === 'create' && result && typeof result === 'object' && 'stableId' in result && typeof result.stableId === 'string') {
        stableId = result.stableId;
      }
      onEvent({ probeId, stage, status: 'succeeded', at: now(), durationMs: Math.max(0, now() - startedAt), ...(stableId ? { stableId } : {}) });
      return result;
    } catch (error) {
      onEvent({ probeId, stage, status: 'failed', at: now(), durationMs: Math.max(0, now() - startedAt), ...(stableId ? { stableId } : {}) });
      throw error;
    }
  };
  try {
    const created = await call('create', 'diagnostics.remindersM1Create', { containerId, probeId }, stableIdResult);
    stableId = created.stableId;
    for (const [stage, operation] of stages) {
      await call(stage, operation, { containerId, probeId, nativeId: stableId }, stableIdResult);
    }
    const verification = await call('verify', 'diagnostics.remindersM1Verify', { containerId, probeId, nativeId: stableId }, verifyResult);
    if (!verification.verified) throw new ConnectorError('outcome_unknown', 'M1 probe state could not be verified.');
  } catch (error) {
    primaryError = error;
  }
  let cleanup: z.infer<typeof cleanupResult>;
  try {
    cleanup = await call('cleanup', 'diagnostics.remindersDeleteM1Probe', { containerId, probeId, ...(stableId ? { nativeId: stableId } : {}) }, cleanupResult);
  } catch (error) {
    if (primaryError) throw new ConnectorError('outcome_unknown', 'M1 probe failed and cleanup outcome is unknown.');
    throw error;
  }
  if (primaryError) throw primaryError;
  if (cleanup.status !== 'removed_verified') throw new ConnectorError('outcome_unknown', 'M1 probe cleanup could not be verified.');
  return { probeId, stableId: stableId!, cleanup };
}
