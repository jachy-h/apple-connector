# Apple Connector Agent 安装说明

仅在将访问用户日历或提醒事项的同一台 Apple Silicon Mac 上执行。要求 macOS 14+、Node `>=24.20.0 <25 || >=26.8.1 <27`，以及能运行本机命令的 Agent。

1. 执行 `uname -m`、`sw_vers -productVersion`、`node --version`；确认 Apple Silicon、macOS 14+ 和受支持的 Node 版本，不兼容时停止并说明原因。
2. 执行 `npm ls -g --depth=0 @jachy/apple-connector`；确认它通过 `npm link` 指向当前项目。若未链接，在当前项目执行 `npm install`；此流程不要安装 registry 包。
3. 执行 `apple-connector version --json` 和 `apple-connector skill path --json`；按当前宿主的官方方式导入返回的目录，并报告该加载能否跨会话保留。
4. 执行 `apple-connector agent init --json`；保存 `onboardingId`，并告知用户：`请打开[授权链接](URL)，完成授权后在此回复「已完成」。` 将 `URL` 替换为本机临时 URL，并附上剩余有效期。
5. 等用户回复“已完成”，然后执行 `apple-connector agent init-status --id <onboardingId> --json`。
6. `configured` 时仅将 `credentialFile` 用于一次有界只读命令：`calendar list-calendars` 或 `reminder list-lists`；不要输出它。`pending` 时继续等待；`expired` 时重新初始化。

临时页面由用户操作。在用户回复前，Agent 不得打开页面、轮询 onboarding 状态或进行业务调用；页面仅在点击后请求 macOS 权限，并允许用户选择容器和 profile 动作，无需在对话中复制 token。
