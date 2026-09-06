import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appVersion } from '../../application/version.js';
import { ConnectorError } from '../../application/errors.js';
import { runMaintenance, scheduleMaintenance } from '../../application/maintenance.js';
import { Store } from '../../storage/database.js';
import { ReminderOperations } from '../../operations/reminders.js';
import { NoteOperations } from '../../operations/notes.js';
import { JxaNoteReader } from '../../providers/notes/jxa-reader.js';
import { JxaReminderReader } from '../../providers/reminders/jxa-reader.js';
import { JxaCalendarReader } from '../../providers/calendar/jxa-reader.js';
import { JxaReminderWriter } from '../../providers/reminders/jxa-writer.js';
import { JxaNoteWriter } from '../../providers/notes/jxa-writer.js';
import { ServiceFacade } from './handlers.js';
import { LocalServer } from './service.js';
import { acquireServiceLock, readAdminToken, releaseServiceLock, statePaths } from './paths.js';
import { appendServiceLog } from './logging.js';
import { AdminWebServer } from '../admin/server.js';

const paths = statePaths();
const adminToken = readAdminToken(paths);

let store: Store;
try {
  acquireServiceLock(paths);
  store = new Store(paths.db);
} catch (error) {
  releaseServiceLock(paths);
  // A concurrent launcher is expected to observe the first service becoming ready.
  if (error instanceof ConnectorError && error.code === 'conflict') process.exit(0);
  throw error;
}
// Native creation was validated only for the narrow adapters below. Calendar writes and existing
// reminder mutations remain gated until their independent support checks are complete.
const operations = new ReminderOperations(store, new JxaReminderWriter());
const notes = new NoteOperations(store, new JxaNoteWriter());
const facade = new ServiceFacade(store, operations, adminToken, appVersion, notes, new JxaNoteReader(), new JxaReminderReader(), new JxaCalendarReader());
const server = LocalServer.create({ socketPath: paths.socket, facade });
const management = new AdminWebServer({ facade, staticRoot: fileURLToPath(new URL('../../../web', import.meta.url)) });

function log(message: string): void {
  appendServiceLog(paths.logFile, message);
}

let stopping = false;
let maintenanceTimer: NodeJS.Timeout | undefined;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  log('shutting down');
  try { await server.close(); } catch { /* Best effort. */ }
  try { await management.close(); } catch { /* Best effort. */ }
  try { store.close(); } catch { /* Best effort. */ }
  try { rmSync(paths.pidFile, { force: true }); } catch { /* Best effort. */ }
  try { rmSync(paths.adminUrlFile, { force: true }); } catch { /* Best effort. */ }
  releaseServiceLock(paths);
  log('stopped');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });

try {
  const managementUrl = await management.listen();
  writeFileSync(paths.adminUrlFile, `${managementUrl}\n`, { mode: 0o600 });
  try { chmodSync(paths.adminUrlFile, 0o600); } catch { /* Best effort. */ }
  await server.listen();
  writeFileSync(paths.pidFile, `${process.pid}\n`, { mode: 0o600 });
  try { chmodSync(paths.pidFile, 0o600); } catch { /* Best effort. */ }
  log(`listening on ${paths.socket} (pid ${process.pid}); management site ready on loopback`);
  const result = runMaintenance(store, paths.db);
  log(`maintenance completed (database bytes: ${result.databaseBytes ?? 'unknown'})`);
} catch (error) {
  log(`fatal: ${String(error)}`);
  try { await management.close(); } catch { /* Best effort. */ }
  store.close();
  try { rmSync(paths.adminUrlFile, { force: true }); } catch { /* Best effort. */ }
  releaseServiceLock(paths);
  process.exit(1);
}

maintenanceTimer = scheduleMaintenance(store, paths.db, (error) => log(`maintenance failed: ${String(error)}`));

// Stale pid without a live socket means the service is gone; clean up.
setInterval(() => {
  if (!existsSync(paths.socket)) {
    log('socket disappeared; unhealthy shutdown');
    rmSync(paths.pidFile, { force: true });
    void shutdown();
  }
}, 15_000).unref();
