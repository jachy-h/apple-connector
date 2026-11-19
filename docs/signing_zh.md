# 不购买 Apple Developer 时如何签名 Apple Connector

[English](signing.md) · 中文

Apple Connector 不需要 Apple Developer Program、公证或 Developer ID，也能让 macOS 的日历/提醒事项授权在升级后继续有效。它需要的是一个**稳定的代码签名身份**：在发布构建的机器上创建一次自签名证书。

本文说明原因、证书创建、构建签名、验证、轮换和排障。

## 为什么自签名证书就够了

macOS TCC 按 App 的 **designated requirement** 记录授权：

- **ad-hoc 签名**的 requirement 是 `cdhash H"…"`。每次重新构建哈希都会变，macOS 会把新二进制当成另一个 App，日历/提醒事项授权随之丢失。
- **证书签名**的 requirement 是
  `identifier "com.jachy.apple-connector" and certificate leaf = H"…"`。只要 bundle id 和证书不变，重建、升级后 requirement 就不变，授权继续有效。

证书不需要由 Apple 签发，只需要保持不变。

App bundle 位于 `dist/native/AppleConnector.app`，bundle id 为
`com.jachy.apple-connector`。它的主可执行文件就是 native helper，通过仅当前用户可访问的 Unix socket 为 Node 服务提供 EventKit。因此 macOS 记录的是 **Apple Connector** 的日历/提醒事项权限，而不是 Terminal、OpenCode 或其他宿主 App。

## 一次性创建签名身份

使用“钥匙串访问”创建。默认身份名是 `Apple Connector Local`，也可以改用其他名字并通过 `APPLE_CONNECTOR_SIGN_IDENTITY` 指定。

1. 打开“钥匙串访问”。
2. 菜单 **钥匙串访问 → 证书助理 → 创建证书…**
3. 填写：
   - **名称**：`Apple Connector Local`
   - **身份类型**：自签名根证书
   - **证书类型**：代码签名
   - **有效期**：3650 天（或更长；建议长于你计划使用该 App 的时间）
4. 创建证书。
5. 可选：打开证书 → 显示简介 → 信任，把“使用此证书时”的代码签名设为“始终信任”。这只影响本机；安装你 npm 包的用户不需要该证书，也不需要这个信任设置。

确认 macOS 能看到该身份：

```bash
npm run signing:check
# 或
security find-identity -p codesigning | grep "Apple Connector Local"
```

`security find-identity -v` 只列出信任链通过的证书；未信任的自签名证书可能不会出现。用不带 `-v` 的 `-p codesigning` 检查是否存在，再用 `codesign` 实际测试签名。

## 构建与签名

```bash
npm run build          # 管理页 + TypeScript + native App
npm run build:native   # 只重建并签名 App 和独立 helper
```

构建脚本会：

1. 执行 `swift build -c release`；
2. 复制 helper 到 `dist/native/apple-connector-helper`；
3. 组装 `dist/native/AppleConnector.app` 和 `Info.plist`；
4. 用指定身份签名独立 helper 和 App；
5. 校验 App 并打印 designated requirement。

改用其他身份：

```bash
APPLE_CONNECTOR_SIGN_IDENTITY="My Company Local Signing" npm run build:native
```

不想每次命令都带环境变量时，在仓库根目录创建 `.signing-identity`，内容为身份名称（例如 `JachyCertificate`）。该文件会被 git 忽略。优先级：`APPLE_CONNECTOR_SIGN_IDENTITY` → `.signing-identity` → `Apple Connector Local`。

找不到身份时构建会**直接失败**，不会静默退回 ad-hoc。仅限 CI 或一次性测试构建：

```bash
APPLE_CONNECTOR_ALLOW_ADHOC=1 npm run build:native
```

这种构建会打印警告。不要发布，也不要覆盖正常安装：App 下次变化时 macOS 会忘记权限。

## 验证签名

```bash
codesign --verify --strict --verbose=2 dist/native/AppleConnector.app
codesign -dv --verbose=4 dist/native/AppleConnector.app 2>&1
codesign -d -r- dist/native/AppleConnector.app 2>&1
```

期望结果：

- `Identifier=com.jachy.apple-connector`
- `Authority=Apple Connector Local`（或你使用的身份）
- 没有 `Signature=adhoc`
- designated requirement 含 `certificate leaf = H"…"`，且**不含** `cdhash`

