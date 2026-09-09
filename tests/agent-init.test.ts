import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('built CLI resolves the packaged Skill directory', () => {
  const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
  const payload = JSON.parse(execFileSync(process.execPath, [cli, 'skill', 'path', '--json'], { encoding: 'utf8' })) as { ok: boolean; data: { path: string; version: string } };
  assert.equal(payload.ok, true);
  assert.equal(payload.data.path, resolve(dirname(cli), '../../../skill'));
  assert.equal(existsSync(payload.data.path), true);
  assert.equal(existsSync(join(payload.data.path, 'SKILL.md')), true);
});

test('agent init starts a temporary management session without creating grants or credentials', (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'apple-connector-agent-init-'));
  const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
  const env = { ...process.env, APPLE_CONNECTOR_STATE_DIR: stateDir };
  t.after(() => {
    try { const pid = Number.parseInt(readFileSync(join(stateDir, 'web.pid'), 'utf8'), 10); if (Number.isInteger(pid)) process.kill(pid, 'SIGTERM'); } catch { /* Best effort. */ }
    try { execFileSync(process.execPath, [cli, 'stop'], { env, stdio: 'ignore' }); } catch { /* Best effort. */ }
    rmSync(stateDir, { recursive: true, force: true });
  });
  const payload = JSON.parse(execFileSync(process.execPath, [cli, 'agent', 'init', '--json'], { env, encoding: 'utf8' })) as { ok: boolean; data: { onboardingId: string; url: string; expiresAt: number; remainingSeconds: number; section: string } };
  assert.equal(payload.ok, true);
  assert.match(payload.data.url, /^http:\/\/127\.0\.0\.1:\d+\/\?bootstrap=/);
  assert.equal(payload.data.section, 'permissions');
  assert.match(payload.data.onboardingId, /^[0-9a-f-]{36}$/i);
  assert.ok(payload.data.expiresAt > Date.now());
  assert.ok(payload.data.remainingSeconds > 3500 && payload.data.remainingSeconds <= 3600);
  assert.equal(existsSync(join(stateDir, 'agent.token')), false);
  assert.equal(existsSync(join(stateDir, 'agent-client.json')), false);
  const status = JSON.parse(execFileSync(process.execPath, [cli, 'agent', 'init-status', '--id', payload.data.onboardingId, '--json'], { env, encoding: 'utf8' })) as { data: { state: string; id: string; expiresAt: number } };
  assert.equal(status.data.id, payload.data.onboardingId);
  assert.equal(status.data.state, 'pending');
  assert.ok(status.data.expiresAt <= payload.data.expiresAt && status.data.expiresAt > Date.now());
});
