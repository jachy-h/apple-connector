import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appVersion } from '../../application/version.js';
import { ConnectorError } from '../../application/errors.js';
import { runMaintenance, scheduleMaintenance } from '../../application/maintenance.js';
import { Store } from '../../storage/database.js';
import { ReminderOperations } from '../../operations/reminders.js';
import { JxaNoteReader } from '../../providers/notes/jxa-reader.js';
import { EventKitReminderProvider } from '../../providers/reminders/eventkit.js';
import { EventKitCalendarReader } from '../../providers/calendar/eventkit.js';
import { ServiceFacade } from './handlers.js';
import { LocalServer } from './service.js';
import { acquireServiceLock, readAdminToken, releaseServiceLock, statePaths } from './paths.js';
import { appendServiceLog } from './logging.js';
import { AdminWebServer } from '../admin/server.js';
import { JxaRunner } from '../../jxa/runner.js';
import { EventKitHelperClient } from '../../native/helper-client.js';
import { WebWrites } from '../../application/web-writes.js';
import { listDiagnosticJournals, loadDiagnosticJournal, recoverJournaledReminderM1Diagnostic, runJournaledReminderM1Diagnostic } from '../../application/diagnostic-journal.js';

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
const eventKitHelper = new EventKitHelperClient();
const reminderWriter = new EventKitReminderProvider(eventKitHelper);
const calendarProvider = new EventKitCalendarReader(eventKitHelper);
const operations = new ReminderOperations(store, reminderWriter);
const webWrites = new WebWrites(store, reminderWriter, undefined, Date.now, calendarProvider);
const diagnosticRunner = new JxaRunner();
const activeDiagnostics = new Map<string, Promise<unknown>>();
const managedDiagnostics = {
  startReminderM1(containerId: string) {
    let created: { probeId: string; containerId: string; createdAt: number } | undefined;
    const work = runJournaledReminderM1Diagnostic(diagnosticRunner, paths.dir, containerId, Date.now, (journal) => { created = journal; });
    if (!created) throw new ConnectorError('service_unavailable', 'Could not create diagnostic journal.');
    activeDiagnostics.set(created.probeId, work);
    void work.then(() => activeDiagnostics.delete(created!.probeId), () => activeDiagnostics.delete(created!.probeId));
    return created;
  },
  listReminderM1() {
    return listDiagnosticJournals(paths.dir).map((journal) => ({ ...journal, active: activeDiagnostics.has(journal.probeId) }));
  },
  recoverReminderM1(probeId: string) {
    const journal = loadDiagnosticJournal(paths.dir, probeId);
    if (activeDiagnostics.has(probeId)) throw new ConnectorError('conflict', 'This diagnostic is still running.');
    const work = recoverJournaledReminderM1Diagnostic(diagnosticRunner, paths.dir, probeId);
    activeDiagnostics.set(probeId, work);
    void work.then(() => activeDiagnostics.delete(probeId), () => activeDiagnostics.delete(probeId));
    return { probeId: journal.probeId, status: 'recovering' };
  },
  async findContainers(name: string) {
    return diagnosticRunner.run('diagnostics.findTestContainers', { name });
  },
  async runProbe() {
    return diagnosticRunner.run('diagnostics.probe');
  },
  async permissionStatus() {
    return eventKitHelper.call('permissions.status', {});
  },
  async requestPermission(provider: 'calendar' | 'reminders') {
    return eventKitHelper.call('permissions.request', { provider }, 65_000);
  },
};
let management: AdminWebServer;
const facade = new ServiceFacade(store, operations, adminToken, appVersion, undefined, new JxaNoteReader(), reminderWriter, calendarProvider, () => management.issueManagementUrl(), managedDiagnostics, webWrites);
const server = LocalServer.create({ socketPath: paths.socket, facade });
management = new AdminWebServer({ facade, staticRoot: fileURLToPath(new URL('../../../web', import.meta.url)) });

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
  try { await eventKitHelper.close(); } catch { /* Best effort. */ }
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
  // Attempt native warm-up before advertising RPC. A failed warm-up is provider degradation,
  // not a reason to hide the management service that the user needs for permission recovery.
  try { await eventKitHelper.call('permissions.status', {}); }
  catch (error) { log(`EventKit helper warm-up failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
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
