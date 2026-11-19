# CLI 参考

[English](cli.md) · 中文

在 v0.17.0 中，`apple-connector` 是唯一的公开集成入口。所有面向机器的命令都接受 `--json`，并向标准输出写入一个带版本的 JSON 信封（`schemaVersion: 2`）。

状态（SQLite 数据库、管理 token、授权 token 文件、审计和日志）默认位于 `~/.apple-connector`。`APPLE_CONNECTOR_STATE_DIR` 可覆盖该路径，用于测试或临时实例。从使用 `~/apple-connector` 的旧版本升级时，运行 `apple-connector migrate-state` 停止旧服务与管理页并移动目录；其他状态命令在旧服务未运行时也会自动迁移。

运行 `apple-connector help` 查看总览，或 `apple-connector help <topic...>` 查看详细选项与示例（例如 `apple-connector help calendar create`）。`--help`/`-h` 和 `--version`/`-v` 是同一命令的别名。人类可读输出在 TTY 上使用颜色；`--json`、`--no-color`、`NO_COLOR` 和非 TTY 输出都不含 ANSI。业务调用通过 `--auth-key <key>` 传入授权 key，解析 `<state dir>/profiles/<key>.token`；`--auth-file <path>` 读取显式的所有者可读文件，`APPLE_CONNECTOR_AUTH` / `--auth <token>` 直接传入 token。旧的 `--profile <key>` 和 `--credential-file <path>` 仍可用。写入必须提供 `--idempotency-key`。敏感内容应放在所有者可读的 `--input` JSON 文件中。

`apple-connector init [--json]` 是面向人的首次接入入口。它初始化状态、启动或复用服务、启动或复用一小时有效的管理页、打开接入页，并返回 `{ url, expiresAt, remainingSeconds, section }`。在 `--json` 模式下不打开浏览器。`apple-connector open [--section setup|audit|docs]` 用于后续打开管理页；旧值 `permissions` 和 `agents` 会被接受并归一化为 `setup`。

`apple-connector skill path --json` 返回随包 Skill 目录的绝对路径和包版本。`apple-connector auth show --auth-key <key> --json` 描述某个本机 profile 背后的授权，但不会打印其 token。`apple-connector auth verify --agent <name> --auth-key <key> --json` 用同一 profile 完成认证，并把 Agent 名称与验证时间写入授权；接入页会立即显示该绑定。

用户创建授权后，页面会生成 Agent 提示词。推荐版只包含授权 key，不含 token；用 `--auth-key <key>` 传入，不要读取、扫描或打印 profile 目录中的 token 文件。备用版包含授权码；把它当作 bearer 秘密，存入 secret store 或权限 `0600` 的文件，并通过 `--auth-file` 或 `APPLE_CONNECTOR_AUTH` 传入。任何 CLI 命令都不会打印它。旧提示词可能包含显式 `Credential file` / `凭据文件` 路径；`--auth-file <path>` 仍然可用。

## 服务生命周期

`init` 和 `open` 会在需要时启动服务。`start` 启动后台 Node 服务和持有权限的 helper App；`start --foreground` 让 Node 服务留在当前终端；`stop` 同时停止两者；`status` 报告服务与 helper 状态。从 v0.17.0 起 helper 以 `dist/native/AppleConnector.app` 运行，因此 macOS 把日历/提醒事项权限记在 Apple Connector 名下，而不是启动它的终端。App 与 Node 服务通过 `<state dir>/helper.sock` 使用现有 JSONL 协议通信。

`doctor` 通过该 socket 读取 helper 权限，并单独报告 JXA probe。JXA probe 通过 `osascript` 运行，反映的是启动 CLI 的进程，而不是 Apple Connector App。`APPLE_CONNECTOR_HELPER_MODE=direct` 直接启动 helper，供测试、CI 和无 GUI 排障使用；该模式下权限重新跟随宿主 App。

`status` 的 JSON 输出新增 `helper` 对象（`running`、`pid`、`socket`）和 `health` 对象。只有 pid 文件与 socket 同时存在时，helper 才被视为运行中。如果 `status` 显示服务在运行但 helper 已停止，重新运行 `start`，或查看 `<state dir>/helper.log`。

### 命令速查

| 命令 | 用途 |
| --- | --- |
| `init`、`open`、`start`、`stop`、`status` | 本机服务与管理页生命周期 |
| `doctor [--probe]` | 版本、平台、helper 权限（以及宿主归属的 JXA probe） |
| `skill path` | 随包 Skill 目录的绝对路径与包版本 |
| `auth show`、`auth verify` | 查看或绑定本机 profile 背后的授权 |
| `calendar list-calendars`、`calendar list` | 读取日历与事件 |
| `calendar create`、`update`、`delete` | 事件写入 |
| `reminder list-lists`、`reminder list` | 读取提醒列表与提醒 |
| `reminder create`、`patch`、`update`、`complete`、`delete` | 提醒写入 |
| `operation get` | 在 `outcome_unknown` 后查询持久化操作记录 |
| `migrate-state` | 移动旧的 `~/apple-connector` 状态目录 |

具体参数以 `apple-connector help <命令>` 的当前版本输出为准。

## 提醒事项

`reminder list` 返回的每一项都含 `due` 和 `recurring`。`due` 为 `null` 或以下之一：

```json
{"kind":"date","date":"2026-11-20"}
{"kind":"floating","date":"2026-11-20","time":"17:00:00"}
{"kind":"instant","at":"2026-11-20T17:00:00+08:00","timeZone":"Asia/Shanghai"}
```

