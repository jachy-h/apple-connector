# MCP 一次性配置指南

[English](mcp-setup.md) · [返回 README](../README_zh.md)

本页面向负责安装和配置本地 agent 的人或配置 agent，不针对某个特定 host。

## 标准流程

1. 确认命令已安装：

   ```sh
   command -v apple-connector
   apple-connector version
   ```

2. 生成策略和凭证，再取得 MCP 配置：

   ```sh
   apple-connector agent init
   ```

   内部顺序固定为：`setup` → 生成 `agent-client.json` → 创建客户端 → 生成 `agent.token` → 输出 MCP JSON。因此不会在 token 存在之前就要求配置 `APPLE_CONNECTOR_TOKEN_FILE`。

3. 审阅 `~/apple-connector/agent-client.json`。默认授权为：

   ```json
   {
     "name": "agent",
     "grants": [
       {"provider":"calendar","containerIds":["*"],"actions":["read"],"fields":"full","approval":"automatic","expiresAt":4102444800000},
       {"provider":"calendar","containerIds":["Agents"],"actions":["create","update","delete"],"fields":"full","approval":"automatic","expiresAt":4102444800000},
       {"provider":"reminders","containerIds":["*"],"actions":["read"],"fields":"full","approval":"automatic","expiresAt":4102444800000},
       {"provider":"reminders","containerIds":["Agents"],"actions":["create","update","complete","delete"],"fields":"full","approval":"automatic","expiresAt":4102444800000}
     ]
   }
   ```

   上面使用一个未过期的结构示例值；实际文件中的 `expiresAt` 是生成时起一年后的 Unix 毫秒。`*` 授权只含 `read`；写入仅允许 `Agents`。

4. 将命令最后输出的 `apple-connector` 条目合并到 host 的 stdio MCP 配置，不覆盖其他工具。如果 host 有工具超时配置，建议设为大于连接器 60 秒 RPC 上限，例如 90 秒。

5. 重启或重载 host，让 agent 调用 `connector.capabilities`、`calendar.list_calendars` 和 `reminders.list_lists` 作只读验证。不要为了验证接入而创建数据。

## 既有凭证或自定义策略

已有有效的 owner-only 凭证文件时，只生成 MCP 配置：

```sh
apple-connector mcp config --token-file /absolute/path/agent.token
```

需自定义范围时，复制默认策略或自行创建 `{ name, grants }` JSON，然后执行：

```sh
apple-connector start
apple-connector client create \
  --config /absolute/path/agent-client.json \
  --credential-file /absolute/path/agent.token
apple-connector mcp config --token-file /absolute/path/agent.token
```

这个手动顺序也始终先产生凭证，再引用凭证。策略路径和凭证路径必须是绝对路径；凭证父目录必须已存在，目标文件不得已存在。不要把 token 放进提示词、命令行或版本控制。

`APPLE_CONNECTOR_STATE_DIR` 仅用于显式的自定义状态目录。默认状态、SQLite 审计数据、凭证和服务文件均位于 `~/apple-connector`。

## 源码安装

只有首次获取源码、lockfile 变化或依赖损坏时执行 `npm ci`；源码变更后执行构建：

```sh
npm ci
npm run build
npm link --offline --no-audit --no-fund
```

当前没有签名 App、DMG/ZIP 或 Homebrew cask。GUI host 不一定继承 nvm PATH；`agent init` 和 `mcp config` 输出的绝对 Node/CLI 路径可避免这个问题。

## 限制与排障

- 需要在 macOS 向 EventKit helper 授予日历和提醒事项访问；客户端策略不能替代系统权限。
- `Agents` 缺失或重名时，只读仍可用，但默认写入会拒绝。
- `client rotate` 仍只显示新 token，不覆盖凭证文件；安全替换后需重启 MCP 子进程。
- 显式 `apple-connector stop` 会影响复用同一服务的所有本地 agent host。
- Apple Notes 当前禁用；重复日程和重复提醒事项不支持修改或删除。
