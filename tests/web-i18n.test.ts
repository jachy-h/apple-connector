import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, languageStorageKey, readLanguagePreference, resolveLanguage, saveLanguagePreference, translations } from '../src/web/i18n.js';
import { agentBinding, buildAuthorizationGrants, buildContainerNameIndex, buildProfileGrants, containerDisplayName, defaultExpiry, groupProfiles, permissionSettingsUrl, permissionState, profileActions, profileGrant } from '../src/web/management-view.js';

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

test('permission settings links open the exact macOS privacy panes', () => {
  assert.equal(permissionSettingsUrl('calendar'), 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars');
  assert.equal(permissionSettingsUrl('reminders'), 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders');
});

test('profile grants retain every safe display field and reject malformed values', () => {
  assert.deepEqual(profileGrant({ provider: 'calendar', containerIds: ['work', '*'], actions: ['read', 'create'], expiresAt: 1_800_000_000_000 }), {
    provider: 'calendar', containerIds: ['work', '*'], actions: ['read', 'create'], expiresAt: 1_800_000_000_000,
  });
  assert.equal(profileGrant({ provider: 'notes', containerIds: [], actions: [], expiresAt: 1 }), undefined);
});

test('same-name profiles are grouped for display without merging their independent identities', () => {
  const groups = groupProfiles([
    { id: 'old', name: 'Calendar Agent', revoked: true }, { id: 'current', name: 'Calendar Agent', revoked: false }, { id: 'other', name: 'Reminders Agent', revoked: false },
  ]);
  assert.deepEqual(groups.map((group) => ({ name: group.name, ids: group.profiles.map((profile) => profile.id), active: group.activeCount, revoked: group.revokedCount })), [
    { name: 'Calendar Agent', ids: ['current', 'old'], active: 1, revoked: 1 }, { name: 'Reminders Agent', ids: ['other'], active: 1, revoked: 0 },
  ]);
});

test('Agent binding distinguishes verified, used-only and never-used authorizations', () => {
  assert.deepEqual(agentBinding({ agentName: 'Claude Code', verifiedAt: 1_800_000_000_000, lastUsedAt: 1_800_000_000_001 }), {
    tone: 'bound', agentName: 'Claude Code', at: 1_800_000_000_000,
  });
  assert.deepEqual(agentBinding({ agentName: null, verifiedAt: null, lastUsedAt: 1_800_000_000_000 }), {
    tone: 'used', agentName: null, at: 1_800_000_000_000,
  });
  assert.deepEqual(agentBinding({ agentName: null, verifiedAt: null, lastUsedAt: null }), {
    tone: 'never', agentName: null, at: null,
  });
  assert.deepEqual(agentBinding({ agentName: '  ', verifiedAt: 'bad', lastUsedAt: Number.NaN }), {
    tone: 'never', agentName: null, at: null,
  });
});

test('per-container permissions merge identical settings and reject invalid combinations', () => {
  const expiresAt = 1_800_000_000_000;
  assert.deepEqual(buildProfileGrants('calendar', [
    { containerId: 'work', actions: ['read', 'create'] },
    { containerId: 'personal', actions: ['read'] },
    { containerId: 'shared', actions: ['create', 'read'] },
  ], expiresAt), [
    { provider: 'calendar', containerIds: ['work', 'shared'], actions: ['read', 'create'], expiresAt },
    { provider: 'calendar', containerIds: ['personal'], actions: ['read'], expiresAt },
  ]);
  assert.deepEqual(profileActions('calendar'), ['read', 'create', 'update', 'delete']);
  assert.deepEqual(profileActions('reminders'), ['read', 'create', 'update', 'complete', 'delete']);
  assert.throws(() => buildProfileGrants('calendar', [{ containerId: 'work', actions: [] }], expiresAt), /at least one action/);
  assert.throws(() => buildProfileGrants('calendar', [{ containerId: 'work', actions: ['complete'] }], expiresAt), /not valid/);
});

test('one authorization can span Calendar and Reminders containers', () => {
  const expiresAt = 1_800_000_000_000;
  const grants = buildAuthorizationGrants({
    calendar: [{ containerId: 'work', actions: ['read', 'create'] }],
    reminders: [{ containerId: 'inbox', actions: ['read', 'complete'] }],
  }, expiresAt);
  assert.deepEqual(grants, [
    { provider: 'calendar', containerIds: ['work'], actions: ['read', 'create'], expiresAt },
    { provider: 'reminders', containerIds: ['inbox'], actions: ['read', 'complete'], expiresAt },
  ]);
});

test('management language preference persists and both dictionaries contain key controls', () => {
  let saved: [string, string] | undefined;
  saveLanguagePreference({ setItem: (key, value) => { saved = [key, value]; } }, 'en-US');
  assert.deepEqual(saved, [languageStorageKey, 'en-US']);
  assert.equal(translations['zh-CN'].permissions, '系统权限');
  assert.equal(translations['en-US'].permissions, 'System permissions');
  assert.equal(translations['zh-CN'].docs, '使用文档');
  assert.equal(translations['en-US'].docs, 'Usage guide');
  assert.equal(translations['zh-CN'].docsToc, '本页目录');
  assert.equal(translations['en-US'].docsToc, 'On this page');
  assert.equal(translations['zh-CN'].allContainers, '全部容器');
  assert.equal(translations['en-US'].allContainers, 'All containers');
  assert.ok(translations['zh-CN'].permissionFlowIntro.includes('系统权限'));
  assert.ok(translations['en-US'].permissionFlowIntro.includes('system access'));
  assert.equal(translations['zh-CN'].lastUsed, '上次使用');
  assert.equal(translations['en-US'].neverUsed, 'Never used');
  assert.equal(translations['zh-CN'].closePermission, '关闭权限…');
  assert.equal(translations['en-US'].closePermission, 'Close permission…');
  assert.equal(translations['zh-CN'].recheckPermissions, '重新检查');
  assert.ok(translations['zh-CN'].distributionNotice.includes('Homebrew Cask'));
  assert.ok(translations['en-US'].distributionNotice.includes('Gatekeeper'));
  assert.ok(translations['zh-CN'].permissionSettingsOpened.includes('系统设置'));
  assert.ok(translations['en-US'].permissionSettingsOpened.includes('System Settings'));
  assert.ok(translations['zh-CN'].deleteProfileConfirm('Agent').includes('Agent'));
  assert.equal(translations['zh-CN'].auditWebLane, '本机管理页面');
  assert.equal(translations['en-US'].auditWebLane, 'Local management page');
  assert.ok(translations['zh-CN'].auditDeleteLaneConfirm('Agent').includes('Agent'));
  assert.ok(translations['en-US'].auditHeatHint.includes('hour'));
  assert.equal(translations['zh-CN'].outcomeUnknown, '结果未知');
  assert.equal(translations['en-US'].outcomeSucceeded, 'Succeeded');
  assert.equal(translations['zh-CN'].setup, '接入');
  assert.equal(translations['en-US'].setup, 'Setup');
  assert.equal(translations['zh-CN'].stepVerifyTitle, 'Agent 完成验证');
  assert.equal(translations['en-US'].stepVerifyTitle, 'Agent verification');
  assert.equal(translations['zh-CN'].agentBound, 'Agent 已绑定');
  assert.equal(translations['en-US'].agentBound, 'Agent bound');
  assert.ok(translations['zh-CN'].verifyWaitingBody.includes('auth verify'));
  assert.ok(translations['en-US'].verifyWaitingBody.includes('auth verify'));
  assert.deepEqual(Object.keys(translations['zh-CN']).sort(), Object.keys(translations['en-US']).sort());
  assert.notEqual(formatDate(Date.UTC(2026, 0, 2, 3, 4, 5), 'zh-CN'), '');
});

test('default profile expiry is one local calendar year in datetime-local form', () => {
  assert.equal(defaultExpiry(new Date(2026, 0, 15, 10, 30).getTime()), '2027-01-15T10:30');
  assert.equal(defaultExpiry(new Date(2028, 1, 29, 9, 5).getTime()), '2029-02-28T09:05');
});

test('container grants display names only when the provider and ID match', () => {
  const index = buildContainerNameIndex({
    calendar: [{ id: 'cal-1', name: 'Work' }],
    reminders: [{ id: 'list-1', name: 'Groceries' }],
  });
  assert.equal(containerDisplayName('calendar', 'cal-1', index), 'Work');
  assert.equal(containerDisplayName('reminders', 'list-1', index), 'Groceries');
  assert.equal(containerDisplayName('calendar', 'list-1', index), 'list-1');
  assert.equal(containerDisplayName('reminders', 'cal-1', index), 'cal-1');
  assert.equal(containerDisplayName('calendar', 'missing', index), 'missing');
});

test('prompt step lists every authorization with actionable copy text', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const t = translations[language];
    assert.ok(t.promptListTitle.length > 0);
    assert.ok(t.promptListHint.length > 0);
    assert.ok(t.justCreated.length > 0);
    assert.match(t.promptCopiedFor('Work Agent'), /Work Agent/);
    assert.ok(t.copyAgentPrompt.length > 0);
    assert.ok(t.copyAgentPromptWithToken.length > 0);
  }
});
