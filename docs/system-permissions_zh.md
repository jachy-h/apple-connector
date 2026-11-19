# macOS 权限与 Apple Connector App

[English](system-permissions.md) · 中文

Apple Connector 通过 EventKit 读取日历和提醒事项。macOS 用 TCC（透明度、同意与控制）保护这两类数据。权限不挂在某条命令、某个脚本或某个普通 helper 进程上，而是挂在**负责进程所属的 App 身份**上。

从 v0.17.0 起，Apple Connector 的 EventKit helper 以
`AppleConnector.app`（bundle id `com.jachy.apple-connector`）运行。因此系统设置里显示的是 **Apple Connector**，只要签名身份不变，升级后授权就会保留。证书设置见 [signing_zh.md](./signing_zh.md)。

## 与旧版本的区别

v0.16.x 及更早版本中，helper 是 Node 服务的普通子进程。TCC 会把权限记在启动服务的 App 上——Terminal、iTerm2、OpenCode 或其他 Agent 宿主。由此产生两个问题：

- 系统设置显示的是宿主 App，不是 Apple Connector。
- 从另一个宿主启动服务、或修改宿主的权限，会悄悄改变 Apple Connector 能读什么。

在那个架构下，重建 helper 并不会改变权限；权限属于宿主。从 v0.17.0 起，权限属于 App 自己。

## 首次授权

1. 运行 `apple-connector init`（或 `apple-connector open`）。
2. 在接入页第 1 步点击 **请求日历权限** 和/或 **请求提醒事项权限**。
3. macOS 弹窗显示 **Apple Connector**，选择 **允许完整访问**。
4. 页面会自动刷新 App 报告的状态。需要另一个服务时重复一次。

也可以打开系统设置 → **隐私与安全性 → 日历** 或 **提醒事项**。
里面应出现 **Apple Connector**，并处于完整访问状态。如果你以前给 Terminal/OpenCode 授过日历或提醒事项，那些旧条目仍会保留，但 v0.17.0 不再使用，可以关闭。

App 只会在你点击时请求对应服务，不会为日历/提醒事项请求完全磁盘访问、自动化或屏幕录制权限。

## 查看当前状态

- **管理页 → 接入 → 第 1 步**：权威状态，直接来自 helper App。
- `apple-connector status`：显示服务状态和 helper App 是否运行。
- `apple-connector doctor`：通过 helper socket 读取 App 的权限。单独的 **JXA probe**（`--probe`）通过 `osascript` 运行，反映的是启动 CLI 的进程，而不是 Apple Connector App，不能用它判断 App 的权限。

状态值：

| 状态 | 含义 |
| --- | --- |
| `full_access` | App 可以读写该服务。 |
| `write_only` | 只有写入权限；`list-calendars` 等读取会失败。请重新请求完整访问。 |
| `not_determined` | App 从未获得该服务授权，或这是新的签名身份。请请求授权。 |
| `denied` | 用户在系统设置中关闭了 App（或拒绝了弹窗）。 |
| `restricted` | 被 MDM、家长控制或系统策略限制。 |
| `unknown` | helper 无法报告状态；检查 `helper.log` 和 `doctor`。 |

## `permission_denied` 不一定是系统权限

CLI 的 `permission_denied` 可能表示两种不同问题：

1. **系统权限缺失**——helper 的 EventKit 状态不是 `full_access`。
2. **授权范围不足**——授权未覆盖该容器、动作或时间范围，或者已过期。

排查顺序：

1. 查看接入页的系统权限卡（或 `apple-connector doctor`）。
2. 不是 `full_access` 时，先解决系统权限。
3. 是 `full_access` 时，检查授权的容器、动作和过期时间。
4. 最后再看审计事件里的具体错误。

## 升级、重装与迁移

- **同一证书、同一 bundle id**：重建、升级、更换安装路径后授权保留，无需操作。
- **v0.16.x → v0.17.0**：App 是新身份，日历/提醒事项初始为 `not_determined`。在接入页重新授权一次。旧宿主的授权仍存在，但不会被继承。
- **更换证书或 bundle id**：需要重新授权一次；证书轮换也属于这种情况。
- **ad-hoc 构建**：App 每次变化 macOS 都会忘记授权，每次重建都要重新授权。只用于 CI 或一次性测试。

现有状态（`~/.apple-connector`）、授权、token 和审计记录不受影响。

## 无 GUI 或 SSH 会话

TCC 弹窗需要本机 GUI 会话。通过 SSH 或其他无 GUI 上下文启动服务时，弹窗可能不出现，状态会停留在 `not_determined`。

仅用于开发或排障时，可以让服务直接启动 helper：

```bash
APPLE_CONNECTOR_HELPER_MODE=direct apple-connector start
```

这种模式下 helper 是 CLI 的子进程，权限会重新跟随宿主 App。不要在日常使用中这样做。用完停止服务，再按正常方式启动。

## 重置权限

除非你准备让所有 App 重新授权，不要运行 `tccutil reset Calendar` / `tccutil reset Reminders`。只撤销 Apple Connector 时，在系统设置里关闭 Apple Connector 条目即可；下次请求会重新弹窗。

## 系统设置里没有 Apple Connector

1. `apple-connector status` 必须显示 helper 正在运行。
2. `apple-connector doctor` 应能读到 helper 权限；如果 helper 未运行，先启动服务。
3. 查看 `~/.apple-connector/helper.log` 是否有启动失败。
4. 重新运行 `npm run build:native`，确认构建**不是** ad-hoc；或者重新安装 npm 包。
5. 如果 macOS 拦截了 App，在系统设置 → 隐私与安全性中允许后重新启动。

最常见的原因是构建时没有使用稳定签名身份。用 [signing_zh.md](./signing_zh.md#验证签名) 中的命令检查签名。

## 相关文档

- [签名说明](signing_zh.md) — 创建并验证自签名身份。
- [CLI 参考](cli_zh.md) — `status`、`doctor` 与 helper socket。
- [文档索引](README_zh.md) — 全部指南与版本历史。
