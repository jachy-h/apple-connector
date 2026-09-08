import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { defaultAgentClientConfig, readClientCreateConfig, readClientUpdateConfig, writeDefaultAgentClientConfig } from '../src/cli/client-config.js';

const directory = mkdtempSync(join(tmpdir(), 'apple-connector-client-config-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const grant = { provider: 'reminders', containerIds: ['*'], actions: ['read'], fields: 'full', approval: 'automatic', expiresAt: Date.now() + 60_000 };

test('client create config reads the policy from an absolute JSON file', () => {
  const file = join(directory, 'create.json');
  writeFileSync(file, JSON.stringify({ name: 'agent', grants: [grant] }));
  assert.deepEqual(readClientCreateConfig(file), { name: 'agent', grants: [grant] });
});

test('client update config requires a client id and validates the same policy', () => {
  const file = join(directory, 'update.json');
  writeFileSync(file, JSON.stringify({ id: 'client-1', name: 'agent', grants: [grant] }));
  assert.deepEqual(readClientUpdateConfig(file), { id: 'client-1', name: 'agent', grants: [grant] });
  assert.throws(() => readClientCreateConfig('relative.json'), { code: 'invalid_request' });
});

test('default agent config grants global reads and Agents-only writes', () => {
  const now = Date.now();
  const config = defaultAgentClientConfig(now);
  assert.equal(config.name, 'agent');
  assert.deepEqual(config.grants.map(({ provider, containerIds, actions }) => ({ provider, containerIds, actions })), [
    { provider: 'calendar', containerIds: ['*'], actions: ['read'] },
    { provider: 'calendar', containerIds: ['Agents'], actions: ['create', 'update', 'delete'] },
    { provider: 'reminders', containerIds: ['*'], actions: ['read'] },
    { provider: 'reminders', containerIds: ['Agents'], actions: ['create', 'update', 'complete', 'delete'] },
  ]);
  assert.ok(config.grants.every((item) => item.expiresAt === now + 365 * 24 * 60 * 60 * 1000));

  const file = join(directory, 'agent-default.json');
  assert.deepEqual(writeDefaultAgentClientConfig(file, now), config);
  assert.deepEqual(readClientCreateConfig(file), config);
  assert.throws(() => writeDefaultAgentClientConfig(file, now), { code: 'conflict' });
});
