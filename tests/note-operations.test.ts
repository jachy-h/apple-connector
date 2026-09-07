import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/storage/database.js';

test('Notes grants are read-only in v0.5.0', () => {
  const store = new Store(':memory:');
  try {
    assert.throws(() => store.createClient({ name: 'Notes agent', grants: [{ provider: 'notes', containerIds: ['Agents'], actions: ['create'], approval: 'required', expiresAt: Date.now() + 3600_000 }] }), /read-only/);
  } finally { store.close(); }
});
