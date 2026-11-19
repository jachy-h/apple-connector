# 分发决策：暂缓独立 App / Homebrew Cask 分发

- 日期：2026-11-16（2026-11-19 更新）
- 状态：已决定，暂缓
- 范围：独立 `.app`、Homebrew Cask、预编译二进制等公开分发包
- 不在范围：本机源码构建、现有 npm CLI 安装路径

## English summary

Apple Connector is distributed only through npm and local source builds. Public `.app`,
DMG, prebuilt binary and Homebrew Cask distribution remain deferred, and the project does
not buy an Apple Developer Program membership. Since v0.17.0 the npm package contains a
self-signed `AppleConnector.app` so that macOS records Calendar/Reminders permission for
Apple Connector and keeps the grant across upgrades. That App is not notarized: a copy
downloaded through a browser may be blocked by Gatekeeper, and public install/upgrade/
uninstall flows are not yet validated. The Chinese sections below record the full decision
and the original reasoning.

## 决策

暂不投入独立 App / Homebrew Cask / 预编译二进制的公开分发，也暂不购买 Apple Developer Program。Apple Connector 目前只支持在本机从源码或 npm 安装运行。

## 2026-11-19 v0.17.0 更新

v0.17.0 已让 EventKit helper 以自签名 `AppleConnector.app` 运行，TCC 权限归属于 Apple Connector，不再跟随 Terminal/OpenCode 等宿主。该 App 随 npm 包分发，不需要 Developer ID 或公证，也能在升级后保留授权。

公开 `.app` / DMG / Homebrew Cask 仍然暂缓：自签名 App 未公证，浏览器下载的副本可能被 Gatekeeper 拦截；安装、升级、卸载体验也尚未验证。npm 与本机源码安装是当前支持路径。下文第 1 条“TCC 归属”描述的是 v0.16.x 及更早版本的状态，保留作为背景。

## 原因

1. **TCC 归属（v0.17.0 之前）**：macOS 按负责进程（responsible process）记录 EventKit 权限。v0.16.x 及更早版本中，CLI 从终端启动，权限归终端 App，而不是 Apple Connector。v0.17.0 已通过自签名 App 解决 EventKit 的归属问题；但独立的公开 App 还需要验证启动、升级和卸载链路。
2. **Apple Gatekeeper**：面向外部用户的 `.app` 分发需要 Developer ID 签名与 notarization，否则首次打开会被 Gatekeeper 拦截。这个发布链路需要 Apple Developer Program（约 $99/年）以及持续的签名、公证和升级维护。
3. **成本与收益不匹配**：当前项目是本地 CLI 工具，公开分发的主要收益是安装体验和独立 TCC 身份；在权限归属、Node 运行时打包、单实例管理、升级和旧授权迁移都未验证前，不值得先投入发布链路。

## 影响

- v0.16.x 及更早版本中，系统设置里的日历/提醒事项权限归启动服务的终端 App；v0.17.0 起归 Apple Connector App。
- 不新增 Homebrew Cask、独立 `.app`（公开分发形式）或预编译二进制下载。
- README 和本机管理首页展示“暂缓分发”状态。
- 不改变现有 CLI、native helper 协议、npm/源码安装路径或 Agent 授权模型。

## 重新评估条件

满足任一条件时重新评估：

- 决定投入签名 `.app` + Developer ID + notarization + 发布链；
- 验证 LaunchAgent / `brew services` 启动方式能提供可接受的 TCC 归属、显示名和升级稳定性；
- 产品目标改为面向开发者或内部使用，不再追求独立 App 的权限归属。

## 相关文档

- [文档索引](./README_zh.md)
- [v0.5.0 计划：权限与分发设计](./v0.5.0-plan.md)
- [v0.11.0 计划](./v0.11.0-plan.md)
- [v0.17.0 计划：用自签名 App 承载权限身份](./v0.17.0-plan.md)
- [原生验证说明](./native-validation.md)
- [签名说明](./signing_zh.md)
- [系统权限说明](./system-permissions_zh.md)
