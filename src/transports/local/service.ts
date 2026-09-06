import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { chmodSync, unlinkSync } from 'node:fs';
import { ConnectorError } from '../../application/errors.js';
import type { ReminderWriter } from '../../providers/reminders/types.js';
import type { NoteWriter } from '../../providers/notes/types.js';
import { rpcEnvelopeSchema } from './rpc.js';
import type { RpcEnvelope, RpcResponse } from './rpc.js';
import { ServiceFacade } from './handlers.js';

/**
 * The M0 gate is not passed, so no native adapter is wired into the running service.
 * Every mutation is refused before reaching Apple instead of pretending a capability exists.
 */
export const m0GateWriter: ReminderWriter = {
  preflight: async () => {
    throw new ConnectorError('service_unavailable', 'Native adapter is not connected; the M0 capability gate has not passed.');
  },
  create: async () => {
    throw new ConnectorError('service_unavailable', 'Native adapter is not connected; the M0 capability gate has not passed.');
  },
  verify: async () => false,
};

export const m0GateNoteWriter: NoteWriter = {
  preflight: async () => { throw new ConnectorError('service_unavailable', 'Native adapter is not connected; the M0 capability gate has not passed.'); },
  create: async () => { throw new ConnectorError('service_unavailable', 'Native adapter is not connected; the M0 capability gate has not passed.'); },
  verify: async () => false,
};

export interface LocalServerOptions {
  socketPath: string;
  facade: ServiceFacade;
  onError?: (error: unknown) => void;
}

/** Loopback-only JSON RPC over a filesystem-scoped Unix domain socket. */
export class LocalServer {
  readonly server: Server;
  private constructor(private readonly socketPath: string, server: Server) { this.server = server; }

  static create(options: LocalServerOptions): LocalServer {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('error', () => { res.destroy(); });
      req.on('end', () => {
        const respond = (payload: RpcResponse | { ok: false; error: { code: string; message: string } }, status = 200) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        const body = Buffer.concat(chunks).toString('utf8');
        if (Buffer.byteLength(body) > 1024 * 1024) return respond({ ok: false, error: { code: 'invalid_request', message: 'Request exceeded size limit.' } }, 413);
        let envelope: RpcEnvelope;
        try { envelope = rpcEnvelopeSchema.parse(JSON.parse(body)); }
        catch { return respond({ ok: false, error: { code: 'invalid_request', message: 'Malformed request envelope.' } }, 400); }
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';
        Promise.resolve(options.facade.dispatch(envelope.method, envelope.params, token))
          .then((response) => respond(response)).catch((error) =>
            respond({ ok: false, error: { code: 'service_unavailable', message: String(error) } }, 500));
      });
    });
    return new LocalServer(options.socketPath, server);
  }

  async listen(): Promise<void> {
    try { unlinkSync(this.socketPath); } catch { /* Stale socket from a previous crash; overwritten below. */ }
    await new Promise<void>((resolveListen, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        // The state directory is 0700; keep the socket file itself owner-only as well.
        try { chmodSync(this.socketPath, 0o600); } catch { /* Socket may be unlinked on shutdown; ignore. */ }
        resolveListen();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolveClose) => this.server.close(() => resolveClose()));
    try { unlinkSync(this.socketPath); } catch { /* Already gone. */ }
  }
}
