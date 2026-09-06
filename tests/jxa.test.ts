import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JxaRunner, executeProcess } from '../src/jxa/runner.js';
import type { ProcessRequest } from '../src/jxa/runner.js';
import { decodeResponse } from '../src/jxa/protocol.js';
import type { ScriptRequest, ScriptOperation } from '../src/jxa/protocol.js';
import { publicError } from '../src/application/errors.js';

const request: ScriptRequest = { protocolVersion: 1, requestId: 'test', operation: 'diagnostics.probe', payload: {} };
const response = (req: ScriptRequest, result: unknown = {}) => JSON.stringify({ ...req, ok: true, result });

test('content is serialized as data on stdin, never script source or argv', async () => {
  const payload = { text: '\"\n中文😀 $(touch /tmp/never) `id` ; Application("Notes").delete()' };
  let invocation: ProcessRequest | undefined;
  const runner = new JxaRunner(async (req) => {
    invocation = req;
    const envelope = JSON.parse(req.input) as ScriptRequest;
    assert.deepEqual(envelope.payload, payload);
    return response(envelope, { echoed: payload.text });
  });
  assert.deepEqual(await runner.run('diagnostics.probe', payload), { echoed: payload.text });
  assert.equal(invocation?.executable, '/usr/bin/osascript');
  assert.equal(invocation?.args.length, 3);
  assert.ok(!invocation?.args.join(' ').includes(payload.text));
});

test('rejects unknown operations, oversized input and malformed responses', async () => {
  const runner = new JxaRunner(async () => { throw new Error('must not execute'); });
  await assert.rejects(runner.run('../../evil' as ScriptOperation), { code: 'unsupported_operation' });
  await assert.rejects(runner.run('diagnostics.probe', { text: 'x'.repeat(300_000) }), { code: 'invalid_request' });
  for (const raw of ['null', '{}', 'invalid', response({ ...request, requestId: 'other' })]) {
    assert.throws(() => decodeResponse(raw, request), { code: 'protocol_error' });
  }
});

test('serializes native calls and continues after failure', async () => {
  let active = 0;
  let count = 0;
  const runner = new JxaRunner(async (req) => {
    active++;
    assert.equal(active, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (count++ === 0) throw new Error('first failed');
    return response(JSON.parse(req.input) as ScriptRequest);
  });
  const results = await Promise.allSettled([runner.run('diagnostics.probe'), runner.run('diagnostics.probe')]);
  assert.equal(results[0]?.status, 'rejected');
  assert.equal(results[1]?.status, 'fulfilled');
});

test('native queue rejects excess work without growing indefinitely', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runner = new JxaRunner(async (req) => {
    await gate;
    return response(JSON.parse(req.input) as ScriptRequest);
  });
  const pending = Array.from({ length: 32 }, () => runner.run('diagnostics.probe'));
  await assert.rejects(runner.run('diagnostics.probe'), { code: 'service_unavailable' });
  release();
  await Promise.all(pending);
  await runner.run('diagnostics.probe');
});

test('subprocess output is bounded and timed-out writes are uncertain', async () => {
  const base = { executable: process.execPath, input: '', timeoutMs: 2_000, maxOutputBytes: 100, mutates: false };
  await assert.rejects(executeProcess({ ...base, args: ['-e', 'process.stdout.write("x".repeat(1000))'] }), { code: 'protocol_error' });
  await assert.rejects(executeProcess({ ...base, timeoutMs: 50, mutates: true, args: ['-e', 'setTimeout(()=>{},5000)'] }), { code: 'outcome_unknown' });
  await assert.rejects(executeProcess({ ...base, args: ['-e', 'process.exit(1)'], mutates: true }), { code: 'outcome_unknown' });
});

test('raw native diagnostics are not returned as public errors', () => {
  const raw = JSON.stringify({ ...request, ok: false, error: { code: 'internal', message: 'SECRET BODY' } });
  try { decodeResponse(raw, request); } catch (error) {
    assert.ok(!JSON.stringify(publicError(error)).includes('SECRET'));
  }
  assert.ok(!JSON.stringify(publicError(new Error('SECRET TOKEN'))).includes('SECRET'));
});
