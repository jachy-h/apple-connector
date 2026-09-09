import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const skill = readFileSync(new URL('../../skill/SKILL.md', import.meta.url), 'utf8');

test('Skill declares a specific valid Agent Skills identity', () => {
  assert.match(skill, /^---\nname: apple-connector\ndescription: .+Calendar.+Reminders.+\n---\n/);
});

test('Skill turns reminder intent into a real Apple Reminders mutation', () => {
  assert.match(skill, /When the user asks to be reminded[^\n]+must synchronize Apple Reminders/);
  assert.match(skill, /create a new reminder[^\n]+update, complete, or delete/);
  assert.match(skill, /Never merely promise to remind the user/);
});

test('Skill documents credential, JSON, privacy, and replacement-safe command contracts', () => {
  assert.match(skill, /Every machine call must use `--json`/);
  assert.match(skill, /every business command and `operation get`[^\n]+`--credential-file <path>`/);
  assert.match(skill, /mode `0600`/);
  assert.match(skill, /full replacements/);
  assert.match(skill, /preserve every unchanged field/);
  assert.match(skill, /`nextOffset`/);
});

test('Skill due examples match the strict reminder schema', () => {
  assert.match(skill, /\{"kind":"date","date":"YYYY-MM-DD"\}/);
  assert.match(skill, /\{"kind":"instant","at":"RFC3339-with-offset","timeZone":"IANA"\}/);
  assert.match(skill, /date-only[^\n]+must not include `timeZone`/);
});

test('Skill covers onboarding and durable write states without false success', () => {
  for (const state of ['pending', 'configured', 'expired', 'failed', 'prepared', 'succeeded', 'outcome_unknown']) {
    assert.ok(skill.includes(`\`${state}\``), `Skill must cover ${state}.`);
  }
  assert.match(skill, /same payload and idempotency key/);
  assert.match(skill, /Do not report success unless the state is `succeeded`/);
  assert.match(skill, /operation get[^\n]+--credential-file/);
});
