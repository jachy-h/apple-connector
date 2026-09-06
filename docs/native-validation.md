# M0 原生能力验证记录

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
| Notes 正式 reader | 正式 writer 创建后，正式 reader 的 folder list、get、title search 与按 ID 清理在 `Agents` 文件夹通过 | 不代表共享/锁定笔记或其他文件夹可读 |
| EventKit 日历枚举 | 同一 `osascript` 进程报告 Calendar full access（4），但 `calendarsForEntityType` 中找不到 `Agents` | 授权状态不能替代真实运行时访问验证；当前不能用 EventKit 稳定事件 ID 替换 Apple Events 路径 |

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
| 用户明确指定测试日历、提醒清单、笔记文件夹 | 已提供并只读确认：三者名称均为 `Agents`；仅授权该范围用于后续 M0 测试 |
| EventKit 首次授权请求、异步回调与拒绝恢复 | 未执行（当前验证走 Calendar/Reminders Apple Events） |
| Notes Automation 首次授权与拒绝 | 已在创建/重读/删除路径中成功；拒绝恢复未执行 |
| 指定容器中查询/创建/重读核验 | 已通过：三类 `Agents` 容器各有一次创建、限定范围重读与删除 |
| 既有普通事件和提醒的受限编辑 | 未执行 |
| 重复、共享、只读、锁定对象拒绝 | 未执行 |
| Apple App 超时但实际写入完成的对账 | 未执行 |
| DST、跨时区、日期-only 保存后往返 | 未执行 |
| Notes 简单 HTML/纯文本创建后往返 | 未执行 |
| 终端启动 vs MCP 客户端启动的权限归属 | 未执行 |
| 后台用户进程启动与重启 | 未执行 |
| Formula 全新安装、版本路径变化与升级 | 未执行 |
| Intel 与其他 macOS 版本 | 未执行 |

真实测试只操作明确授权的测试容器和明确标注的测试对象，不自动全库枚举、不修改用户已有内容、不重置 TCC、不删除系统或用户数据。测试清理也必须有明确对象范围。

## 专用测试范围确认

2026-09-05，用户明确指定以下专用测试容器：

- Calendar：`Agents`，只读名称匹配成功；通过 Calendar Apple Events 读取匹配对象的 `uid` 时返回 `-10000`，稳定标识尚未验证。
- Reminders：`Agents`，只读名称匹配成功，列表 ID 已可取得。
- Notes：iCloud 账户下的 `Agents`，只读名称匹配成功，文件夹 ID 已可取得。

本次只查询容器元数据，没有读取事件、提醒或笔记内容，也没有执行写入。后续真实 CRUD 仅限这些容器中新建且明确标注为测试的数据；在实际写入前仍需单独执行并记录权限回调和 adapter 安全检查。

## M0 结论

JXA + EventKit 值得继续，不需要因语言本身立即引入 Swift。Calendar、Reminders 与 Notes 的专用容器基础 CRUD 已通过；Calendar 当前应避免读取 `uid`，改为在已授权容器内以唯一测试标题回读。Calendar Apple Events 的 `uid`、`id` 与 `calendarIdentifier` 属性读取在本机均失败；尽管该进程报告 EventKit Calendar full access，EventKit 枚举没有找到 `Agents`，因此当前没有可靠的 Calendar 稳定容器或事件 ID。共享范围、重复/既有对象拒绝、拒绝恢复、启动归属和安装矩阵尚未通过，因此当前不启用原生写入，不宣布 M0 完成。