- `date` 是无时区的全天到期。
- `floating` 是无时区的墙钟时间到期。
- `instant` 是带时区的到期时间。同一份本机 EventKit 数据会保留其 IANA 时区；若 EventKit 只报告固定偏移而没有 IANA 标识，则显示为 `floating`。
- `recurring: true` 表示连接器会以 `unsupported_operation` 拒绝该提醒的 patch、update、complete 和 delete。

`reminder patch` 只修改 `--input` 中出现的字段：

```text
apple-connector reminder patch --list-id <listId> --id <reminderId> \
  [--due <RFC3339> | --due-date <YYYY-MM-DD> | --clear-due] [--time-zone <IANA>] \
  [--completed | --not-completed] \
  --input <file> --idempotency-key <key> --auth-key <key> --json
```

私有的 `title` 和 `body` 放在所有者可读的 `--input` 文件中，不要放在命令行。`due: null` 清除到期时间；`completed: false` 重新打开提醒。`reminder update` 仍是 `title`、`body` 和 `completed` 的完整替换。

`calendarItemIdentifier` 在同一份本机 EventKit 数据存储内的普通编辑中是稳定的。完整同步、账户重置或数据存储重建可能使其失效；应重新列表解析 ID，而不是把找不到的 ID 当作已删除。

## 授权

授权创建后不可编辑。一个授权应只对应一个 Agent，可以同时包含日历容器和提醒事项容器，每个容器分别选择动作。授权 key 是本机 profile 标识（token 文件名）；授权码是管理页只显示一次、同时写入所有者可读本地文件的 bearer token。

```text
apple-connector auth show --auth-key <key> --json
apple-connector auth show --auth-file <path> --json
apple-connector auth show --auth <token> --json
apple-connector auth verify --agent <name> --auth-key <key> --json
apple-connector auth verify --agent <name> --auth <token> --json
```

`auth show` 返回授权名称、授权范围、过期时间、最近使用时间、`agentName` 和 `verifiedAt`。它永远不会返回 token、token 哈希或内部记录 ID。

`auth verify` 要求 `--agent`（去除首尾空白后 1–100 个字符），用同一 bearer token 认证，把 `agentName` 和 `verifiedAt` 写入授权，并追加一条 `agent_verified` 审计事件。重复运行会更新最近的绑定。Agent 名称由调用方自报，但调用方必须持有有效授权码。`clients.list` 和 `auth.describe` 也会返回 `agentName` 和 `verifiedAt`；首次验证前两者为 `null`。

没有审批步骤：授权范围内的写入会立即执行。删除授权会使其 token 失效、移除本地 token 文件并丢弃绑定；审计事件仍会保留。

## 状态迁移

`apple-connector migrate-state [--json]` 把旧的 `~/apple-connector` 目录移动到 `~/.apple-connector`。它会先停止旧服务和管理页进程，等待服务退出，删除残留运行时文件（`service.sock`、pid 文件、admin URL），然后重命名目录。数据库、管理 token、`profiles/`、授权 token 文件、审计和日志都会保留。

- `migrated: false` 表示没有旧目录。
- 非空目标目录永远不会被合并；命令返回 `conflict`，并保持两个目录不变。
- 该命令要求 `APPLE_CONNECTOR_STATE_DIR` 未设置。

## 环境变量

| 变量 | 使用方 | 含义 |
| --- | --- | --- |
| `APPLE_CONNECTOR_STATE_DIR` | CLI、服务 | 覆盖状态目录（默认 `~/.apple-connector`）。`migrate-state` 时必须未设置。 |
| `APPLE_CONNECTOR_AUTH` | CLI | 直接传入授权码。优先使用 `--auth-file` 或 `--auth-key`，避免 token 出现在 shell 历史和进程参数中。 |
| `APPLE_CONNECTOR_HELPER_MODE` | CLI、服务 | 设为 `direct` 时以子进程方式启动 helper，而不经过 `AppleConnector.app`。仅用于开发、CI 和无 GUI 排障；该模式下权限跟随宿主 App。 |
| `APPLE_CONNECTOR_HELPER_SOCKET` | 服务（内部） | 生命周期注入给 Node 服务的 socket 路径。通常不需要手动设置。 |
| `APPLE_CONNECTOR_SIGN_IDENTITY` | 仅构建 | 覆盖 `build:native` 使用的代码签名身份。优先级：该变量 → `.signing-identity` → `Apple Connector Local`。 |
| `APPLE_CONNECTOR_ALLOW_ADHOC` | 构建、CI、测试 | 设为 `1` 时允许在缺少身份的情况下使用 ad-hoc 签名。永远不要发布这种构建，也不要覆盖正常安装。 |
| `APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID` | 仅原生测试 | 选择启用提醒测试：在指定测试列表中创建并删除 UUID 探针。默认关闭。 |
| `NO_COLOR` | CLI | 禁用 ANSI 颜色，等同于 `--no-color`。 |
| `APPLE_CONNECTOR_WEB_EXPIRES_AT` | 管理页（内部） | 一小时管理进程启动时注入的过期时间戳。 |

## 相关文档

- [文档索引](README_zh.md) — 全部指南与版本历史。
- [快速开始](getting-started_zh.md) — 首次接入路径。
- [系统权限](system-permissions_zh.md) — `AppleConnector.app` 的 TCC 身份。
- [签名说明](signing_zh.md) — 自签名证书与发布构建。
- [升级指南](v0.8-to-v0.9-migration.md) — 跨大版本的变更。
