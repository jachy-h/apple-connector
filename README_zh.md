# Apple Connector

[English](README.md)

使用 TypeScript、Node.js 和 JXA 构建的本地 Apple 数据连接器，供 agent 使用。目前正在实现 v0.4.0 Web 调试 MVP，**尚不能正式分发**。本地 Web 可直接读取、创建、编辑和删除 Calendar 日程，并读取/创建 Notes 与 Reminders；Reminders 创建明确标为不稳定。

## 开发

已测试的发布目标为 Node 24.20.0 LTS，也在 Node 26.8.1 开发环境验证。安装依赖并执行检查：

```sh
npm ci
npm run start
npm run check
npm run test:native
npm run release:verify
node dist/src/cli/index.js --help
node dist/src/cli/index.js version
node dist/src/cli/index.js doctor
node dist/src/cli/index.js doctor --probe
node dist/src/cli/index.js doctor --reminders-m1 <专用清单-id>
```

`doctor --probe` 需要 macOS。它通过 JXA 加载 EventKit，检查授权状态和方法可见性，不申请权限、不枚举个人数据、不执行写入。显式的 `--reminders-m1` 只在指定专用清单中写入，变更前保存私有 UUID 日志，可用 `doctor --reminders-m1-recover <探针-uuid>` 精确恢复。`test:native` 会跳过当前主机不支持的检查。探测成功不代表完整集成已可用。

## 本地 Web 调试、客户端配对与 MCP（开发原型）

后台服务、客户端管理和 MCP 入口已实现，无需 Apple 数据即可测试。可用临时状态目录评估：

```sh
export APPLE_CONNECTOR_STATE_DIR=/tmp/connector-dev   # 可选；默认 ~/Library/Application Support/AppleConnector
npm run start                                          # 重新构建、替换旧服务，并留在当前终端运行
node dist/src/cli/index.js start                       # 后台模式：启动或复用已有服务
node dist/src/cli/index.js open --print                # 不启动浏览器，仅输出新签发的一次性 URL
node dist/src/cli/index.js status
node dist/src/cli/index.js client create --name "Agent" \
  --grant '{"provider":"reminders","containerIds":["test-list"],"actions":["create"],"fields":"full","approval":"automatic","expiresAt":1788580000000}'
APPLE_CONNECTOR_TOKEN=<客户端 token> node dist/src/cli/index.js mcp   # stdio MCP 入口
node dist/src/cli/index.js stop
```

说明：

- `expiresAt` 为 Unix 纪元**毫秒**（与 `Date.now()` 同尺度）。
- 管理会话 token 仅在首次初始化时显示一次；管理类命令在本机从状态目录读取。请勿放入 agent 环境。
- 开发时推荐使用 `npm run start`：它会重新构建全部内容、停止任何已有实例，并在当前终端运行全新的服务；按 Ctrl-C 即正常停止。
- 底层 `start` 命令保留幂等后台模式：再次运行会复用同版本服务并签发新的浏览器链接。`open` 也可不重启服务重新签发链接，且不会使已有会话失效。
- 服务监听状态目录（0700）内的 Unix domain socket；agent 与管理类 RPC 方法按凭证类别隔离。
- 管理网页只绑定随机 `127.0.0.1` 端口。一次性 bootstrap 链接会换取 `HttpOnly`、`SameSite` 会话，并受 Host、Origin 与 CSRF 校验保护；`open` 不会把持久管理员 token 放入 URL。
- 可从管理网页以表单创建或编辑单授权客户端范围，并可在网页或 CLI 轮换凭证。策略编辑会取消尚未执行的计划，轮换会立即使旧 token 失效。
- 默认管理页一级导航只有 **APPs**、**审计**。APPs 默认进入日历，并可通过已认证本机会话直接执行 Calendar 时间范围读取及非重复日程的新建/编辑/删除、Reminders 清单读取/不稳定新增，以及 Notes 搜索/详情/纯文本新增；无需 MCP 客户端、token 或审批页。Web 写入使用浏览器生成的操作 UUID 实现幂等与状态恢复；结果未知绝不自动重试。
- 审计仅显示 Web 调试记录，支持 App/结果/时间筛选与分页，不保存标题、正文、token 或原始原生错误。管理服务仍只能运行明确指定测试清单的固定 Reminders M1 诊断，并以 UUID 日志精确恢复，不接受任意 shell 或 JXA 输入。
- 已验证的原生创建现可通过不可变变更计划写入受限 Reminders 清单和非共享 Notes 文件夹。Calendar 写入仅在已认证管理网页中可用，并会校验写后结果；MCP 保持只读的日历接口。MCP 当前注册 `connector.capabilities`、唯一名称的 `calendar.list_calendars`/`calendar.list_events`、限定文件夹的 `notes.list_folders`/`notes.get`/`notes.search`、已授权列表的 `reminders.list_lists`/`reminders.list`、`changes.prepare`、`changes.commit`、`operations.get`。

## 范围与证据

现有代码包含有界原生调用器、范围授权、SQLite 客户端/审计存储、变更计划状态机、后台服务、客户端配对、MCP 与仅 loopback 的管理网页。Calendar 读取仅在配置的名称唯一时可用；非重复日程的写入仅在已认证管理网页中可用，并经过原生复核。Homebrew 分发仍不可用。真实 Apple 写入测试前必须明确选择专用测试容器。

待执行计划可能短期包含操作所需正文；成功、撤销或结果未知后清除。运行中的服务每分钟执行维护，使计划在最多 15 分钟后到期，终态幂等记录保留 30 天。结果未知的操作不会自动重试或丢弃。

审计默认保留 30 天、20,000 条记录及约 50 MiB 逻辑事件数据，不包含标题、笔记正文和 token。运行日志按 5 MiB、最多 3 个文件和 7 天轮换。管理界面会显示不含正文的运行时、操作与 SQLite 诊断。本地记录不保证防篡改，连接器策略也不能隔离独立控制同一 macOS 用户账户的 agent。

范围、验证证据和剩余工作见 [v0.4.0 版本计划](docs/v0.4.0-plan.md)、[实施进展](docs/v0.4.0-progress.md)与 [v0.2.0 支持矩阵](docs/v0.2.0-support-matrix.md)。
