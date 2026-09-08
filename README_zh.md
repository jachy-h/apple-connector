# Apple Connector

[English](README.md)

Apple Connector 是在本机通过 stdio MCP 访问 Apple 日历和提醒事项的服务。它只在 Mac 本机运行，不提供 HTTP、局域网或云端入口。

当前仅支持 Apple Silicon（arm64）macOS，以及 Node.js 24.20.x 或 26.8.x。Apple Notes 暂不可用。

## 安装并接入

```sh
npm install -g @jachy/apple-connector
apple-connector agent init
```

`agent init` 会先创建本地状态、可审阅的策略和 owner-only 凭证文件，最后才输出可合并的 MCP server 条目。只把其中的 `apple-connector` 条目合并到 host 的 MCP 配置，不能覆盖已有设置。重启或重载 host 后，只调用读取工具完成验证。

默认策略允许读取所有日历和提醒事项清单；只有名称唯一且精确为 `Agents` 的日历或清单才获得写入权限。`Agents` 不存在或重名时会安全地拒绝写入。

## 直接交给 Agent

将以下整段指令交给负责配置本机 MCP host 的 Agent：

```text
请在这台 Mac 上把 Apple Connector 配置为 stdio MCP server。先检查 macOS 是否为 Apple Silicon，以及 Node 是否为 24.20.x 或 26.8.x。全局安装 @jachy/apple-connector@0.8.3，再运行 `apple-connector agent init`。不要读取、打印、复制 token 内容，也不要把 token 内容写入配置；只能使用生成的凭证文件绝对路径。将输出的 `mcpServers.apple-connector` 条目合并到现有 host 配置，绝不能替换其他条目。重载 host 后，只用 `connector.capabilities`、`calendar.list_calendars` 和 `reminders.list_lists` 验收；不得为接入测试写入 Apple 数据。遇到权限缺失、平台不受支持或 Agents 容器缺失/重名时，报告问题，不要猜测或继续写入。
```

可直接把 [Agent 接入指南](docs/agent-mcp-install_zh.md)交给 Agent。手动配对、自定义策略和排障见 [MCP 配置指南](docs/mcp-setup_zh.md)。

## Agent 工具

| 目的 | 工具 |
| --- | --- |
| 读取日历与日程 | `calendar.list_calendars`、`calendar.list_events` |
| 管理非重复日程 | `calendar.create_event`、`calendar.update_event`、`calendar.delete_event` |
| 读取提醒事项清单和项目 | `reminders.list_lists`、`reminders.list` |
| 管理非重复提醒事项 | `reminders.create`、`reminders.update`、`reminders.complete`、`reminders.delete` |
| 恢复写入结果 | `operations.get` |

每次写入都需要稳定的 `idempotencyKey`。若结果丢失，查询操作 ID，或使用完全相同的 key 和请求重试；不要发起新的写入。macOS 隐私授权与连接器策略是两层独立限制。

## 开发与发布

在源码仓库中执行 `npm ci`、`npm run check`、`npm run check:jxa` 和 `npm run release:verify`。最后一项会同时审计构建产物和 npm tarball。

v0.8.3 已完成 npm 首发准备，但维护者尚需确定许可证，之后才能发布。详见 [v0.8.3 发布计划](docs/v0.8.3-plan.md)和[进度记录](docs/v0.8.3-progress.md)。
