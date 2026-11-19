# M0 原生能力验证记录

[文档索引](./README_zh.md) · 本页是内部验证记录，按时间追加，不代表当前用户界面。

日期：2026-09-05。此文档区分接口存在、内存运行、真实数据操作与安装验证，不能互相替代。

## 已执行的无数据检查

```sh
npm run check
npm run test:native
node dist/src/cli/index.js doctor --probe
```

环境为 macOS 26.6.2 / arm64，Node 26.8.1；核心测试和探测也在 Node 24.20.0 通过。

| 项目 | 证据 | 不代表什么 |
| --- | --- | --- |
| JXA 标准输入 | Node 子进程通过 stdin 传递 JSON，固定脚本解析成功 | 不代表任意 JXA 脚本受信任 |
| EventKit bridge | 导入、EKEventStore 实例化与授权状态查询成功 | 不代表已授权读取 |
| 完整权限方法 | respondsToSelector 返回 true | 未实际执行授权请求和回调 |
| Unicode/特殊字符 | 内存 EKReminder.title/notes 和 EKEvent.title 往返一致 | 不代表 Notes HTML 保真 |
| 全天/日期-only | 内存对象 allDay=true；NSDateComponents 的 hour 未指定 | 不代表同步后的日期、时区行为 |
| recurrence API | 公开 EKCalendarItem.h 有 recurrenceRules，内存对象 hasRecurrenceRules=false | 未验证真实重复提醒识别 |
| 专用容器 CRUD | `Agents` 日历、提醒列表和 Notes 文件夹中各创建、限定范围重读并删除一个 UUID 标记的测试对象 | 不代表既有对象编辑、共享/重复判定或生产 adapter 已开放 |
| Reminders M1 更新/完成探针 | 已实现为仅处理新建 UUID 探针的稳定 ID 更新、完成、回读与删除路径；本机执行在原生时限内未返回 | 未得到可验证结果时必须按 unknown 对待，不能开放既有提醒更新或完成 |
| Notes 正式 reader | 正式 writer 创建后，正式 reader 的 folder list、get、title search 与按 ID 清理在 `Agents` 文件夹通过 | 不代表共享/锁定笔记或其他文件夹可读 |
| EventKit 日历枚举 | 同一 `osascript` 进程报告 Calendar full access（4），但 `calendarsForEntityType` 中找不到 `Agents` | 授权状态不能替代真实运行时访问验证；当前不能用 EventKit 稳定事件 ID 替换 Apple Events 路径 |

## 2026-11-13 v0.9.7 长期运行内存验证

`apple-connector-helper` 是长期存活的单进程 JSONL helper。修复前主循环没有按请求建立/排空 autorelease pool，EventKit/Foundation 的桥接临时对象会随请求数累积；现场进程运行 63 天后的 physical footprint 为 5518 MB。v0.9.7 将单行请求处理提取为 `respond(to:helper:decoder:encoder:)`，主循环每轮执行 `autoreleasepool { respond(...) }`，JSONL 协议、错误码、超时和写入语义不变。

回归检查方法：

```sh
npm run build
node --test dist/tests/native/memory.test.js
APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID='<专用测试列表 ID>' node --test dist/tests/native/memory.test.js
footprint <helper-pid>
```

- 无权限基线：连续 5,000 次 `hello` 后 footprint 增量必须低于 32 MB。2026-11-13 实测由 3.1 MB 增至 3.3 MB，通过。
- opt-in 用例：在显式指定的测试列表中创建 60 条 UUID 探针提醒，预热后连续 250 次 `reminders.list`，footprint 增量必须低于 64 MB，并在 `finally` 中逐条 `reminders.deleteVerified`。未设置 `APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID` 时跳过，不读取或修改个人数据。2026-11-13 在 `Agents` 测试列表（ID `D4DD0F18-98A9-408F-932F-49001E9653F6`）实测 2/2 通过，0 跳过、0 失败，耗时约 5.2 秒；最终构建产物复跑同样通过。
- 修复前对照（同一台机器、旧二进制）：2,000 次 `reminders.list` 最大 RSS 844 MB；包裹 autorelease pool 后稳定在 34.7 MB。
- 重新构建 helper 后 TCC 可能因代码签名变化要求重新授权。本次重建后的二进制在本机 Terminal 获得持久 Reminders 权限后运行 opt-in 用例；通过 SSH 运行时会因 responsible process 为 `sshd-keygen-wrapper` 而被 macOS 禁止弹窗，应改用已授权的本机 Terminal 或 GUI 会话。

