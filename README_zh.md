# Apple Connector

Apple Connector 是用于 Apple 日历和提醒事项的本地 CLI。管理页面仅监听本机 loopback，且一小时后过期；不提供局域网、云端或 MCP 入口。

## 接入 Agent

Apple Connector 面向运行在同一台 Apple Silicon Mac（macOS 14+、受支持 Node 版本）上的 Agent。它不绑定任何宿主：Agent 只需能执行 CLI 并读取随包提供的 [Skill](skill/SKILL.md)。

将下面的指令交给 Agent：
```text
接下来要执行 `@jachy/apple-connector` 的安装:
1. 执行 `uname -m`、`sw_vers -productVersion` 和 `node --version`，确认这台 Mac 是 Apple Silicon、macOS 14 或更高版本，并使用受支持的 Node 版本；任一检查失败时停止并说明原因。
2. 执行 `npm ls -g --depth=0 @jachy/apple-connector`，确认 `apple-connector` 已通过 `npm link` 指向当前项目；若未链接，请执行 `npm install -g @jachy/apple-connector` 安装。
3. 执行 `apple-connector skill path --json`，按当前 Agent 支持的方式加载返回的 Skill 目录，并报告该加载是否可跨会话保留。
4. 执行 `apple-connector agent init --json`，保存其中的 `onboardingId`，并向我发送：`请打开[授权链接](URL)，完成授权后在此回复「已完成」。` 将 `URL` 替换为返回的本机 URL，并附上剩余有效时间。
5. 等待我在本机页面完成操作后回复“已完成”。
6. 执行 `apple-connector agent init-status --id <onboardingId> --json`。若为 configured，只将返回的 credential-file 路径用于一次有界的日历或提醒事项只读查询；否则说明 pending 或 expired 状态，并继续等待或重新初始化。
```
Agent 会给出本机临时 Markdown 链接。请在页面中授予 macOS 权限、选择可见的日历或提醒事项容器、设置允许动作并创建 profile；然后回到同一个 Agent 回复“已完成”。Agent 会等到这条回复后再检查，并以有界读取验证；容器为空也属于连接成功。

手动安装、恢复和撤销请参阅[快速开始](docs/getting-started_zh.md)、[Agent 安装说明](docs/install-for-agent_zh.md)、[Skill 参考](docs/skill.md)和 [CLI 参考](docs/cli.md)。

所有机器接口使用 `--json`；写入必须提供幂等 key 和 profile 凭证。参见 [v0.8 迁移指南](docs/v0.8-to-v0.9-migration.md)。
