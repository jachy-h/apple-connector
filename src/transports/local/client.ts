import { request } from 'node:http';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { ConnectorError } from '../../application/errors.js';
import type { RpcMethod, RpcResponse } from './rpc.js';

export interface ServiceClient {
  request(method: RpcMethod, params: Record<string, unknown> | undefined, token: string): Promise<unknown>;
}

/** Client for the loopback Unix-domain-socket JSON RPC port. */
export class HttpServiceClient implements ServiceClient {
  constructor(private readonly socketPath: string, private readonly timeoutMs = 5_000) {}

  request(method: RpcMethod, params: Record<string, unknown> | undefined, token: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ method, params: params ?? {} });
      const req: ClientRequest = request({
        socketPath: this.socketPath, path: '/rpc', method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${token}`,
        },
        timeout: this.timeoutMs,
      }, (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          let response: RpcResponse;
          try { response = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcResponse; }
          catch { return reject(new ConnectorError('service_unavailable', 'Malformed service response.')); }
          if (!response.ok) reject(new ConnectorError(response.error.code, response.error.message));
          else resolve(response.result);
        });
        res.on('error', () => reject(new ConnectorError('service_unavailable', 'Local service connection failed.')));
      });
      req.on('timeout', () => req.destroy(new ConnectorError('service_unavailable', 'Local service did not respond.')));
      req.on('error', (error) => {
        const cause = (error as NodeJS.ErrnoException).code;
        if (cause === 'ENOENT' || cause === 'ECONNREFUSED') {
          reject(new ConnectorError('service_unavailable', 'Service is not running. Run `apple-connector start`.'));
        } else if (error instanceof ConnectorError) reject(error);
        else reject(new ConnectorError('service_unavailable', 'Local service connection failed.'));
      });
      req.end(body);
    });
  }
}