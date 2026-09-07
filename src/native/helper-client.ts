import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConnectorError } from '../application/errors.js';

const VERSION = 1;
const MAX_LINE = 1_048_576;
type Reply = { version: number; id: string; ok: boolean; result?: unknown; error?: { code?: string; message?: string } };
type Pending = { resolve(value: unknown): void; reject(reason: unknown): void; timer: NodeJS.Timeout };

/** A bounded, single-helper JSONL client. It never retries a sent mutation. */
export class EventKitHelperClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = '';
  private pending = new Map<string, Pending>();
  private starting: Promise<void> | undefined;
  private stopped = false;
  constructor(private readonly executable = fileURLToPath(new URL('../../native/apple-connector-helper', import.meta.url)), private readonly maxInFlight = 32) {}

  async call(action: string, payload: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (this.stopped) throw new ConnectorError('service_unavailable', 'EventKit helper is stopping.');
    if (this.pending.size >= this.maxInFlight) throw new ConnectorError('service_unavailable', 'EventKit helper is busy; retry later.');
    await this.start();
    const id = randomUUID();
    const line = JSON.stringify({ version: VERSION, id, action, payload });
    if (Buffer.byteLength(line) > MAX_LINE) throw new ConnectorError('invalid_request', 'Native request is too large.');
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ConnectorError('outcome_unknown', 'EventKit helper did not respond; write result may be unknown.')); }, timeoutMs).unref();
      this.pending.set(id, { resolve, reject, timer });
      const stdin = this.child?.stdin;
      if (!stdin) { this.pending.delete(id); clearTimeout(timer); reject(new ConnectorError('service_unavailable', 'EventKit helper exited before receiving the request.')); return; }
      if (!stdin.write(`${line}\n`)) stdin.once('drain', () => undefined);
    });
  }

  async close(): Promise<void> {
    this.stopped = true;
    const child = this.child; this.child = undefined;
    if (!child) return;
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2_000).unref(); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.stdin.end(); });
  }

  private async start(): Promise<void> {
    if (this.child) return;
    if (!this.starting) this.starting = this.launch().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async launch(): Promise<void> {
    try { accessSync(this.executable, constants.X_OK); } catch { throw new ConnectorError('service_unavailable', 'EventKit helper is not installed. Run the native build before starting the connector.'); }
    const child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'] }); this.child = child;
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.on('error', () => this.failAll(new ConnectorError('service_unavailable', 'EventKit helper could not start.')));
    child.on('exit', () => { if (this.child === child) this.child = undefined; this.failAll(new ConnectorError('service_unavailable', 'EventKit helper exited.')); });
    try { await this.callHello(); }
    catch (error) { if (this.child === child) this.child = undefined; child.kill(); throw error; }
  }
  private async callHello(): Promise<void> { const value = await this.callAfterLaunch('hello', {}); if (!value || typeof value !== 'object' || (value as { protocolVersion?: unknown }).protocolVersion !== VERSION) throw new ConnectorError('protocol_error', 'EventKit helper protocol is incompatible.'); }
  private callAfterLaunch(action: string, payload: Record<string, unknown>): Promise<unknown> { const id = randomUUID(); return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new ConnectorError('service_unavailable', 'EventKit helper handshake timed out.')); }, 5_000).unref(); this.pending.set(id, { resolve, reject, timer }); this.child!.stdin.write(`${JSON.stringify({ version: VERSION, id, action, payload })}\n`); }); }
  private onData(chunk: string): void { this.buffer += chunk; if (Buffer.byteLength(this.buffer) > MAX_LINE * 2) { this.child?.kill(); return; } let index; while ((index = this.buffer.indexOf('\n')) >= 0) { const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1); try { this.onReply(JSON.parse(line) as Reply); } catch { this.child?.kill(); } } }
  private onReply(reply: Reply): void { const pending = this.pending.get(reply.id); if (!pending) return; this.pending.delete(reply.id); clearTimeout(pending.timer); if (reply.version !== VERSION) { pending.reject(new ConnectorError('protocol_error', 'EventKit helper returned an incompatible protocol version.')); return; } if (reply.ok) pending.resolve(reply.result); else pending.reject(new ConnectorError(this.code(reply.error?.code), reply.error?.message ?? 'EventKit helper request failed.')); }
  private code(value: string | undefined): 'invalid_request' | 'permission_denied' | 'service_unavailable' | 'outcome_unknown' | 'protocol_error' { return value === 'invalid_request' || value === 'permission_denied' || value === 'outcome_unknown' || value === 'protocol_error' ? value : 'service_unavailable'; }
  private failAll(error: ConnectorError): void { for (const [id, pending] of this.pending) { this.pending.delete(id); clearTimeout(pending.timer); pending.reject(error); } }
}
