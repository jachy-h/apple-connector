# Apple Connector

Apple Connector 是用于 Apple 日历和提醒事项的本地 CLI。管理页面仅监听本机 loopback，且一小时后过期；不提供局域网、云端或 MCP 入口。

> **分发状态：** 暂不提供独立 `.app` 下载、DMG 或 Homebrew Cask。请通过 npm 或本机源码构建安装；公开公证分发仍然暂缓。详见[分发决策](docs/distribution-decision.md)。

状态目录默认为 `~/.apple-connector`；如果从使用 `~/apple-connector` 的旧版本升级，请执行一次 `apple-connector migrate-state`。

从 v0.17.0 起，EventKit helper 运行在自签名 `AppleConnector.app` 中。macOS 把日历/提醒事项权限记在 **Apple Connector** 名下，而不是 Terminal 或 Agent 宿主；只要签名身份不变，升级后授权会保留。详见[系统权限](docs/system-permissions_zh.md)和[签名](docs/signing_zh.md)。

## 面向人类：四步接入

1. **安装 CLI**：在本项目运行 `npm link`，或执行 `npm install -g @jachy/apple-connector`。用 `apple-connector version` 确认。从源码构建时，先按[签名说明](docs/signing_zh.md)创建一次自签名身份，运行 `npm ci && npm run build`，再执行 `npm link`。
2. **运行 `apple-connector init`**：它会初始化本机状态、启动或复用服务、打开本机管理页；页面一小时后过期。后续再次运行等同于 `open`。
3. **在接入页按顺序完成授权**：第 1 步授予 macOS 权限（弹窗名称是 **Apple Connector**）；第 2 步为单个 Agent 选择日历和提醒事项容器、动作并创建授权；第 3 步列出全部授权并复制对应提示词。
4. **让 Agent 完成验证**：把提示词粘贴给 Agent。Agent 运行 `apple-connector auth verify --agent <名称>` 后，接入页第 4 步会立即显示“Agent 已绑定”。

新建授权时，页面会提供两种 Agent 提示词：

- **推荐版**：使用授权 key，**不包含授权码**；由本机 apple-connector 自动解析 owner-only 凭据。把这一版复制给 Agent。
- **备用版**：包含授权码。仅在无法使用授权 key 时使用；它会留在聊天记录中。

已有授权只显示推荐版提示词，因为授权码只在创建时返回一次。授权创建后不可编辑；需要变更时删除并重新创建。后续用 `apple-connector open` 打开接入、审计或使用文档页面。页面过期后重新运行 `apple-connector init`。

从 v0.16.x 或更早版本升级后，权限归属变为 Apple Connector，需要在接入页重新授权日历/提醒事项一次。旧的 Terminal/OpenCode 权限条目不再使用。

## 面向 Agent

Apple Connector 面向运行在同一台 Apple Silicon Mac（macOS 14+、受支持 Node 版本）上的 Agent。它不绑定任何宿主：Agent 只需能执行 CLI 并读取随包提供的 [Skill](skill/SKILL.md)。

当用户粘贴接入提示词时：

1. 执行 `apple-connector skill path --json` 加载随包 Skill，后续按其中的规则操作。
2. 执行 `apple-connector auth verify --agent '<你的名称>' --auth-key '<key>' --json` 完成绑定；本机接入页会立即显示“Agent 已绑定”。授权 key 是本机授权标识，不是 bearer 秘密：用 `--auth-key` 传入后由 CLI 自行解析凭据。不要读取、复制、扫描或打印 profile 目录中的 token 文件。如果提示词包含的是授权码，立即存入宿主 secret store 或权限 `0600` 的 owner-only 文件，通过 `APPLE_CONNECTOR_AUTH` 或 `--auth-file` 传入，不要回显。旧提示词可能包含显式 `Credential file` / `凭据文件` 路径；用 `--auth-file` 传入，但不要读取或打印。需要查看授权名称、范围或过期时间时，运行 `apple-connector auth show --auth-key '<key>' --json`。
3. 用一次有界只读查询验证：`calendar list-calendars` 或 `reminder list-lists`。

如果提示词缺失或已过期，请让用户重新运行 `apple-connector init`。不要在授权验证前扫描状态目录或 profile 目录寻找 token，也不要调用业务命令。

手动安装、恢复和删除请参阅[快速开始](docs/getting-started_zh.md)、[Agent 安装说明](docs/install-for-agent_zh.md)、[系统权限](docs/system-permissions_zh.md)、[签名说明](docs/signing_zh.md)、[Skill 参考](docs/skill_zh.md)和 [CLI 参考](docs/cli_zh.md)。

所有机器接口使用 `--json`；写入必须提供幂等 key 和授权 ID。参见[升级指南](docs/v0.8-to-v0.9-migration.md)。

## 文档

- [文档索引](docs/README_zh.md) — 全部指南与完整版本历史
- [快速开始](docs/getting-started_zh.md) · [English](docs/getting-started.md)
- [CLI 参考](docs/cli_zh.md) · [English](docs/cli.md)
- [系统权限](docs/system-permissions_zh.md) · [English](docs/system-permissions.md)
- [不购买 Apple Developer 时的签名](docs/signing_zh.md) · [English](docs/signing.md)
- [Skill 参考](docs/skill_zh.md) · [English](docs/skill.md)
- [分发决策](docs/distribution-decision.md)
