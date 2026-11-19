import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConnectorError } from '../src/application/errors.js';
import { clientTokenFile, readClientToken, readClientTokenByKey, writeClientToken } from '../src/transports/local/paths.js';
import type { StatePaths } from '../src/transports/local/paths.js';

test('client credential files are owner-private regular files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-credential-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'agent.token');
  writeClientToken(tokenFile, 'a-valid-client-token');
  assert.equal(readClientToken(tokenFile), 'a-valid-client-token');
  assert.throws(() => writeClientToken(tokenFile, 'another-token'), { code: 'EEXIST' });

  const publicFile = join(dir, 'public.token');
  writeFileSync(publicFile, 'a-valid-client-token\n', { mode: 0o600 });
  chmodSync(publicFile, 0o644);
  assert.throws(() => readClientToken(publicFile), (error: unknown) => error instanceof ConnectorError && error.code === 'permission_denied');

  const link = join(dir, 'linked.token');
  symlinkSync(tokenFile, link);
  assert.throws(() => readClientToken(link), (error: unknown) => error instanceof ConnectorError && error.code === 'invalid_request');
});

test('authorization keys resolve only safe names under the profile directory', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'profiles'), { recursive: true, mode: 0o700 });
  writeClientToken(join(dir, 'profiles', 'key-1.token'), 'a-valid-client-token');
  writeClientToken(join(dir, 'profiles', 'a6691692-9825-435a-8224-bde214c57398.token'), 'a-valid-client-token');
  const paths = { dir } as StatePaths;
  assert.equal(clientTokenFile(paths, 'key-1'), join(dir, 'profiles', 'key-1.token'));
  assert.equal(readClientTokenByKey(paths, 'key-1'), 'a-valid-client-token');
  assert.equal(readClientTokenByKey(paths, 'a6691692-9825-435a-8224-bde214c57398'), 'a-valid-client-token');

  for (const key of ['../key-1', 'profiles/key-1', '.', '..', '', 'key 1', '.hidden']) {
    assert.throws(() => readClientTokenByKey(paths, key), (error: unknown) => error instanceof ConnectorError && error.code === 'invalid_request');
  }

  assert.throws(() => readClientTokenByKey(paths, 'missing'), (error: unknown) =>
    error instanceof ConnectorError && error.code === 'invalid_request'
      && /Unknown authorization key/.test(error.message)
      && !error.message.includes(dir));
});

test('credential-file creation never creates a parent directory implicitly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-connector-credential-'));
  try {
    const missingParent = join(dir, 'missing');
    assert.throws(() => writeClientToken(join(missingParent, 'agent.token'), 'a-valid-client-token'));
    // Keep the assertion honest: a caller must deliberately choose an existing private location.
    assert.throws(() => readClientToken(join(missingParent, 'agent.token')), { code: 'invalid_request' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
