import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAgentPrompt } from '../src/web/agent-prompt.js';

const input = {
  token: 'super-secret-token',
  credentialKey: 'a6691692-9825-435a-8224-bde214c57398',
};

const numberedSteps = (prompt: string) => prompt.split('\n').filter((line) => /^\d+\. /.test(line));

test('recommended prompt uses the authorization key and omits both the token and its path', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const prompt = buildAgentPrompt({ ...input, language, includeToken: false });
    assert.match(prompt, /a6691692-9825-435a-8224-bde214c57398/);
    assert.match(prompt, /--auth-key 'a6691692-9825-435a-8224-bde214c57398'/);
    assert.doesNotMatch(prompt, /super-secret-token/);
    assert.doesNotMatch(prompt, /profiles\//);
    assert.doesNotMatch(prompt, /\.token/);
    assert.match(prompt, /profile 目录|profile directory/);
    assert.match(prompt, /auth show/);
    assert.match(prompt, /auth verify --agent/);
    assert.match(prompt, /skill path/);
  }
});

test('prompt keeps only three onboarding steps and lets the Skill carry fixed rules', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const prompt = buildAgentPrompt({ ...input, language, includeToken: false });
    const steps = numberedSteps(prompt);
    assert.equal(steps.length, 3);
    const [skillStep, verifyStep, queryStep] = steps;
    assert.ok(skillStep && verifyStep && queryStep);
    assert.match(skillStep, /skill path/);
    assert.match(verifyStep, /auth verify --agent/);
    assert.doesNotMatch(verifyStep, /auth show/);
    assert.match(queryStep, /list-calendars|list-lists/);
    assert.match(prompt, /auth show/);
    assert.doesNotMatch(prompt, /open --section docs/);
    assert.doesNotMatch(prompt, /idempotency-key/);
    assert.doesNotMatch(prompt, /outcome_unknown/);
  }
});

test('prompt has no title or authorization metadata header', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const prompt = buildAgentPrompt({ ...input, language, includeToken: false });
    assert.doesNotMatch(prompt, /^#/m);
    assert.match(prompt, /^(请接入本机 Apple Connector|Connect to the local Apple Connector)/);
    assert.doesNotMatch(prompt, /授权名称：|^- Authorization name:/m);
    assert.doesNotMatch(prompt, /授权范围：|^- Scope:/m);
    assert.doesNotMatch(prompt, /过期时间：|^- Expires:/m);
  }
});

test('fallback prompt includes the authorization ID and storage warning', () => {
  const zh = buildAgentPrompt({ ...input, language: 'zh-CN', includeToken: true });
  assert.match(zh, /super-secret-token/);
  assert.match(zh, /0600/);
  assert.match(zh, /不要写入仓库、日志、聊天记录/);
  assert.match(zh, /auth show/);
  assert.match(zh, /auth verify --agent/);
  assert.match(zh, /--auth 'super-secret-token'/);
  assert.doesNotMatch(zh, /--auth-key 'super-secret-token'/);
  assert.equal(numberedSteps(zh).length, 3);

  const en = buildAgentPrompt({ ...input, language: 'en-US', includeToken: true });
  assert.match(en, /super-secret-token/);
  assert.match(en, /0600/);
  assert.match(en, /Never write it to a repository, log, chat history or shell history/);
  assert.match(en, /auth show/);
  assert.match(en, /auth verify --agent/);
  assert.match(en, /--auth 'super-secret-token'/);
  assert.doesNotMatch(en, /--auth-key 'super-secret-token'/);
  assert.equal(numberedSteps(en).length, 3);
});

test('prompt keeps one bounded read-only verification', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const prompt = buildAgentPrompt({ ...input, language, includeToken: false });
    assert.match(prompt, /calendar list-calendars/);
    assert.match(prompt, /reminder list-lists/);
  }
});

test('an existing authorization ID alone generates the recommended prompt', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const prompt = buildAgentPrompt({ language, token: '', credentialKey: input.credentialKey, includeToken: false });
    assert.match(prompt, /--auth-key 'a6691692-9825-435a-8224-bde214c57398'/);
    assert.doesNotMatch(prompt, /--auth 'a6691692-9825-435a-8224-bde214c57398'/);
    assert.doesNotMatch(prompt, /Authorization ID:|授权码/);
    assert.equal(numberedSteps(prompt).length, 3);
  }
});
