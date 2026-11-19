# Apple Connector Agent 安装说明

[English](install-for-agent.md) · 中文

本指南只用于将要访问用户日历或提醒事项的同一台 Apple Silicon Mac。要求 macOS 14+、Node `>=24.20.0 <25 || >=26.8.1 <27`，并且 Agent 能执行本机命令。

1. 执行 `uname -m`、`sw_vers -productVersion` 和 `node --version`，确认 Apple Silicon、macOS 14+ 和受支持的 Node 版本；不满足时停止并说明原因。
2. 执行 `npm ls -g --depth=0 @jachy/apple-connector`，确认它通过 `npm link` 指向当前项目；若未链接，在当前项目执行 `npm install`。不要为这个工作流安装 registry 包。从源码构建时，先按[签名说明](signing_zh.md)创建一次自签名身份并运行 `npm run build`，再执行 `npm link`。不要给用户长期使用的安装使用 `APPLE_CONNECTOR_ALLOW_ADHOC=1`。
3. 执行 `apple-connector version --json` 和 `apple-connector skill path --json`，按宿主 Agent 的官方方式加载返回的 Skill 目录。如果无法跨会话保留，如实说明。
4. 告知用户：`请在这台 Mac 运行 apple-connector init，在接入页完成系统权限和授权，然后把生成的 Agent 提示词粘贴到这里。` 不要用运行 `init` 代替用户完成授权。
5. 用户粘贴提示词后，加载随包 Skill 并按内容处理：
   - 优先使用 `Authorization key` / `授权 key`，通过 `--auth-key <key>` 传入；CLI 会自动解析 owner-only 凭据。不要读取、复制、扫描或打印 profile 目录中的 token 文件。
   - 如果提示词包含的是授权码，立即存入宿主 secret store 或权限 `0600` 的 owner-only 文件，再通过 `APPLE_CONNECTOR_AUTH` 或 `--auth-file` 传入。不要回显。旧提示词可能包含显式 `Credential file` / `凭据文件` 路径；用 `--auth-file` 传入，但不要读取或打印。
6. 执行 `apple-connector auth verify --agent '<你的名称>' --auth-key '<key>' --json` 完成绑定；成功后在回复中说明“已在接入页显示 Agent 已绑定”，不要回显授权码。需要授权名称、范围或过期时间时，运行 `apple-connector auth show --auth-key '<key>' --json`。
7. 根据授权范围执行一次有界只读查询：`calendar list-calendars` 或 `reminder list-lists`。容器为空也代表接入成功。

如果提示词缺失、不完整或已过期，让用户重新运行 `apple-connector init`。不要在授权验证前扫描状态目录或 profile 目录寻找 token、复用旧链接或调用业务命令。

临时页面由用户操作；页面仅在点击后请求 macOS 权限，并允许用户为每个容器选择动作。从 v0.17.0 起弹窗名称是 **Apple Connector**；从 v0.16.x 升级需要重新授权一次，见[系统权限](system-permissions_zh.md)。授权创建后不可编辑；删除后授权码立即失效。绑定信息保存在授权记录中，页面会自动刷新。

全部指南见[文档索引](README_zh.md)。