也可以运行 `npm run release:verify`。它会校验 App bundle、bundle id、usage description、版本，以及（未设置 `APPLE_CONNECTOR_ALLOW_ADHOC=1` 时）签名身份和 requirement。

## 升级时什么会保留

只要证书和 bundle id 不变，以下操作都**不会**清除日历/提醒事项授权：

- 重新构建 helper；
- 升级 npm 包；
- 更换安装路径（例如换 Node 版本管理器前缀）；
- 重启服务。

更换证书、更换 bundle id 或使用 ad-hoc 签名都会产生新身份。旧授权仍属于旧身份，但新 App 需要重新授权一次。更换签名后必须先停止服务再启动：版本相同的运行中 helper 会被复用，即使磁盘上的 App 已经重签。

## 验证正在运行的 helper

```bash
apple-connector status          # helper 是否运行、pid、socket
apple-connector doctor          # 从 App 读取的 helper 权限
codesign -dv --verbose=4 dist/native/AppleConnector.app 2>&1 | grep -E 'Identifier|Authority|Signature'
```

只有 `<state dir>/helper.pid` 和 `<state dir>/helper.sock` 同时存在时，`status` 才显示 helper 正在运行。`doctor` 通过该 socket 读取 `permissions.status`。如果已授权但 `doctor` 仍显示 `not_determined`，确认启动的是刚签名的 App；另一路径下的旧 App 仍可能持有该 socket。

## 分发边界

- npm 包内包含已签名的 App。用户**不需要**安装你的证书、私钥或信任设置也能运行；TCC 校验的是签名中嵌入的证书哈希。
- 从源码构建的用户各自创建证书；每台 Mac 有自己的身份和授权，这是预期行为。
- CI 构建（`APPLE_CONNECTOR_ALLOW_ADHOC=1`）只用于测试，永远不要发布 CI 产物。
- 没有公证时，带 **quarantine** 的副本（例如通过浏览器下载的 tarball）仍可能被 Gatekeeper 在首次启动时拦截。npm 和本机源码安装通常不带 quarantine。如果 macOS 拦截，请在 **系统设置 → 隐私与安全性 → 仍要打开** 中允许，或对可信副本移除属性：

  ```bash
  xattr -dr com.apple.quarantine /path/to/AppleConnector.app
  ```

  本项目仍不提供公开 `.app`、DMG 或 Homebrew Cask。

## 私钥与轮换

敏感的是**私钥**。持有私钥的人可以签出一个继承用户已授权限的 App。请：

- 只放在发布机器和密码管理器/离线备份中；
- 不要进仓库、CI 变量、日志或截图；
- 依赖登录钥匙串和强账户密码保护。

私钥丢失或证书过期时，创建新身份并重新构建；所有用户需要重新授权日历/提醒事项一次。不要在日常发版时轮换身份。建议在发布检查清单中记录身份名称和到期时间。

首次构建可能弹出钥匙串访问提示。选择 **始终允许** 授予 `codesign`，避免后续无人值守构建反复弹窗。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Code-signing identity "Apple Connector Local" was not found` | 证书不存在、改名或钥匙串被锁定 | 重新创建，或设置 `APPLE_CONNECTOR_SIGN_IDENTITY`；解锁登录钥匙串 |
| `security find-identity -v` 显示 0 个身份 | 自签名证书未被信任 | 用不带 `-v` 的 `-p codesigning` 检查；可选：信任设置中把代码签名设为始终信任 |
| 每次构建都要求钥匙串密码 | `codesign` 没有永久密钥访问权限 | 在弹窗中选择“始终允许”，或在钥匙串中管理密钥访问控制 |
| `codesign --verify` 失败 | 签名后手工改过 App bundle | 重新运行 `npm run build:native`；不要手工改 `Contents/` |
| 每次构建后权限都重置 | 构建退回了 ad-hoc，或证书变了 | 检查构建输出；运行上面的 `codesign -d -r-` 验证 |
| Gatekeeper 不允许打开 App | 下载副本带 quarantine | 在系统设置中允许，或对可信副本移除 quarantine 属性 |
| App 启动了但没有 socket | Gatekeeper/钥匙串阻止了启动，或 App 未构建 | 查看 `~/.apple-connector/helper.log`；运行 `apple-connector doctor`；重新构建 |

权限流程本身见 [system-permissions_zh.md](./system-permissions_zh.md)，全部指南见[文档索引](README_zh.md)，验证记录见 [native-validation.md](./native-validation.md)。
