import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ConnectorError } from '../application/errors.js';
import { decodeResponse, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, scriptRegistry } from './protocol.js';
import type { ScriptOperation, ScriptRequest } from './protocol.js';

export interface ProcessRequest {
  executable: string;
  args: string[];
  input: string;
  timeoutMs: number;
  maxOutputBytes: number;
  mutates: boolean;
}
export type ProcessExecutor = (request: ProcessRequest) => Promise<string>;

export const executeProcess: ProcessExecutor = async (request) => new Promise((resolveResult, reject) => {
  const child = spawn(request.executable, request.args, {
    shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let bytes = 0;
  const chunks: Buffer[] = [];
  let failure: ConnectorError | undefined;
  let settled = false;
  const uncertain = (code: 'timeout' | 'protocol_error', message: string) =>
    new ConnectorError(request.mutates ? 'outcome_unknown' : code, message);
  const abort = (error: ConnectorError) => {
    if (failure) return;
    failure = error;
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => abort(uncertain('timeout', 'Native operation timed out.')), request.timeoutMs);
  const finish = (error?: ConnectorError) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error); else resolveResult(Buffer.concat(chunks).toString('utf8').trim());
  };
  child.on('error', () => finish(new ConnectorError('service_unavailable', 'Cannot launch native runtime.')));
  child.stdin.on('error', () => abort(uncertain('protocol_error', 'Native input channel failed.')));
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > request.maxOutputBytes) abort(uncertain('protocol_error', 'Native output exceeded limit.'));
    else chunks.push(chunk);
  });
  // Count and discard stderr: Apple errors may include private data.
  child.stderr.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > request.maxOutputBytes) abort(uncertain('protocol_error', 'Native output exceeded limit.'));
  });
  child.on('close', (code) => finish(failure ?? (code === 0 ? undefined :
    uncertain('protocol_error', 'Native runtime exited unsuccessfully.'))));
  child.stdin.end(request.input);
});

export class JxaRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(
    private readonly executor: ProcessExecutor = executeProcess,
    private readonly scriptRoot = fileURLToPath(new URL('../../../scripts/jxa/', import.meta.url)),
  ) {}

  run(operation: ScriptOperation, payload: Record<string, unknown> = {}): Promise<unknown> {
    // Runtime validation is necessary even with a TypeScript union.
    if (!Object.hasOwn(scriptRegistry, operation)) {
      return Promise.reject(new ConnectorError('unsupported_operation', 'Unknown native operation.'));
    }
    if (this.queued >= 32) {
      return Promise.reject(new ConnectorError('service_unavailable', 'Native operation queue is full.'));
    }
    const request: ScriptRequest = { protocolVersion: 1, requestId: randomUUID(), operation, payload };
    let input: string;
    try { input = JSON.stringify(request); } catch {
      return Promise.reject(new ConnectorError('invalid_request', 'Input must be JSON serializable.'));
    }
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
      return Promise.reject(new ConnectorError('invalid_request', 'Input exceeded limit.'));
    }
    const script = scriptRegistry[operation];
    this.queued++;
    const work = this.tail.then(async () => {
      const output = await this.executor({
        executable: '/usr/bin/osascript',
        args: ['-l', 'JavaScript', resolve(this.scriptRoot, script.path)],
        input, timeoutMs: 'timeoutMs' in script ? script.timeoutMs : 15_000,
        maxOutputBytes: MAX_OUTPUT_BYTES, mutates: script.mutates,
      });
      return decodeResponse(output, request);
    });
    // Serial execution bounds native concurrency, and a failed call cannot poison the queue.
    const tracked = work.finally(() => { this.queued--; });
    this.tail = tracked.catch(() => undefined);
    return tracked;
  }
}
