import type { Language } from './i18n.js';

export interface AgentPromptInput {
  language: Language;
  token: string;
  credentialKey: string;
  includeToken: boolean;
}

/**
 * Build the text a human copies to an Agent after creating an authorization. The default
 * variant contains only the authorization key; the CLI resolves it to an owner-only profile
 * file, so the prompt never exposes a credential path. The token variant is an explicit
 * fallback for Agent hosts that cannot use the local CLI profile lookup. The authorization
 * name, scope and expiry are read on demand with `auth show` instead of being copied into
 * the prompt.
 */
export function buildAgentPrompt(input: AgentPromptInput): string {
  return input.language === 'zh-CN' ? chinese(input) : english(input);
}

function chinese(input: AgentPromptInput): string {
  const tokenBlock = input.includeToken
    ? `\n- 授权码（仅在无法使用授权 key 时使用）：\`${input.token}\`\n\n如果必须保存授权码：写入权限为 0600 的 owner-only 文件或宿主 secret store；不要写入仓库、日志、聊天记录或 shell history。优先使用授权 key。\n`
    : '';
  const authArg = input.includeToken ? `--auth '${input.token}'` : `--auth-key '${input.credentialKey}'`;
  return `请接入本机 Apple Connector。不要回显、记录或转发凭据内容。

- 授权 key：\`${input.credentialKey}\`

该 key 只用于在本机选择授权；凭据由 apple-connector 自动查找。不要读取、复制、扫描或打印 profile 目录中的 token 文件。
${tokenBlock}
执行 3 步：

1. 加载随包 Skill，后续按其中的规则操作：\`apple-connector skill path --json\`
2. 完成绑定：\`apple-connector auth verify --agent '<你的名称>' ${authArg} --json\`。把 \`<你的名称>\` 换成你的产品或客户端名称；成功后本机管理页会立即显示“Agent 已绑定”。
3. 用一次有界只读查询确认可用：\`apple-connector calendar list-calendars ${authArg} --json\` 或 \`apple-connector reminder list-lists ${authArg} --json\`。

需要查看授权名称、范围或过期时间时，运行 \`apple-connector auth show ${authArg} --json\`。
`;
}

function english(input: AgentPromptInput): string {
  const tokenBlock = input.includeToken
    ? `\n- Authorization ID (use only when the authorization key cannot be used): \`${input.token}\`\n\nIf you must store the authorization ID, put it in an owner-only mode 0600 file or the host secret store. Never write it to a repository, log, chat history or shell history. Prefer the authorization key.\n`
    : '';
  const authArg = input.includeToken ? `--auth '${input.token}'` : `--auth-key '${input.credentialKey}'`;
  return `Connect to the local Apple Connector with the following information. Never echo, log or forward credential contents.

- Authorization key: \`${input.credentialKey}\`

The key only selects a local authorization; apple-connector resolves the credential itself. Do not read, copy, scan or print token files in the profile directory.
${tokenBlock}
3 steps:

1. Load the packaged Skill and follow its rules from here on: \`apple-connector skill path --json\`
2. Complete verification: run \`apple-connector auth verify --agent '<your name>' ${authArg} --json\`. Replace \`<your name>\` with your product or client name; once it succeeds, the local management page shows this Agent as bound immediately.
3. Confirm it works with one bounded read-only query: \`apple-connector calendar list-calendars ${authArg} --json\` or \`apple-connector reminder list-lists ${authArg} --json\`.

To inspect the authorization name, scope or expiry, run \`apple-connector auth show ${authArg} --json\`.
`;
}
