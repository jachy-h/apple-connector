# 快速开始

首次接入由 Agent 引导：先检查当前项目的 `npm link`（未链接时在该项目运行 `npm install`）、加载 Skill、运行 `agent init`、在这台 Mac 完成本机页面、回复 Agent，再由它做一次有界只读验证。页面会显示可见容器的名称和稳定 ID；只选择 profile 实际需要的容器。

撤销 Agent 请运行 `apple-connector open --section agents` 并撤销 profile。修改 macOS 权限请前往「系统设置 → 隐私与安全性 → 日历或提醒事项」。链接过期后重新运行 `agent init`。不要把 credential 粘贴到聊天中，不要开放本机端口，也不要用新幂等 key 重试 `outcome_unknown` 写入。