> 上述 TCC 行为属于 v0.16.x 及更早的“宿主 App 持有权限”架构。v0.17.0 起 EventKit helper 运行在自签名 `AppleConnector.app` 中，权限归 Apple Connector；重建/升级不再因为 helper 的 cdhash 变化而丢失授权。见下文 v0.17.0 记录和 [system-permissions_zh.md](./system-permissions_zh.md)。

长期运行排查时，`ps` 的 RSS 可能因页面换出而严重低估占用，应使用 `footprint <pid>` 或 `vmmap -summary <pid>` 查看 physical footprint 与 swapped_out。发布修复版本后必须重启现有服务，旧进程不会自动回收已累积的内存。

## 2026-11-19 v0.17.0 App 权限宿主与 socket 验证

v0.17.0 把 EventKit helper 放进 `AppleConnector.app`，由 LaunchServices 启动，Node 服务通过用户私有 Unix socket 调用它。验证记录：

- **对照实验（无个人数据）**：新编译的 ad-hoc EventKit 状态探针从 OpenCode 启动时返回 `calendar=0 reminders=3`，与 helper、osascript 一致，证明旧架构继承宿主权限。
- **独立 App 身份**：最小 `.app` 通过 `open` 启动后返回 `0/0`，说明 bundle 取得自己的 TCC 身份。
- **v0.17.0 App**：以 `open -n dist/native/AppleConnector.app --args --socket <tmp>/helper.sock` 启动后，socket 返回 `hello`（`protocolVersion=2`、`helperVersion=0.17.0`）和 `permissions.status`，且 `calendar/reminders` 均为 `not_determined`，不再继承 OpenCode 的提醒事项授权。
- **socket 权限**：socket 文件为 `srw-------`，pid/log 为 `0600`，父目录为 `0700`；SIGTERM 后由生命周期清理残留 socket/pid。
- **生命周期**：临时 state dir 下 `startService` 同时启动 helper 与 Node，`stopService` 同时停止两者；`APPLE_CONNECTOR_HELPER_MODE=direct` 在无 GUI/CI 下走同一 socket 协议。
- **ad-hoc 对照**：以上 App 验证使用 `APPLE_CONNECTOR_ALLOW_ADHOC=1`。ad-hoc App 每次重建都会更换身份，因此**不能**用于验证跨重建持久性。
- **自签名签名链**：用临时钥匙串创建一天期自签名代码签名证书，`APPLE_CONNECTOR_SIGN_IDENTITY` 构建成功；`codesign -d -r-` 输出 `identifier "com.jachy.apple-connector" and certificate leaf = H"…"`，不含 `cdhash`；`codesign --verify --strict` 通过。测试钥匙串已删除，钥匙串搜索列表已恢复。
- **正式签名**：用户创建 `JachyCertificate` 后，`dist/native/AppleConnector.app` 以该身份签名；`codesign -dv` 显示 `Authority=JachyCertificate`，requirement 为 `certificate leaf = H"de6f460690a400eba95188ce574388b1102373ea"`；通过 `open` 临时 socket 启动后 `permissions.status` 为 `not_determined/not_determined`，说明签名 App 可独立运行且未继承宿主权限。

**待授权用户执行**：用户已创建 `JachyCertificate` 并用它签名 App（见 [v0.17.0 进度](./v0.17.0-progress.md)）。仍需在本机 GUI 会话完成一次日历授权；随后用同一证书重建 App（cdhash 变化）并重启，确认 `permissions.status` 仍为 `full_access`，再把 App 复制到另一路径启动确认 bundle id + 证书身份与路径无关。该步骤完成前，不宣称 TCC 持久性已在实机通过。证书创建与验证步骤见 [signing_zh.md](./signing_zh.md)。

## 公开接口检查

已读取以下随本机安装的接口定义，不读取个人数据库：

