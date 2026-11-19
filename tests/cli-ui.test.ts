import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUi, resolveColorEnabled, type StatusHuman } from '../src/cli/ui.js';

const stripAnsi = (value: string): string => value.replace(/\u001B\[[0-9;]*m/g, '');

const statusValue: StatusHuman = {
  running: true, pid: 42, version: '0.17.0', paths: { dir: '/tmp/apple-connector' },
  dbBytes: 1024, clients: 2, operations: 3, adminTokenFileExists: true,
  managementAddress: 'http://127.0.0.1:4567', helper: { running: true, pid: 43, socket: '/tmp/apple-connector/helper.sock' }, health: { healthy: true },
};

test('color is enabled only for human TTY output without an explicit opt-out', () => {
  assert.equal(resolveColorEnabled({ json: false, noColor: false, colorSupported: true }), true);
  assert.equal(resolveColorEnabled({ json: true, noColor: false, colorSupported: true }), false);
  assert.equal(resolveColorEnabled({ json: false, noColor: true, colorSupported: true }), false);
  assert.equal(resolveColorEnabled({ json: false, noColor: false, colorSupported: false }), false);
});

test('help offers an overview and detailed topics while keeping a plain-text mode', () => {
  const plain = createUi(false);
  const overview = plain.help([]);
  assert.ok(overview);
  assert.match(overview, /Apple Connector 0\.17\.0/);
  assert.match(overview, /calendar create/);
  assert.match(overview, /reminder patch/);
  assert.match(overview, /init/);
  assert.match(overview, /auth verify/);
  assert.doesNotMatch(overview, /^\s+setup\s/m);
  assert.match(overview, /--idempotency-key/);
  assert.doesNotMatch(overview, /\u001B\[/);

  const detail = plain.help(['calendar', 'create']);
  assert.ok(detail);
  assert.match(detail, /--calendar-id/);
  assert.match(detail, /--idempotency-key/);
  assert.match(detail, /Examples/);
  const verifyHelp = plain.help(['auth', 'verify']);
  assert.ok(verifyHelp);
  assert.match(verifyHelp, /--agent <name>/);
  assert.equal(plain.help(['calendar', 'missing']), undefined);

  const colored = createUi(true).help([]);
  assert.ok(colored);
  assert.match(colored, /\u001B\[/);
  assert.equal(stripAnsi(colored), overview);
});

test('version prints a single human line and remains JSON-compatible', () => {
  assert.equal(createUi(false).version(), 'apple-connector 0.17.0');
  assert.equal(createUi(true).version(), '\u001B[1mapple-connector\u001B[22m \u001B[32m0.17.0\u001B[39m');
});

test('JSON output is valid plain text without color and only token-colored with color', () => {
  const value = { ok: true, label: 'hello "world"', count: 12, enabled: false, missing: null as null };
  const plain = createUi(false).json(value);
  assert.equal(plain, JSON.stringify(value, null, 2));
  assert.doesNotMatch(plain, /\u001B\[/);

  const colored = createUi(true).json(value);
  assert.match(colored, /\u001B\[/);
  assert.equal(stripAnsi(colored), plain);
});

test('status renders labeled service, health and database details', () => {
  const text = createUi(false).status(statusValue);
  assert.match(text, /Apple Connector 0\.17\.0/);
  assert.match(text, /Service\s+running \(pid 42\)/);
  assert.match(text, /Helper\s+running \(pid 43\)/);
  assert.match(text, /Health\s+healthy/);
  assert.match(text, /Database\s+1\.0 KB/);
  assert.match(text, /Management\s+http:\/\/127\.0\.0\.1:4567/);
});

test('management output includes the loopback URL and never invents secrets', () => {
  const text = createUi(false).open({
    url: 'http://127.0.0.1:4567/?bootstrap=opaque', expiresAt: Date.now() + 60_000,
    remainingSeconds: 60, section: 'setup',
  });
  assert.match(text, /http:\/\/127\.0\.0\.1:4567/);
  assert.match(text, /Section\s+setup/);
  assert.match(text, /1m 00s/);
});

test('init output points the user at the management page and Agent prompt', () => {
  const text = createUi(false).init({
    url: 'http://127.0.0.1:4567/?bootstrap=opaque', expiresAt: Date.now() + 60_000,
    remainingSeconds: 60, section: 'setup',
  });
  assert.match(text, /Apple Connector page ready/);
  assert.match(text, /http:\/\/127\.0\.0\.1:4567/);
  assert.match(text, /Agent prompt/);
  assert.match(text, /1m 00s/);
});

test('auth output shows the Agent binding without printing credentials', () => {
  const ui = createUi(false);
  const unbound = ui.authShow({
    name: 'Calendar Agent', grants: [], expiresAt: Date.UTC(2027, 0, 2), lastUsedAt: null,
    agentName: null, verifiedAt: null,
  });
  assert.match(unbound, /Agent\s+never/);
  assert.match(unbound, /Verified\s+never/);

  const bound = ui.authShow({
    name: 'Calendar Agent', grants: [], expiresAt: Date.UTC(2027, 0, 2), lastUsedAt: Date.UTC(2026, 0, 2),
    agentName: 'Claude Code', verifiedAt: Date.UTC(2026, 0, 3),
  });
  assert.match(bound, /Agent\s+Claude Code/);
  assert.match(bound, /Verified\s+2026-01-03T00:00:00\.000Z/);

  const verified = ui.authVerify({
    name: 'Calendar Agent', agentName: 'Claude Code', verifiedAt: Date.UTC(2026, 0, 3), expiresAt: Date.UTC(2027, 0, 2),
  });
  assert.match(verified, /Authorization verified/);
  assert.match(verified, /Claude Code/);
  assert.match(verified, /management page/);
});

test('human errors carry the code and a help hint without overriding the exit contract', () => {
  const text = createUi(false).error({ code: 'invalid_request', message: 'Missing required --id.' });
  assert.match(text, /error \[invalid_request\] Missing required --id\./);
  assert.match(text, /apple-connector help/);
  assert.doesNotMatch(text, /\u001B\[/);
  assert.doesNotMatch(createUi(false).error({ code: 'service_unavailable', message: 'Down.' }), /apple-connector help/);
});
