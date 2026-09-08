# Apple Connector：Agent 接入指南

[English](agent-mcp-install.md) · [返回 README](../README_zh.md)

本文可直接交给负责配置本地 agent host 的 Agent 执行。目标是接入 Apple Connector 的 stdio MCP，同时保留 host 中已有的其他配置。

## 约束

- 仅在确认 macOS 为 Apple Silicon 且 Node 为 24.20.x 或 26.8.x 后，全局安装已发布的 `@jachy/apple-connector@0.8.3`；不从源码构建，也不使用 `npm link`。
- 不读取、显示、复制或手工创建 token 内容。host 配置只保存凭证文件的绝对路径。
- 不使用管理员 token 代替 agent 客户端凭证。
- 不覆盖 host 的完整配置文件，只合并一个名为 `apple-connector` 的 MCP server 条目。
- 接入验证只执行读取，不创建、修改、完成或删除真实 Apple 数据。

## 标准接入步骤

1. 检查全局命令：

   ```sh
   command -v apple-connector
   apple-connector version
   ```

   先确认 `uname -m` 输出为 `arm64`，`node --version` 属于受支持的 24.20.x 或 26.8.x。执行 `npm install -g @jachy/apple-connector@0.8.3`，再检查上述命令。平台、Node 版本不受支持或命令缺失时停止并报告。

2. 执行一次性 Agent 初始化：

   ```sh
   apple-connector agent init
   ```

   此命令按固定顺序完成：初始化本地状态 → 生成 `agent-client.json` → 配对客户端 → 生成 owner-only 的 `agent.token` → 输出 MCP JSON。不得在该命令完成前自行设置一个不存在的 `APPLE_CONNECTOR_TOKEN_FILE`。

3. 检查命令报告的两个文件路径，不读取 token 内容：

   - 默认策略：`~/apple-connector/agent-client.json`
   - 默认凭证：`~/apple-connector/agent.token`

   默认策略必须满足：

   - 所有 Calendar 日历和 Reminders 清单仅有 `read` 权限。
   - 只有精确命名为 `Agents` 的日历具有 `create`、`update`、`delete`。
   - 只有精确命名为 `Agents` 的提醒事项清单具有 `create`、`update`、`complete`、`delete`。
   - 授权有效期是生成时起一年后的 Unix 毫秒值。

   如果用户要求不同范围，不要继续使用默认初始化结果扩大权限；停止并让用户或维护者按 [MCP 配置指南](mcp-setup_zh.md) 撤销默认客户端、审阅自定义策略并重新配对。

4. 从 `agent init` 输出中取得 `mcpServers.apple-connector` 条目，将它合并到当前 host 对应的 stdio MCP 配置位置。不同 host 的外层结构可能不同，必须保留输出中的绝对 `command`、`args` 和 `env.APPLE_CONNECTOR_TOKEN_FILE`。仅当初始化使用了自定义状态目录时保留 `APPLE_CONNECTOR_STATE_DIR`。

   若 host 支持单工具调用超时，将 Apple Connector 设置为 90 秒或其他大于 60 秒的值。不要把 `npm run start`、`npm run build` 或 `npm ci` 配成 MCP 启动命令。

5. 保存配置并重启或重载 host。依次执行只读验证：

   - `connector.capabilities`
   - `calendar.list_calendars`
   - `reminders.list_lists`

   不为验证调用任何写入工具。

## 成功标准

- host 显示 Apple Connector 工具，`connector.capabilities` 返回服务版本 0.8.3。
- 日历和提醒事项容器可以列举；Apple Notes 显示 unavailable 属于预期结果。
- MCP 配置中的 token 是文件路径而非秘密内容，且没有破坏 host 的其他配置。
- 若 `Agents` 容器缺失或重名，只读接入仍可成功；写入应被拒绝而不是猜测目标。

## 已有凭证

如果用户明确指定一个已经配对的 owner-only 凭证文件，不要再次运行 `agent init`。执行：

```sh
apple-connector mcp config --token-file /absolute/path/agent.token
```

然后从上面的第 4 步继续。命令只生成配置，不读取或显示 token 内容，也不修改 host 配置。
