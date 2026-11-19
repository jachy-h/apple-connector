# Apple Connector 文档

[English](README.md) · 中文

本目录分为四部分：面向这台 Mac 使用者的指南、面向 Agent 与自动化的参考、macOS
集成说明，以及版本历史。

当前版本：**0.17.0**。每个版本的方案与进度记录见[版本历史](#版本历史)。

## 从这里开始

| 文档 | 读者 | 内容 |
| --- | --- | --- |
| [快速开始](getting-started_zh.md) · [English](getting-started.md) | 使用者 | 安装、`init`、系统授权、单个 Agent 授权与验证 |
| [Agent 安装说明](install-for-agent_zh.md) · [English](install-for-agent.md) | Agent | 前置检查、随包 Skill、绑定授权、首次只读查询 |
| [CLI 参考](cli_zh.md) · [English](cli.md) | 使用者与 Agent | 命令、JSON 信封、授权输入、环境变量 |
| [Skill 参考](skill_zh.md) · [English](skill.md) | Agent | 随包 Skill 的加载与使用方式 |
| [系统权限](system-permissions_zh.md) · [English](system-permissions.md) | 使用者 | TCC、`AppleConnector.app` 身份、状态值、排障 |
| [签名说明](signing_zh.md) · [English](signing.md) | 从源码构建的人 | 自签名证书、签名构建、验证与轮换 |
| [分发决策](distribution-decision.md) | 维护者 | 为什么暂缓公开 `.app` / Homebrew 分发 |
| [升级指南](v0.8-to-v0.9-migration.md) | 升级中的用户 | 移除 MCP 入口、旧状态目录、v0.17 权限归属 |
| [原生验证](native-validation.md) | 维护者 | EventKit、helper 与 TCC 验证记录 |

## 常见路径

**首次从源码安装**

```bash
npm run signing:check        # 缺少身份时先创建（docs/signing_zh.md）
npm ci && npm run build
npm link
apple-connector version
apple-connector init
```

**日常使用**

```bash
apple-connector status       # 服务与 helper 状态
apple-connector open         # 接入、审计、使用文档
apple-connector doctor       # 版本、平台、helper 权限
```

**排障顺序**

1. `apple-connector status`：服务是否运行，helper App 是否运行。
2. `apple-connector doctor`：helper 权限是否为 `full_access`。
3. 接入页第 1 步：权威的系统权限状态。
4. 授权范围与过期时间：容器、动作和时间范围。
5. `outcome_unknown`：用 `operation get` 核对；不要换新的幂等 key 重试。

完整权限流程见[系统权限](system-permissions_zh.md)。

## macOS 集成

从 v0.17.0 起，日历与提醒事项权限属于自签名 `AppleConnector.app`（bundle id
`com.jachy.apple-connector`），不再属于 Terminal、OpenCode 或其他 Agent 宿主。Node
服务通过 `<state dir>/helper.sock` 调用 helper。只要 bundle id 和签名证书不变，重建与
升级后授权都会保留。先读[系统权限](system-permissions_zh.md)；从源码构建时再读
[签名说明](signing_zh.md)。

## 版本历史

每个版本都有方案与进度记录。下表按版本列出主题与入口。这些记录只保存在仓库中，不包含在
npm 包内；请通过 GitHub 仓库打开。

| 版本 | 主题 | 记录 |
| --- | --- | --- |
| 0.1.x | 原型基线 | [0.1.0 方案](v0.1.0-plan.md) · [进度](v0.1.0-progress.md) · [0.1.1 方案](v0.1.1-plan.md) · [进度](v0.1.1-progress.md) |
| 0.2.0 | 原生能力验证与支持矩阵 | [方案](v0.2.0-plan.md) · [进度](v0.2.0-progress.md) · [矩阵](v0.2.0-support-matrix.md) |
| 0.3.0 | 可靠的本机服务 | [方案](v0.3.0-plan.md) · [进度](v0.3.0-progress.md) |
| 0.4.0 | Web 调试 MVP | [方案](v0.4.0-plan.md) · [进度](v0.4.0-progress.md) |
| 0.5.0 | TypeScript + 常驻 Swift helper | [方案](v0.5.0-plan.md) · [进度](v0.5.0-progress.md) |
| 0.6.x | 提醒事项与日历网页管理 | [0.6.0](v0.6.0-plan.md) · [0.6.1](v0.6.1-plan.md) · [0.6.2](v0.6.2-plan.md) · [0.6.3](v0.6.3-plan.md) · [0.6.4](v0.6.4-plan.md) · [0.6.5](v0.6.5-plan.md) |
| 0.7.0 | 暂时屏蔽备忘录 | [方案](v0.7.0-plan.md) · [进度](v0.7.0-progress.md) |
| 0.8.x | stdio MCP、npm 发布、Agent-first README | [0.8.0](v0.8.0-plan.md) · [0.8.1](v0.8.1-plan.md) · [0.8.2](v0.8.2-plan.md) · [0.8.3](v0.8.3-plan.md) · [0.8.4](v0.8.4-plan.md) |
| 0.9.x | Skill + CLI 主入口、管理 Web、内存修复 | [0.9.0](v0.9.0-plan.md) · [0.9.1](v0.9.1-plan.md) · [0.9.2](v0.9.2-plan.md) · [0.9.3](v0.9.3-plan.md) · [0.9.4](v0.9.4-plan.md) · [0.9.5](v0.9.5-plan.md) · [0.9.6](v0.9.6-plan.md) · [0.9.7](v0.9.7-plan.md) |
| 0.10.0 | Reminder patch、结构化 due、重复标记 | [方案](v0.10.0-plan.md) · [进度](v0.10.0-progress.md) |
| 0.11.0 | 逐容器授权与撤销 | [方案](v0.11.0-plan.md) · [进度](v0.11.0-progress.md) |
| 0.12.0 | 系统权限说明与使用文档 | [方案](v0.12.0-plan.md) · [进度](v0.12.0-progress.md) |
| 0.13.0 | `help` / `version`、终端样式 | [方案](v0.13.0-plan.md) · [进度](v0.13.0-progress.md) |
| 0.14.x | 不可变授权、一次性 token、状态目录 | [0.14.0](v0.14.0-plan.md) · [0.14.1](v0.14.1-plan.md) |
| 0.15.x | 简化接入链路、日历字段收敛 | [0.15.0](v0.15.0-plan.md) · [0.15.1](v0.15.1-plan.md) |
| 0.16.x | 合并接入页、Agent 绑定、审计热力图 | [0.16.0](v0.16.0-plan.md) · [0.16.1](v0.16.1-plan.md) · [0.16.2](v0.16.2-plan.md) · [0.16.3](v0.16.3-plan.md) |
| 0.17.0 | 自签名 `AppleConnector.app` 承载 TCC 身份 | [方案](v0.17.0-plan.md) · [进度](v0.17.0-progress.md) |

0.2.0 之前的版本同时链接方案与进度。后续版本表中只列方案；每个方案在同目录都有对应的 `-progress.md` 进度记录。
