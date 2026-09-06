# Apple Connector

[English](README.md)

使用 TypeScript、Node.js 和 JXA 构建的本地 Apple 数据连接器，供 agent 使用。目前处于 v0.1.0 能力验证阶段，**尚不能用于真实个人数据工作流或正式分发**——M0 原生能力门禁未通过，尚未接入任何原生 writer。

## 开发

已测试的发布目标为 Node 24.20.0 LTS，也在 Node 26.8.1 开发环境验证。安装依赖并执行检查：

```sh
npm ci
npm run check
npm run test:native
npm run release:verify
node dist/src/cli/index.js --help
node dist/src/cli/index.js version
node dist/src/cli/index.js doctor
node dist/src/cli/index.js doctor --probe
```

`doctor --probe` 需要 macOS。它通过 JXA 加载 EventKit，检查授权状态和方法可见性，不申请权限、不枚举个人数据、不执行写入。`test:native` 另外测试不保存的内存对象，在其他平台跳过。探测成功不代表完整集成已可用。

## 本地服务、客户端配对与 MCP（开发原型）

后台服务、客户端管理和 MCP 入口已实现，无需 Apple 数据即可测试。可用临时状态目录评估：

```sh
export APPLE_CONNECTOR_STATE_DIR=/tmp/connector-dev   # 可选；默认 ~/Library/Application Support/AppleConnector
node dist/src/cli/index.js setup                       # 状态目录、管理会话、数据库
node dist/src/cli/index.js start                       # 分离后台服务（setup 已会启动）
node dist/src/cli/index.js open                         # 一次性本地管理链接（macOS）
node dist/src/cli/index.js status
node dist/src/cli/index.js client create --name "Agent" \
  --grant '{"provider":"reminders","containerIds":["test-list"],"actions":["create"],"fields":"full","approval":"automatic","expiresAt":1788580000000}'
APPLE_CONNECTOR_TOKEN=<客户端 token> node dist/src/cli/index.js mcp   # stdio MCP 入口
node dist/src/cli/index.js stop
```

说明：

- `expiresAt` 为 Unix 纪元**毫秒**（与 `Date.now()` 同尺度）。
- 管理会话 token 由 `setup` 仅显示一次；管理类命令在本机从状态目录读取。请勿放入 agent 环境。
- 在 macOS 上，`setup` 会启动服务并打开一次性本地管理链接。服务重启后可运行 `open` 建立新的浏览器会话。
- 服务监听状态目录（0700）内的 Unix domain socket；agent 与管理类 RPC 方法按凭证类别隔离。
- 管理网页只绑定随机 `127.0.0.1` 端口。一次性 bootstrap 链接会换取 `HttpOnly`、`SameSite` 会话，并受 Host、Origin 与 CSRF 校验保护；`open` 不会把持久管理员 token 放入 URL。
- 已验证的原生创建现可通过不可变变更计划写入受限 Reminders 清单和非共享 Notes 文件夹。Calendar 写入和既有对象修改仍受门禁保护；不支持的写入会返回明确错误而不会伪造成功。MCP 当前注册 `connector.capabilities`、唯一名称的 `calendar.list_calendars`/`calendar.list_events`、限定文件夹的 `notes.list_folders`/`notes.get`/`notes.search`、已授权列表的 `reminders.list_lists`/`reminders.list`、`changes.prepare`、`changes.commit`、`operations.get`。

## 范围与证据

现有代码包含有界原生调用器、范围授权、SQLite 客户端/审计存储、变更计划状态机、后台服务、客户端配对、MCP 与仅 loopback 的管理网页。Calendar 读取仅在配置的名称唯一时可用；Calendar 写入、经过验证的原生写入和 Homebrew 分发仍不可用。真实 Apple 写入测试前必须明确选择专用测试容器。

待执行计划可能短期包含操作所需正文；成功、撤销或结果未知后清除。运行中的服务每分钟执行维护，使计划在最多 15 分钟后到期，终态幂等记录保留 30 天。结果未知的操作不会自动重试或丢弃。

审计默认保留 30 天、20,000 条记录及约 50 MiB 逻辑事件数据，不包含标题、笔记正文和 token。运行日志按 5 MiB、最多 3 个文件和 7 天轮换；管理界面尚待实现。本地记录不保证防篡改，连接器策略也不能隔离独立控制同一 macOS 用户账户的 agent。

范围、验证证据和剩余工作见[版本计划](docs/v0.1.0-plan.md)与[实施进展](docs/v0.1.0-progress.md)。
