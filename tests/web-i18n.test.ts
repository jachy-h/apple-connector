import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, languageStorageKey, readLanguagePreference, resolveLanguage, saveLanguagePreference, translations } from '../src/web/i18n.js';
import { groupProfiles, permissionState, profileGrant } from '../src/web/management-view.js';

test('management language defaults safely to simplified Chinese and accepts English', () => {
  assert.equal(resolveLanguage(undefined), 'zh-CN');
  assert.equal(resolveLanguage('invalid'), 'zh-CN');
  assert.equal(resolveLanguage('en-US'), 'en-US');
  assert.equal(readLanguagePreference({ getItem: () => 'en-US' }), 'en-US');
  assert.equal(readLanguagePreference({ getItem: () => 'invalid' }), 'zh-CN');
});

test('permission presentation never labels partial, denied, or unknown access as granted', () => {
  assert.deepEqual(permissionState('full_access'), { raw: 'full_access', tone: 'granted', statusKey: 'fullAccess' });
  assert.equal(permissionState('write_only').tone, 'warning');
  assert.equal(permissionState('denied').tone, 'denied');
  assert.equal(permissionState('restricted').tone, 'denied');
  assert.equal(permissionState('anything-else').tone, 'unknown');
  assert.equal(permissionState(undefined).statusKey, 'unavailable');
});

test('profile grants retain every safe display field and reject malformed values', () => {
  assert.deepEqual(profileGrant({ provider: 'calendar', containerIds: ['work', '*'], actions: ['read', 'create'], fields: 'full', approval: 'required', expiresAt: 1_800_000_000_000 }), {
    provider: 'calendar', containerIds: ['work', '*'], actions: ['read', 'create'], fields: 'full', approval: 'required', expiresAt: 1_800_000_000_000,
  });
  assert.equal(profileGrant({ provider: 'notes', containerIds: [], actions: [], fields: 'full', approval: 'required', expiresAt: 1 }), undefined);
});

test('same-name profiles are grouped for display without merging their independent identities', () => {
  const groups = groupProfiles([
    { id: 'old', name: 'Calendar Agent', revoked: true }, { id: 'current', name: 'Calendar Agent', revoked: false }, { id: 'other', name: 'Reminders Agent', revoked: false },
  ]);
  assert.deepEqual(groups.map((group) => ({ name: group.name, ids: group.profiles.map((profile) => profile.id), active: group.activeCount, revoked: group.revokedCount })), [
    { name: 'Calendar Agent', ids: ['current', 'old'], active: 1, revoked: 1 }, { name: 'Reminders Agent', ids: ['other'], active: 1, revoked: 0 },
  ]);
});

test('management language preference persists and both dictionaries contain key controls', () => {
  let saved: [string, string] | undefined;
  saveLanguagePreference({ setItem: (key, value) => { saved = [key, value]; } }, 'en-US');
  assert.deepEqual(saved, [languageStorageKey, 'en-US']);
  assert.equal(translations['zh-CN'].permissions, '权限');
  assert.equal(translations['en-US'].permissions, 'Permissions');
  assert.notEqual(formatDate(Date.UTC(2026, 0, 2, 3, 4, 5), 'zh-CN'), '');
});
