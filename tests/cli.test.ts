import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appVersion } from '../src/application/version.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const stateDir = mkdtempSync(join(tmpdir(), 'apple-connector-cli-'));
after(() => rmSync(stateDir, { recursive: true, force: true }));
const baseEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', APPLE_CONNECTOR_STATE_DIR: stateDir };
delete baseEnv.FORCE_COLOR;

function run(args: string[], env: NodeJS.ProcessEnv = baseEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('help is a first-class command with detailed topics', () => {
  const overview = run(['help']);
  assert.equal(overview.status, 0);
  assert.match(overview.stdout, /Apple Connector/);
  assert.match(overview.stdout, /Service/);
  assert.match(overview.stdout, /calendar create/);
  assert.match(overview.stdout, /reminder patch/);
  assert.doesNotMatch(overview.stdout, /\u001B\[/);
  assert.equal(overview.stderr, '');

  const detail = run(['help', 'calendar', 'create']);
  assert.equal(detail.status, 0);
  assert.match(detail.stdout, /apple-connector calendar create/);
  assert.match(detail.stdout, /--calendar-id/);
  assert.match(detail.stdout, /--idempotency-key/);
  assert.match(detail.stdout, /Examples/);

  const alias = run(['calendar', 'create', '--help']);
  assert.equal(alias.status, 0);
  assert.equal(alias.stdout, detail.stdout);
});

test('unknown and removed help topics fail as invalid requests with exit code 2', () => {
  for (const topic of ['no-such-topic', 'setup', 'agent init-status']) {
    const result = run(['help', topic]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`Unknown help topic: ${topic}`));
    assert.match(result.stderr, /apple-connector help/);
    assert.doesNotMatch(result.stderr, /\u001B\[/);
  }
  const overview = run(['help']);
  assert.match(overview.stdout, /First-time setup/);
  assert.doesNotMatch(overview.stdout, /^\s+setup\s/m);
  assert.doesNotMatch(overview.stdout, /agent init-status/);
});

test('version keeps a human line and the versioned JSON envelope', () => {
  for (const args of [['version'], ['--version'], ['-v']]) {
    const result = run(args);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `apple-connector ${appVersion}\n`);
  }
  const payload = run(['version', '--json']);
  assert.equal(payload.status, 0);
  assert.deepEqual(JSON.parse(payload.stdout), { ok: true, data: { version: appVersion }, meta: { schemaVersion: 2 } });
  assert.doesNotMatch(payload.stdout, /\u001B\[/);
});

test('help --json stays a string payload with no ANSI', () => {
  const overview = JSON.parse(run(['help', '--json']).stdout) as { ok: boolean; data: string; meta: { schemaVersion: number } };
  assert.equal(overview.ok, true);
  assert.equal(overview.meta.schemaVersion, 2);
  assert.match(overview.data, /Usage/);
  assert.doesNotMatch(overview.data, /\u001B\[/);

  const detail = JSON.parse(run(['help', 'reminder', 'patch', '--json']).stdout) as { data: string };
  assert.match(detail.data, /--clear-due/);
  assert.match(detail.data, /--input/);
});

test('--no-color wins even when the caller forces color', () => {
  const forced: NodeJS.ProcessEnv = { ...baseEnv, FORCE_COLOR: '1' };
  delete forced.NO_COLOR;
  const colored = run(['version'], forced);
  assert.match(colored.stdout, /\u001B\[/);
  const plain = run(['version', '--no-color'], forced);
  assert.equal(plain.stdout, `apple-connector ${appVersion}\n`);
  assert.doesNotMatch(plain.stdout, /\u001B\[/);
});

test('JSON output never carries ANSI even when color is forced', () => {
  const forced: NodeJS.ProcessEnv = { ...baseEnv, FORCE_COLOR: '1' };
  delete forced.NO_COLOR;
  const result = run(['help', '--json'], forced);
  assert.doesNotMatch(result.stdout, /\u001B\[/);
});

test('unknown authorization keys fail without leaking a profile path', () => {
  const result = run(['auth', 'show', '--auth-key', 'missing-key', '--json']);
  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout) as { ok: boolean; error: { code: string; message: string } };
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'invalid_request');
  assert.match(payload.error.message, /Unknown authorization key/);
  assert.doesNotMatch(result.stdout, /profiles/);
});

test('authorization keys reject traversal and path separators', () => {
  for (const key of ['../agent', 'profiles/agent', '..']) {
    const result = run(['auth', 'show', '--auth-key', key, '--json']);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout) as { ok: boolean; error: { message: string } };
    assert.equal(payload.ok, false);
    assert.match(payload.error.message, /Authorization key is invalid/);
  }
});

test('doctor reports the runtime without starting a service', () => {
  const result = run(['doctor', '--json']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout) as { ok: boolean; data: { version: string; platform: string; native: unknown } };
  assert.equal(payload.ok, true);
  assert.equal(payload.data.version, appVersion);
  assert.equal(payload.data.platform, process.platform);
  assert.equal(payload.data.native, null);
});
