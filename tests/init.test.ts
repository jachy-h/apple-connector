import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('init starts a temporary management session on the default page', (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'apple-connector-init-'));
  const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
  const env = { ...process.env, APPLE_CONNECTOR_STATE_DIR: stateDir, APPLE_CONNECTOR_HELPER_MODE: 'direct' };
  t.after(() => {
    try { const pid = Number.parseInt(readFileSync(join(stateDir, 'web.pid'), 'utf8'), 10); if (Number.isInteger(pid)) process.kill(pid, 'SIGTERM'); } catch { /* Best effort. */ }
    try { execFileSync(process.execPath, [cli, 'stop'], { env, stdio: 'ignore' }); } catch { /* Best effort. */ }
    rmSync(stateDir, { recursive: true, force: true });
  });
  const payload = JSON.parse(execFileSync(process.execPath, [cli, 'init', '--json'], { env, encoding: 'utf8' })) as {
    ok: boolean; data: { url: string; expiresAt: number; remainingSeconds: number; section: string; onboardingId?: string };
  };
  assert.equal(payload.ok, true);
  assert.match(payload.data.url, /^http:\/\/127\.0\.0\.1:\d+\/\?bootstrap=/);
  assert.match(payload.data.url, /section=setup/);
  assert.equal(payload.data.section, 'setup');
  assert.equal(payload.data.onboardingId, undefined);
  assert.ok(payload.data.expiresAt > Date.now());
  assert.ok(payload.data.remainingSeconds > 3500 && payload.data.remainingSeconds <= 3600);
  assert.equal(existsSync(join(stateDir, 'agent.token')), false);
  assert.equal(existsSync(join(stateDir, 'agent-client.json')), false);

  const alias = JSON.parse(execFileSync(process.execPath, [cli, 'open', '--section', 'agents', '--json'], { env, encoding: 'utf8' })) as {
    ok: boolean; data: { url: string; section: string };
  };
  assert.equal(alias.ok, true);
  assert.equal(alias.data.section, 'setup');
  assert.match(alias.data.url, /section=setup/);
});

test('removed lifecycle commands fail as unknown commands without touching state', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'apple-connector-removed-'));
  const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
  const env = { ...process.env, APPLE_CONNECTOR_STATE_DIR: stateDir };
  try {
    for (const args of [['setup', '--json'], ['agent', 'init', '--json'], ['agent', 'init-status', '--id', '00000000-0000-0000-0000-000000000000', '--json']]) {
      let status: number | null = 0;
      let stdout = '';
      try { execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', stdio: 'pipe' }); }
      catch (error) {
        const result = error as { status?: number | null; stdout?: string };
        status = result.status ?? null;
        stdout = result.stdout ?? '';
      }
      assert.equal(status, 2);
      const payload = JSON.parse(stdout) as { ok: boolean; error: { code: string } };
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, 'invalid_request');
    }
    assert.equal(existsSync(join(stateDir, 'db.sqlite3')), false);
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});
