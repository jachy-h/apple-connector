import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpServiceClient } from '../local/client.js';
import { rpcFail, rpcOk } from '../local/rpc.js';
import type { RpcMethod } from '../local/rpc.js';
import { readAdminToken, statePaths, writeClientToken } from '../local/paths.js';
import { AdminWebServer } from './server.js';

const paths = statePaths();
const expiresAt = Number.parseInt(process.env.APPLE_CONNECTOR_WEB_EXPIRES_AT ?? '', 10);
if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('Invalid management web expiry.');
const token = readAdminToken(paths);
const client = new HttpServiceClient(paths.socket);
const facade = { async management(method: RpcMethod, params: unknown) {
  try {
    const request = (params ?? {}) as Record<string, unknown>;
    if (method === 'clients.create') {
      const onboardingId = typeof request.onboardingId === 'string' ? request.onboardingId : undefined;
      const { onboardingId: _onboardingId, ...clientRequest } = request;
      const created = await client.request(method, clientRequest, token) as { client: { id: string; name: string }; token: string };
      const credentialDir = `${paths.dir}/profiles`;
      mkdirSync(credentialDir, { recursive: true, mode: 0o700 });
      try { chmodSync(credentialDir, 0o700); } catch { /* best effort */ }
      const credentialFile = `${credentialDir}/${created.client.id}.token`;
      writeClientToken(credentialFile, created.token);
      if (onboardingId) await client.request('onboarding.complete', { id: onboardingId, clientId: created.client.id, credentialFile }, token);
      return rpcOk({ client: created.client, credentialFile });
    }
    if (method === 'clients.rotate') {
      const rotated = await client.request(method, request, token) as { client: { id: string; name: string }; token: string };
      const credentialFile = `${paths.dir}/profiles/${rotated.client.id}.token`;
      try { rmSync(credentialFile, { force: true }); } catch { /* best effort */ }
      writeClientToken(credentialFile, rotated.token);
      return rpcOk({ client: rotated.client, credentialFile });
    }
    return rpcOk(await client.request(method, request, token));
  }
  catch (error) { return rpcFail(error); }
} };
const management = new AdminWebServer({ facade, staticRoot: fileURLToPath(new URL('../../../web', import.meta.url)), expiresAt, controlToken: token });
let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try { await management.close(); } finally {
    try { rmSync(paths.webPidFile, { force: true }); } catch { /* best effort */ }
    try { rmSync(paths.adminUrlFile, { force: true }); } catch { /* best effort */ }
    try { rmSync(paths.webExpiresAtFile, { force: true }); } catch { /* best effort */ }
  }
}
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
const url = await management.listen();
writeFileSync(paths.adminUrlFile, `${url}\n`, { mode: 0o600 });
writeFileSync(paths.webPidFile, `${process.pid}\n`, { mode: 0o600 });
writeFileSync(paths.webExpiresAtFile, `${expiresAt}\n`, { mode: 0o600 });
for (const file of [paths.adminUrlFile, paths.webPidFile, paths.webExpiresAtFile]) try { chmodSync(file, 0o600); } catch { /* best effort */ }
const wait = setTimeout(() => { void shutdown().then(() => process.exit(0)); }, Math.max(1, expiresAt - Date.now()));
wait.unref();
