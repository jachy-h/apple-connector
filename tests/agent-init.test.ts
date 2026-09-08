import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('agent init creates the default policy and credential before printing MCP configuration', (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'apple-connector-agent-init-'));
  const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
  const env = { ...process.env, APPLE_CONNECTOR_STATE_DIR: stateDir };
  t.after(() => {
    try { execFileSync(process.execPath, [cli, 'stop'], { env, stdio: 'ignore' }); } catch { /* Best effort. */ }
    rmSync(stateDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, [cli, 'agent', 'init'], { env, encoding: 'utf8' });
  const policyFile = join(stateDir, 'agent-client.json');
  const tokenFile = join(stateDir, 'agent.token');
  const policy = JSON.parse(readFileSync(policyFile, 'utf8')) as { name: string; grants: Array<{ provider: string; containerIds: string[]; actions: string[] }> };
  assert.equal(policy.name, 'agent');
  assert.deepEqual(policy.grants.map(({ provider, containerIds, actions }) => ({ provider, containerIds, actions })), [
    { provider: 'calendar', containerIds: ['*'], actions: ['read'] },
    { provider: 'calendar', containerIds: ['Agents'], actions: ['create', 'update', 'delete'] },
    { provider: 'reminders', containerIds: ['*'], actions: ['read'] },
    { provider: 'reminders', containerIds: ['Agents'], actions: ['create', 'update', 'complete', 'delete'] },
  ]);
  assert.equal(lstatSync(tokenFile).mode & 0o077, 0);
  assert.match(output, new RegExp(`APPLE_CONNECTOR_TOKEN_FILE[\\s\\S]+${tokenFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const second = execFileSync(process.execPath, [cli, 'agent', 'init'], { env, encoding: 'utf8' });
  assert.match(second, /Policy:.*\(reused\)/);
  assert.match(second, /Credential:.*\(reused\)/);
});
