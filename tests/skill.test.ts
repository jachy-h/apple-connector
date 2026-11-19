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

test('Skill documents authorization IDs, JSON, privacy, and replacement-safe command contracts', () => {
  assert.match(skill, /Every machine call must use `--json`/);
  assert.match(skill, /`--auth-key <key>`/);
  assert.match(skill, /`--auth-file <path>`/);
  assert.match(skill, /`APPLE_CONNECTOR_AUTH`/);
  assert.match(skill, /mode `0600`/);
  assert.match(skill, /full replacement/);
  assert.match(skill, /preserve every unchanged field/);
  assert.match(skill, /`nextOffset`/);
});

test('Skill due examples match the strict reminder schema', () => {
  assert.match(skill, /\{"kind":"date","date":"YYYY-MM-DD"\}/);
  assert.match(skill, /\{"kind":"instant","at":"RFC3339-with-offset","timeZone":"IANA"\}/);
  assert.match(skill, /date-only[^\n]+must not include `timeZone`/);
});

test('Skill covers the Agent prompt flow and durable write states without false success', () => {
  assert.match(skill, /apple-connector init/);
  assert.match(skill, /Credential file/);
  assert.match(skill, /apple-connector auth show/);
  assert.match(skill, /apple-connector auth verify --agent/);
  assert.match(skill, /open --section <setup\|audit>/);
  assert.match(skill, /apple-connector open --section docs/);
  assert.doesNotMatch(skill, /agent init-status/);
  for (const state of ['expired', 'failed', 'succeeded', 'outcome_unknown', 'cancelled']) {
    assert.ok(skill.includes(`\`${state}\``), `Skill must cover ${state}.`);
  }
  assert.match(skill, /same payload and idempotency key/);
  assert.match(skill, /Do not report success unless the state is `succeeded`/);
  assert.match(skill, /operation get[^\n]+--auth-key/);
  assert.match(skill, /profile directory/);
});

test('Skill documents partial reminder patching, due kinds, and the ID boundary', () => {
  assert.match(skill, /reminder patch --list-id[^\n]+--clear-due/);
  assert.match(skill, /`due: null` clears/);
  assert.match(skill, /`completed: false` reopens/);
  assert.match(skill, /\{"kind":"floating"/);
  assert.match(skill, /`recurring: true`/);
  assert.match(skill, /full sync, account reset, or data-store rebuild/);
  assert.doesNotMatch(skill, /reminder patch[^\n]+--title/);
  assert.doesNotMatch(skill, /reminder patch[^\n]+--body/);
});
