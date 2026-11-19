import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hiddenAuditLanesStorageKey, readHiddenAuditLanes, saveHiddenAuditLanes, toggleHiddenAuditLane,
} from '../src/web/audit-preferences.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test('hidden audit lanes persist safely and ignore invalid storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(readHiddenAuditLanes(storage), []);
  saveHiddenAuditLanes(storage, ['web', 'client:one', 'client:one']);
  assert.deepEqual(readHiddenAuditLanes(storage), ['web', 'client:one']);
  storage.setItem(hiddenAuditLanesStorageKey, '{broken');
  assert.deepEqual(readHiddenAuditLanes(storage), []);
  storage.setItem(hiddenAuditLanesStorageKey, JSON.stringify(['web', 1, 'not-a-lane', 'client:ok']));
  assert.deepEqual(readHiddenAuditLanes(storage), ['web', 'client:ok']);
});

test('toggling a hidden lane adds and removes it without touching others', () => {
  assert.deepEqual(toggleHiddenAuditLane([], 'client:a'), ['client:a']);
  assert.deepEqual(toggleHiddenAuditLane(['client:a', 'web'], 'client:a'), ['web']);
  assert.deepEqual(toggleHiddenAuditLane(['web'], 'client:b'), ['web', 'client:b']);
});
