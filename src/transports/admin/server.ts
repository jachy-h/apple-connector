import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { ConnectorError, publicError } from '../../application/errors.js';
import { capabilities } from '../../application/capabilities.js';
import { safeEqualToken } from '../local/paths.js';
import { adminMethods, rpcMethodSchema } from '../local/rpc.js';
import type { RpcResponse } from '../local/rpc.js';

const MAX_BODY_BYTES = 1024 * 1024;
const BOOTSTRAP_TTL_MS = 10 * 60_000;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
};

interface Session { csrf: string; expiresAt: number; onboardingId?: string }
export interface ManagementFacade { management(method: import('../local/rpc.js').RpcMethod, params: unknown): Promise<RpcResponse> }
export interface AdminWebServerOptions { facade: ManagementFacade; staticRoot: string; expiresAt?: number; controlToken?: string }

/**
 * Loopback-only management site. The startup URL carries a one-time, memory-only bootstrap
 * secret; it immediately becomes an HttpOnly SameSite session cookie and is removed from the URL.
 */
export class AdminWebServer {
  private readonly server: Server;
  private bootstrap: { token: string; onboardingId?: string } | undefined;
  private bootstrapExpiresAt = 0;
  private readonly sessions = new Map<string, Session>();
  private port: number | undefined;

  private readonly expiresAt: number;
  private readonly controlToken: string;
  constructor(private readonly options: AdminWebServerOptions) {
    this.expiresAt = options.expiresAt ?? Date.now() + 60 * 60_000;
    this.controlToken = options.controlToken ?? '';
    this.server = createServer((req, res) => { void this.handle(req, res); });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolveListen, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolveListen());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new ConnectorError('service_unavailable', 'Management site did not bind a TCP port.');
    this.port = address.port;
    return this.managementUrl();
  }

  managementUrl(): string {
    if (!this.port) throw new ConnectorError('service_unavailable', 'Management site is not running.');
    this.assertActive();
    if (!this.bootstrap || Date.now() > this.bootstrapExpiresAt) return this.issueManagementUrl();
    return `http://127.0.0.1:${this.port}/?bootstrap=${encodeURIComponent(this.bootstrap.token)}`;
  }

  /** Issue a fresh one-time login link without disturbing existing browser sessions. */
  issueManagementUrl(onboardingId?: string): string {
    this.assertActive();
    if (!this.port) throw new ConnectorError('service_unavailable', 'Management site is not running.');
    this.bootstrap = { token: randomBytes(32).toString('base64url'), ...(onboardingId ? { onboardingId } : {}) };
    this.bootstrapExpiresAt = Date.now() + BOOTSTRAP_TTL_MS;
    return `http://127.0.0.1:${this.port}/?bootstrap=${encodeURIComponent(this.bootstrap.token)}`;
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolveClose) => this.server.close(() => resolveClose()));
  }

  private origin(): string { return `http://127.0.0.1:${this.port}`; }
  private assertActive(): void {
    if (Date.now() >= this.expiresAt) throw new ConnectorError('service_unavailable', 'Management session expired. Run apple-connector open again.');
  }
  private validHost(req: IncomingMessage): boolean { return req.headers.host === `127.0.0.1:${this.port}`; }
  private cleanSessions(): void {
    const now = Date.now(); for (const [id, session] of this.sessions) if (session.expiresAt <= now || now >= this.expiresAt) this.sessions.delete(id);
  }
  private session(req: IncomingMessage): Session | undefined {
    this.cleanSessions();
    const pair = req.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith('ac_admin_session='));
    const id = pair?.slice('ac_admin_session='.length);
    return id ? this.sessions.get(id) : undefined;
  }
  private reject(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
  }
  private async body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; let total = 0;
    for await (const chunk of req) {
      total += Buffer.byteLength(chunk); if (total > MAX_BODY_BYTES) throw new ConnectorError('invalid_request', 'Request exceeded size limit.');
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ConnectorError('invalid_request', 'Malformed JSON request.'); }
  }
  private sendJson(res: ServerResponse, value: unknown, status = 200): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(value));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.validHost(req)) return this.reject(res, 403, 'Invalid Host header.');
    const url = new URL(req.url ?? '/', this.origin());
    if (req.method === 'POST' && url.pathname === '/control/issue') {
      if (!safeEqualToken(req.headers.authorization?.replace(/^Bearer\s+/i, '').trim(), this.controlToken)) return this.reject(res, 403, 'Invalid control credential.');
      const onboardingId = url.searchParams.get('onboardingId') ?? undefined;
      if (onboardingId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(onboardingId)) return this.reject(res, 400, 'Invalid onboarding ID.');
      try { return this.sendJson(res, { url: this.issueManagementUrl(onboardingId), expiresAt: this.expiresAt, remainingSeconds: Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000)) }); }
      catch (error) { return this.sendJson(res, { error: publicError(error) }, 410); }
    }
    if (Date.now() >= this.expiresAt) return this.reject(res, 410, 'Management session expired. Run apple-connector open again.');
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('bootstrap')) {
      const candidate = url.searchParams.get('bootstrap') ?? '';
      if (!this.bootstrap || Date.now() > this.bootstrapExpiresAt || !safeEqualToken(candidate, this.bootstrap.token)) return this.reject(res, 403, 'Management link expired.');
      const id = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      this.sessions.set(id, { csrf, expiresAt: this.expiresAt, ...(this.bootstrap.onboardingId ? { onboardingId: this.bootstrap.onboardingId } : {}) });
      this.bootstrap = undefined;
      res.writeHead(303, { location: '/', 'set-cookie': `ac_admin_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((this.expiresAt - Date.now()) / 1000))}`, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const session = this.session(req);
    if (!session) return this.reject(res, 401, 'Management session required.');
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') return this.sendJson(res, { csrf: session.csrf, capabilities: capabilities(), expiresAt: this.expiresAt, remainingSeconds: Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000)), ...(session.onboardingId ? { onboardingId: session.onboardingId } : {}) });
    if (req.method === 'POST' && url.pathname === '/api/rpc') {
      if (req.headers.origin !== this.origin() || !safeEqualToken(req.headers['x-csrf-token'], session.csrf)) return this.reject(res, 403, 'CSRF validation failed.');
      let request: { method?: unknown; params?: unknown };
      try {
        request = await this.body(req) as { method?: unknown; params?: unknown };
        rpcMethodSchema.parse(request.method);
      } catch (error) { return this.sendJson(res, { ok: false, error: publicError(error) }, 400); }
      const method = rpcMethodSchema.parse(request.method);
      if (!adminMethods.has(method)) return this.sendJson(res, { ok: false, error: publicError(new ConnectorError('permission_denied', 'This method is not available to management UI.')) });
      if (method === 'clients.create' && session.onboardingId && request.params && typeof request.params === 'object' && !Array.isArray(request.params)) request.params = { ...(request.params as Record<string, unknown>), onboardingId: session.onboardingId };
      return this.sendJson(res, await this.options.facade.management(method, request.params));
    }
    if (req.method !== 'GET') return this.reject(res, 405, 'Method not allowed.');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const root = resolve(this.options.staticRoot);
    const target = resolve(root, relative);
    if (!(target === root || target.startsWith(`${root}${sep}`)) || !existsSync(target)) return this.reject(res, 404, 'Not found.');
    try {
      const extension = target.slice(target.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': MIME[extension] ?? 'application/octet-stream', 'cache-control': extension === '.html' ? 'no-store' : 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      res.end(readFileSync(target));
    } catch { this.reject(res, 500, 'Could not load management assets.'); }
  }
}