- `/System/Applications/Calendar.app/Contents/Resources/iCal.sdef`
- `/System/Applications/Reminders.app/Contents/Resources/Reminders.sdef`
- `/System/Applications/Notes.app/Contents/Resources/Notes.sdef`（前期设计阶段）
- Command Line Tools SDK 的 `EventKit.framework/Headers/EKCalendar.h`、`EKCalendarItem.h`、`EKReminder.h`、`EKEventStore.h`。

关键发现：

1. Reminders 脚本字典没有 recurrence 属性。不能因没有看到字段而把现有提醒认作非重复。
2. Calendar 字典和公开 EKCalendar 都没有可靠的共享状态标志。`writable`、`allowsContentModifications` 只说明能否写入，不说明是否共享。
3. EventKit source 类型可用于区分部分账户类别，但不能把所有 iCloud/CalDAV 日历推断成个人日历。
4. 因此，计划中的“不能判定共享则拒绝”会限制 iCloud 写入；换 Swift 不能凭空得到缺少的公开属性。是否接受用户显式确认可写范围，需作为产品决策记录，不静默改变。

## 待执行验证矩阵

| 维度 | 状态 |
| --- | --- |
| 长期运行内存（v0.9.7） | 无权限 `hello` 基线与 opt-in `reminders.list` 用例均通过（2026-11-13，`Agents` 测试列表） |
| 用户明确指定测试日历、提醒清单、笔记文件夹 | 已提供并只读确认：三者名称均为 `Agents`；仅授权该范围用于后续 M0 测试 |
| EventKit 首次授权请求、异步回调与拒绝恢复 | 未执行（当前验证走 Calendar/Reminders Apple Events） |
| Notes Automation 首次授权与拒绝 | 已在创建/重读/删除路径中成功；拒绝恢复未执行 |
| 指定容器中查询/创建/重读核验 | 已通过：三类 `Agents` 容器各有一次创建、限定范围重读与删除 |
| 既有普通事件和提醒的受限编辑 | 未执行；Reminders 自清理 M1 探针在本机超时，待 scoped 对账 |
| 重复、共享、只读、锁定对象拒绝 | 未执行 |
| Apple App 超时但实际写入完成的对账 | 已复现：M0/M1 返回超时后，Reminders UI 可见 UUID 对象；按 UUID 精确清理并按稳定 ID 回读通过 |
| DST、跨时区、日期-only 保存后往返 | 未执行 |
| Notes 简单 HTML/纯文本创建后往返 | 未执行 |
| 终端启动 vs CLI Agent 调用的权限归属 | v0.17.0 已验证：旧架构归宿主；新架构归 `AppleConnector.app`，见 2026-11-19 记录 |
| 后台用户进程启动与重启 | v0.17.0 已验证 helper 由 LaunchServices 启动、socket 握手与生命周期清理；跨重建持久性待授权验收 |
| Formula 全新安装、版本路径变化与升级 | 未执行 |
| Intel 与其他 macOS 版本 | 未执行 |

真实测试只操作明确授权的测试容器和明确标注的测试对象，不自动全库枚举、不修改用户已有内容、不重置 TCC、不删除系统或用户数据。测试清理也必须有明确对象范围。

2026-09-06：M1 探针改为由调用方在写入前保留 UUID，以便 unknown outcome 后精确恢复。早期恢复只查原始标题，曾对 `5f79e1ab-7e5f-43a5-973a-156114c5843e` 错误返回 `removed: false`；界面复核证明该对象已改名且仍存在。v0.2.0 恢复实现同时精确匹配原始/更新标题、优先使用稳定 ID、拒绝歧义，并在删除后按稳定 ID 回读。

## 2026-11-15 v0.10.0 due、patch 与重复提醒验证

v0.10.0 将 native helper 的 JSONL 协议升级为 2，`reminders.list` 的 `due` 从字符串改为结构化对象，并增加 `recurring`。在专用 `Agents` 列表（`D4DD0F18-98A9-408F-932F-49001E9653F6`）用一次性 Swift/Node 探针验证：

