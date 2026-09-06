import { statSync } from 'node:fs';
import { Store } from '../storage/database.js';

export const MAINTENANCE_INTERVAL_MS = 60_000;

export interface MaintenanceResult {
  databaseBytes: number | null;
  completedAt: number;
}

/** Run bounded retention work. Unknown/executing operations are intentionally preserved by Store. */
export function runMaintenance(store: Store, databasePath: string, now = Date.now()): MaintenanceResult {
  store.pruneOperations(now);
  store.pruneAudit(now);
  let databaseBytes: number | null = null;
  try { databaseBytes = statSync(databasePath).size; } catch { /* In-memory/test databases have no file. */ }
  return { databaseBytes, completedAt: now };
}

/** Schedule maintenance without keeping the service process alive on its own. */
export function scheduleMaintenance(
  store: Store,
  databasePath: string,
  onError: (error: unknown) => void,
  intervalMs = MAINTENANCE_INTERVAL_MS,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    try { runMaintenance(store, databasePath); } catch (error) { onError(error); }
  }, intervalMs);
  timer.unref();
  return timer;
}
