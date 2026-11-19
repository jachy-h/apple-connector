import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usageGuide, type GuideSection } from '../src/web/docs.js';

const languages = ['zh-CN', 'en-US'] as const;
const expectedIds = ['overview', 'install', 'commands', 'agent', 'permissions', 'calendar', 'reminders', 'audit', 'json', 'troubleshooting', 'security', 'reference'];
const requiredCommands = [
  'help', 'version', 'init', 'start', 'stop', 'status', 'open', 'skill path', 'auth show', 'auth verify',
  'calendar list-calendars', 'calendar list', 'calendar create', 'calendar update', 'calendar delete',
  'reminder list-lists', 'reminder list', 'reminder create', 'reminder update', 'reminder patch', 'reminder complete', 'reminder delete',
  'operation get', 'doctor',
];

const sectionText = (section: GuideSection): string => [
  section.title, section.summary, ...(section.body ?? []), ...(section.notes ?? []),
  ...(section.commands ?? []).flatMap((command) => [command.syntax, command.description]),
  ...(section.table?.rows ?? []).flat(),
].join('\n');

test('both languages expose the same ordered, unique section structure', () => {
  const zhIds = usageGuide['zh-CN'].sections.map((section) => section.id);
  const enIds = usageGuide['en-US'].sections.map((section) => section.id);
  assert.deepEqual(zhIds, expectedIds);
  assert.deepEqual(enIds, expectedIds);
  assert.equal(new Set(zhIds).size, zhIds.length);

  for (const language of languages) {
    const guide = usageGuide[language];
    assert.ok(guide.intro.length > 20);
    assert.equal(guide.quickCommands.length, 5);
    assert.ok(guide.quickCommands.includes('apple-connector init'));
    assert.ok(guide.quickCommands.includes('apple-connector open'));
    assert.ok(guide.quickCommands.includes('apple-connector auth verify --agent <name> --auth-key <key>'));
    assert.ok(guide.quickCommands.includes('apple-connector skill path'));
    assert.ok(!guide.quickCommands.some((command) => command.includes('setup') || command.includes('agent init')));
    for (const section of guide.sections) {
      assert.ok(section.id.length > 0);
      assert.ok(section.title.length > 0);
      assert.ok(section.summary.length > 0);
      for (const row of section.table?.rows ?? []) {
        assert.equal(row.length, section.table?.columns.length);
      }
    }
  }
});

test('each section has the same commands in both languages', () => {
  for (const id of expectedIds) {
    const zh = usageGuide['zh-CN'].sections.find((section) => section.id === id);
    const en = usageGuide['en-US'].sections.find((section) => section.id === id);
    assert.ok(zh && en);
    assert.deepEqual((zh.commands ?? []).map((command) => command.syntax), (en.commands ?? []).map((command) => command.syntax));
    assert.equal((zh.body ?? []).length, (en.body ?? []).length);
    assert.equal((zh.notes ?? []).length, (en.notes ?? []).length);
  }
});

test('the guide covers every CLI command and the safety-critical details', () => {
  for (const language of languages) {
    const text = usageGuide[language].sections.map(sectionText).join('\n');
    for (const command of requiredCommands) assert.ok(text.includes(command), `${language} guide is missing ${command}`);
    for (const detail of ['--due', '--due-date', '--clear-due', '--idempotency-key', '--input', 'outcome_unknown', 'schemaVersion', '127.0.0.1', 'credential']) {
      assert.ok(text.includes(detail), `${language} guide is missing ${detail}`);
    }
    assert.match(text, /unsupported_operation/);
    assert.match(text, /permission_denied/);
  }
});

test('the reminder guide documents all three due shapes', () => {
  for (const language of languages) {
    const reminders = usageGuide[language].sections.find((section) => section.id === 'reminders');
    assert.ok(reminders?.table);
    assert.deepEqual(reminders.table.rows.map((row) => row[0]), ['date', 'floating', 'instant']);
    assert.ok(reminders.table.rows.every((row) => row.length === 3));
  }
});

test('English content does not contain copied Chinese text', () => {
  for (const section of usageGuide['en-US'].sections) assert.doesNotMatch(sectionText(section), /[\u4e00-\u9fff]/);
  for (const section of usageGuide['zh-CN'].sections) assert.match(sectionText(section), /[\u4e00-\u9fff]/);
});
