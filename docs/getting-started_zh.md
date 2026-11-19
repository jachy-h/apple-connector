# 快速开始

[English](getting-started.md) · 中文

本指南面向使用这台 Mac 的人。Agent 不会代替你创建系统权限或授权。

1. **安装 CLI**：在本项目运行 `npm link`，或执行 `npm install -g @jachy/apple-connector`。用 `apple-connector version` 确认。必须运行在将要访问日历或提醒事项的同一台 Apple Silicon Mac 上，macOS 14+，并使用受支持的 Node 版本。从源码构建时，先创建签名身份，运行 `npm ci && npm run build`，再执行 `npm link`；见[签名说明](signing_zh.md)。
2. **运行 `apple-connector init`**：它会初始化 `~/.apple-connector`、启动或复用本机服务、打开本机管理页，并返回一个一小时后过期的 loopback 链接。后续再次运行等同于 `open`。
3. **第 1 步：系统授权**：在接入页请求日历和/或提醒事项访问。macOS 弹窗名称是 **Apple Connector**，选择完整访问。没有完全访问权限时，第 2 步保持锁定。状态含义与排障见[系统权限](system-permissions_zh.md)。
4. **第 2 步：单独 Agent 授权**：为单个 Agent 选择需要的容器和动作。过期时间默认一年，可调整。授权创建后不可编辑；需要变更时删除并重新创建。
5. **第 3 步：复制提示词**：页面会列出全部未撤销的授权及各自的提示词。对于刚创建的授权，推荐版提示词使用授权 key，不包含授权码；本机 CLI 会自动解析 owner-only 凭据。已有授权只显示推荐版提示词，因为授权码只在创建时返回一次。复制你要接入的那个 Agent 的提示词。仅当无法使用授权 key 时，才使用包含授权码的备用版。
6. **第 4 步：Agent 完成验证**：Agent 会加载随包 Skill，运行 `auth verify --agent <名称>` 完成绑定，再执行一次有界只读查询。需要名称、范围或过期时间时运行 `auth show`。接入页会自动刷新，显示“Agent 已绑定”及验证时间。

管理页会显示可见容器的名称和稳定 ID。授权码只显示一次，同时写入所有者可读的本地凭据文件。不要把备用提示词或授权码粘贴到不可信的聊天中。

“使用文档”页提供完整命令参考、示例与排查步骤，也可运行 `apple-connector help` 或 `apple-connector help <topic>`。修改 macOS 权限请前往「系统设置 → 隐私与安全性 → 日历或提醒事项」。链接过期后重新运行 `apple-connector init`。后续管理使用 `apple-connector open --section <setup|audit|docs>`；旧的 `permissions`、`agents` 仍会落到接入页。不要开放本机端口，也不要用新幂等 key 重试 `outcome_unknown` 写入。

CLI、Skill、签名、权限与升级参考见[文档索引](README_zh.md)。

从 v0.17.0 起，日历/提醒事项权限属于 `AppleConnector.app`，不再属于 Terminal 或 Agent 宿主。从 v0.16.x 或更早版本升级后，需要在接入页重新授权一次。使用同一签名身份重建会保留授权；见[签名说明](signing_zh.md)。
