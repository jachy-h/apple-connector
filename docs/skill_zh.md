# Skill 工作流

[English](skill.md) · 中文

用宿主文档中的 Agent Skills 机制安装 `apple-connector skill path --json` 返回的目录。Skill 使用标准的 `name` 和 `description` frontmatter，不依赖特定宿主。随包文件是 [skill/SKILL.md](../skill/SKILL.md)。

如果宿主无法持久保存 Skill，Agent 可以在当前会话中读取 `SKILL.md`，并如实说明这一限制。用户粘贴 Agent 提示词后，Agent 应先用 `skill path` 加载 Skill，优先使用 `Authorization key` / `授权 key` 并通过 `--auth-key` 传入，再用 `auth verify --agent <名称>` 完成绑定，最后执行一次有界只读查询。CLI 会自行解析 owner-only 凭据；不要读取、复制、扫描或打印 profile 目录中的 token 文件。旧提示词可能提供 `Credential file` 路径（`--auth-file`）或授权码；授权码应存入 secret store 或权限 `0600` 的 owner-only 文件，且永不回显。需要授权名称、范围或过期时间时使用 `auth show`。接入页会自动观察到该绑定。不要扫描状态目录或 profile 目录寻找 token，也不要轮询管理页。

从 v0.17.0 起，macOS 的日历/提醒事项权限属于 Apple Connector App。如果接入页报告 `not_determined`、`denied` 或 `restricted`，必须由用户在该页或系统设置中授权；不要请求完全磁盘访问。`permission_denied` 可能表示系统权限缺失，也可能表示授权范围过窄。见[系统权限](system-permissions_zh.md)。

更新指安装目标 CLI 版本、重新解析 `skill path`，并刷新宿主的 Skill 导入。撤销 Agent 指在接入页删除其授权；删除后 token 立即失效，审计历史仍会保留。

## 相关文档

- [快速开始](getting-started_zh.md) — 面向使用者的接入流程。
- [Agent 安装说明](install-for-agent_zh.md) — Agent 接入前应完成的检查。
- [CLI 参考](cli_zh.md) — 全部命令与参数。
- [文档索引](README_zh.md) — 全部指南与版本历史。