- date-only：`dueDateComponents` 只有年月日，hour/minute/second 为 nil，timeZone 为 nil；direct 与 list fetch 一致。
- instant：`Asia/Shanghai` 的 `2032-03-01 17:30:00` 在保存、换新进程和 list fetch 后保留时分秒与 `Asia/Shanghai`。
- floating：`2032-03-02 18:45:00` 无时区写入后读回仍为 floating。
- 类型转换：instant→date、instant→floating、date→instant、floating→instant、instant→null 均可通过 `reminders.patchVerified` 完成。
- 关键 EventKit 行为：把已存在的 date-only/floating 改为 instant 时，必须在设置 `dueDateComponents` 之后显式设置 `reminder.timeZone`，否则时区会被丢弃并读回 floating。helper 已按此顺序实现。
- ID：date/instant/floating 在 create、list、patch、complete、delete 全链路保持一致；删除后不再出现。
- 重复提醒：带 due date 的 daily recurrence 探针返回 `recurring=true`；patch/complete/delete 均返回 `unsupported_operation`，诊断清理失败会显式报错。

回归检查方法：

```sh
npm run build
APPLE_CONNECTOR_REMINDERS_TEST_LIST_ID='<专用测试列表 ID>' node --test dist/tests/native/reminders.test.js
```

这些用例会写入并清理专用测试列表中的 UUID 探针。TCC 授权与测试仍应从本机 Terminal 运行；当前 SSH 会话直接执行 `dist/native/apple-connector-helper` 会被系统以 SIGKILL 结束（exit 137），从 `native/.build/release/` 或临时副本执行正常，属于宿主启动归属限制，不是 helper 逻辑错误。

## 2026-09-06 v0.2.0 原生复核

- 旧合并 M1 探针一次完整通过，耗时 52.82 秒；M0 同轮耗时 16.97 秒。
- 后续 M0 在 60 秒超时；分阶段 M1 的 `create` 在 30 秒超时，随后 UUID 精确清理也曾在 60 秒超时。界面检查发现写入实际已发生，因此这些调用必须保持 `outcome_unknown`，不能自动重放。
- 界面确认 5 个 M1 与 1 个 M0 未完成诊断对象。5 个 M1 由新恢复路径逐个返回 `removed_verified`，M0 由新增 UUID 恢复路径返回 `removed_verified`。Agents 清单当前未完成对象为 0；另有 1 个隐藏的已完成 M1 搜索结果尚未取得 UUID，保留人工核验，不做宽泛删除。
- Calendar Apple Events 在 `Agents` 日历创建、限定范围回读和清理通过（1.30 秒）；读取和唯一名称定位通过。EventKit 稳定标识探针返回 `unsupported_operation`，因此 Calendar 服务写入仍关闭。
- Reminders EventKit 只读对照能以现有 Apple Events 清单 ID 唯一定位 `Agents`，并报告 `allowsContentModifications=true`。这为绕开 Apple Events 阻塞提供了可行方向，但尚未验证真实 reminder 稳定 ID、重复规则与共享清单判定，不能据此开放修改。

## 专用测试范围确认

2026-09-05，用户明确指定以下专用测试容器：

- Calendar：`Agents`，只读名称匹配成功；通过 Calendar Apple Events 读取匹配对象的 `uid` 时返回 `-10000`，稳定标识尚未验证。
- Reminders：`Agents`，只读名称匹配成功，列表 ID 已可取得。
- Notes：iCloud 账户下的 `Agents`，只读名称匹配成功，文件夹 ID 已可取得。

本次只查询容器元数据，没有读取事件、提醒或笔记内容，也没有执行写入。后续真实 CRUD 仅限这些容器中新建且明确标注为测试的数据；在实际写入前仍需单独执行并记录权限回调和 adapter 安全检查。

## M0 结论

JXA + EventKit 值得继续，不需要因语言本身立即引入 Swift。Calendar、Reminders 与 Notes 的专用容器基础 CRUD 已通过；Calendar 当前应避免读取 `uid`，改为在已授权容器内以唯一测试标题回读。Calendar Apple Events 的 `uid`、`id` 与 `calendarIdentifier` 属性读取在本机均失败；尽管该进程报告 EventKit Calendar full access，EventKit 枚举没有找到 `Agents`，因此当前没有可靠的 Calendar 稳定容器或事件 ID。共享范围、重复/既有对象拒绝、拒绝恢复、启动归属和安装矩阵尚未通过，因此当前不启用原生写入，不宣布 M0 完成。
