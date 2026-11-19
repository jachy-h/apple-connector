import type { Language } from './i18n.js';

export interface GuideCommand {
  syntax: string;
  description: string;
}

export interface GuideTable {
  columns: string[];
  rows: string[][];
}

export interface GuideSection {
  id: string;
  title: string;
  summary: string;
  body?: string[];
  commands?: GuideCommand[];
  table?: GuideTable;
  notes?: string[];
}

export interface UsageGuide {
  intro: string;
  quickCommands: string[];
  sections: GuideSection[];
}

const zh: UsageGuide = {
  intro: '本页是 Apple Connector 的完整使用说明。所有操作都在本机完成；管理页仅监听 loopback，并且一小时后过期。',
  quickCommands: ['apple-connector init', 'apple-connector open', 'apple-connector auth verify --agent <name> --auth-key <key>', 'apple-connector skill path', 'apple-connector help calendar create'],
  sections: [
    {
      id: 'overview',
      title: '概览与前置条件',
      summary: 'Apple Connector 在本机连接 Apple 日历与提醒事项，只把受限能力交给 Agent。',
      body: [
        '运行环境：Apple Silicon Mac、macOS 14 或更高版本，以及受支持的 Node 版本（>=24.20 <25 或 >=26.8.1 <27）。',
        '服务通过本机 Unix socket 与 CLI 通信；管理页只监听 127.0.0.1，不开放局域网、云端或远程连接。',
        '状态目录默认为 ~/.apple-connector；从旧路径 ~/apple-connector 升级时运行 apple-connector migrate-state。',
        '业务命令必须使用创建授权时得到的授权 ID（token）；管理命令由本机 CLI 使用所有者可读的 admin token。',
        '所有写操作都经过授权和审计边界；审计只保留元数据。',
      ],
      notes: [
        '不要把管理链接、admin token 或授权 ID 发给其他设备或聊天对象。',
        '需要机器输出时始终添加 --json；人类可读输出不作为稳定接口。',
      ],
    },
    {
      id: 'install',
      title: '安装与首次接入',
      summary: '安装 CLI 后运行 init；它会自动初始化状态、启动服务并打开本机管理页。重复运行等同于 open。',
      body: [
        '从源码使用 npm link，或运行 npm install -g @jachy/apple-connector 安装；安装后确认 apple-connector version。',
        'init 会创建状态目录、admin token 和数据库，启动或复用本机服务，并打开本机管理页；不需要单独执行初始化。后续再次运行等同于 open。',
        'status 显示服务、数据库、授权数量和健康检查结果；服务没有启动时运行 start。',
        'open 用于后续管理页；管理 URL 只在本机有效，并在一小时后过期。',
      ],
      commands: [
        { syntax: 'apple-connector init', description: '首次接入：初始化状态、启动服务并打开本机管理页。' },
        { syntax: 'apple-connector status', description: '查看服务、数据库与授权摘要。' },
        { syntax: 'apple-connector open [--section <name>]', description: '后续打开本机管理页。' },
        { syntax: 'apple-connector start --foreground', description: '在当前终端前台运行服务，便于观察日志。' },
        { syntax: 'apple-connector stop', description: '停止后台服务。' },
      ],
      notes: ['管理页过期后重新运行 apple-connector init；不要尝试复用已过期的链接。'],
    },
    {
      id: 'commands',
      title: '命令速查',
      summary: '所有命令都支持 --json；详细参数和示例可用 help 子命令查看。',
      commands: [
        { syntax: 'apple-connector help [topic...]', description: '查看总览或单个命令的详细帮助，例如 help reminder patch。' },
        { syntax: 'apple-connector version', description: '打印版本；--json 返回 { version }。' },
        { syntax: 'apple-connector init | start | stop | status', description: '首次接入与本机服务生命周期。' },
        { syntax: 'apple-connector open [--section setup|audit|docs]', description: '打开指定管理页面；权限与授权已合并到 setup（接入）。' },
        { syntax: 'apple-connector skill path', description: '打印随包 Skill 的绝对路径。' },
        { syntax: 'apple-connector auth show --auth-key <key>', description: '查看授权范围和过期时间。' },
        { syntax: 'apple-connector auth verify --agent <name> --auth-key <key>', description: '完成 Agent 验证并把身份绑定到授权。' },
        { syntax: 'apple-connector calendar <subcommand>', description: '日历读取与事件增删改。' },
        { syntax: 'apple-connector reminder <subcommand>', description: '提醒事项读取与增删改。' },
        { syntax: 'apple-connector operation get --id <operation-id>', description: '查看待审批或已提交操作。' },
        { syntax: 'apple-connector doctor [--probe]', description: '检查运行环境和只读 native bridge。' },
      ],
      notes: [
        '全局选项包括 --json 与 --no-color；非 TTY、NO_COLOR 或 TERM=dumb 会自动关闭颜色。',
        '业务命令需要 --auth-key <key>；--auth-file <path> 和 --credential-file <absolute-path> 继续作为兼容方式。',
      ],
    },
    {
      id: 'agent',
      title: 'Agent 接入提示词与验证',
      summary: '用户在接入页完成授权后，把生成的提示词复制给 Agent；Agent 完成 auth verify 后，页面会显示绑定。',
      body: [
        '运行 init 打开本机管理页。接入页按顺序展示：系统授权、单独 Agent 授权、复制提示词、Agent 验证。',
        '创建后页面生成两种提示词：默认版本只含授权 key，由本机 CLI 解析凭据，不含授权码；备用版本包含授权码。',
        '把默认提示词复制给 Agent。Agent 用 --auth-key 让本机 CLI 解析凭据，并通过 skill path 加载 Skill；不要自行读取或扫描 profile 目录。',
        '只有 Agent 无法使用授权 key 时才使用含授权码的版本；Agent 必须立即存入 secret store 或 0600 文件，且不得回显。',
        'Agent 必须运行 auth verify --agent <名称> 完成绑定，再做一次有界只读查询；接入页会自动刷新绑定状态。',
      ],
      commands: [
        { syntax: 'apple-connector skill path --json', description: '获取 Skill 目录和版本。' },
        { syntax: 'apple-connector auth show --auth-key <key> --json', description: '验证授权范围和过期时间。' },
        { syntax: 'apple-connector auth verify --agent <name> --auth-key <key> --json', description: '完成 Agent 验证并绑定授权。' },
        { syntax: 'apple-connector open --section docs --json', description: '把完整使用文档链接交给用户。' },
      ],
      notes: ['容器列表为空也代表接入成功，只是当前没有可授权容器。绑定状态由管理页自动轮询，不需要 Agent 反复查询。'],
    },
    {
      id: 'permissions',
      title: '系统权限与授权',
      summary: '先获得 macOS 系统权限，才能在可见容器范围内为单个 Agent 创建授权。',
      body: [
        '系统权限决定 Apple Connector 能看到哪些日历和提醒事项；授权只能在这个范围内继续收窄。',
        '接入页把系统授权、单独 Agent 授权、复制提示词和 Agent 验证放在同一个顺序流程里；没有完全访问权限时第 2 步不可用。',
        '一个授权应只对应一个 Agent，可以同时包含日历和提醒事项容器；每个容器分别选择动作。权限相同的容器会自动合并成一条 grant。',
        '过期时间默认一年后，可按需调整。创建后授权不可编辑；需要变更时删除并重新创建。',
        '授权 ID 只在创建时显示一次，同时写入所有者可读的本地文件；删除授权会立即让该 ID 失效。Agent 运行 auth verify 后，页面显示已绑定的 Agent 名称和验证时间。',
      ],
      table: {
        columns: ['服务', '可用动作'],
        rows: [
          ['日历', 'read、create、update、delete'],
          ['提醒事项', 'read、create、update、complete、delete'],
        ],
      },
      notes: ['没有系统权限时容器列表为空，无法创建授权。请先在接入页第 1 步请求访问；macOS 弹窗名称是 Apple Connector。'],
    },
    {
      id: 'calendar',
      title: '日历命令',
      summary: '读取日历与事件，并在授权范围内创建、更新或删除事件。',
      body: [
        'list-calendars 返回当前授权可见的日历；list 必须指定 calendar-id 和有界的 from/to 时间范围。',
        '时间使用带时区偏移的 RFC 3339，例如 2026-11-20T09:00:00+08:00。',
        'create/update/delete 是写操作，必须提供 --idempotency-key；同一个 key 重试是安全的。',
        '标题必填，可以来自 --title 或所有者可读的 --input JSON 文件；地点和备注也建议通过 --input 提供，避免出现在 shell 历史中。',
        'calendarItemIdentifier 在常规编辑中稳定；完整同步、账户重置或数据重建后需要重新 list 获取 ID。',
      ],
      commands: [
        { syntax: 'apple-connector calendar list-calendars --auth-key <key>', description: '列出可见日历。' },
        { syntax: 'apple-connector calendar list --calendar-id <id> --from <RFC3339> --to <RFC3339> --auth-key <key>', description: '列出事件，支持 --offset 与 --limit。' },
        { syntax: 'apple-connector calendar create --calendar-id <id> --title <text> --start <RFC3339> --end <RFC3339> --idempotency-key <key> --auth-key <key>', description: '创建事件，可用 --all-day 与 --input 提供地点和备注。' },
        { syntax: 'apple-connector calendar update --calendar-id <id> --id <event-id> --title <text> --start <RFC3339> --end <RFC3339> --idempotency-key <key> --auth-key <key>', description: '替换事件字段。' },
        { syntax: 'apple-connector calendar delete --calendar-id <id> --id <event-id> --idempotency-key <key> --auth-key <key>', description: '删除事件。' },
      ],
    },
    {
      id: 'reminders',
      title: '提醒事项命令',
      summary: '读取提醒列表与提醒事项，并处理截止日期、完成状态和部分更新。',
      body: [
        'list 返回的每项提醒包含 due 和 recurring。due 为 null、date、floating 或 instant。',
        'create 可使用 --due <RFC3339> 表示带时区的时间，或用 --due-date <YYYY-MM-DD> 表示全天；--time-zone 可覆盖 IANA 时区。',
        'patch 只修改 --input 中出现的字段以及 due/completed 参数；标题和正文必须通过 --input 提供。',
        'update 是 title、body 和 completed 的完整替换；patch 更适合局部修改。',
        'recurring 为 true 的提醒不支持 patch、update、complete 和 delete，会返回 unsupported_operation。',
      ],
      commands: [
        { syntax: 'apple-connector reminder list-lists --auth-key <key>', description: '列出可见提醒列表。' },
        { syntax: 'apple-connector reminder list --list-id <id> --auth-key <key>', description: '列出提醒，支持 --offset 与 --limit。' },
        { syntax: 'apple-connector reminder create --list-id <id> --title <text> --due 2026-11-20T17:00:00+08:00 --idempotency-key <key> --auth-key <key>', description: '创建带时间的提醒。' },
        { syntax: 'apple-connector reminder create --list-id <id> --title <text> --due-date 2026-11-20 --idempotency-key <key> --auth-key <key>', description: '创建全天提醒。' },
        { syntax: 'apple-connector reminder update --list-id <id> --id <reminder-id> --title <text> --completed --idempotency-key <key> --auth-key <key>', description: '完整替换并完成提醒。' },
        { syntax: 'apple-connector reminder patch --list-id <id> --id <reminder-id> --clear-due --input <file> --idempotency-key <key> --auth-key <key>', description: '局部更新或清除截止日期。' },
        { syntax: 'apple-connector reminder complete --list-id <id> --id <reminder-id> --idempotency-key <key> --auth-key <key>', description: '标记完成。' },
        { syntax: 'apple-connector reminder delete --list-id <id> --id <reminder-id> --idempotency-key <key> --auth-key <key>', description: '删除提醒。' },
      ],
      table: {
        columns: ['due.kind', '含义', '示例'],
        rows: [
          ['date', '全天截止，无时区', '{"kind":"date","date":"2026-11-20"}'],
          ['floating', '墙钟时间，无时区', '{"kind":"floating","date":"2026-11-20","time":"17:00:00"}'],
          ['instant', '带时区的具体时刻', '{"kind":"instant","at":"2026-11-20T17:00:00+08:00","timeZone":"Asia/Shanghai"}'],
        ],
      },
      notes: ['due 为 null 表示没有截止日期；patch 传 due: null 或 --clear-due 可清除。'],
    },
    {
      id: 'audit',
      title: '审计',
      summary: '审计记录只保留操作元数据，不保存内容。',
      body: [
        '审计包含时间、provider、动作、结果和数量等元数据，不保存标题、正文、备注或授权 ID。',
        '所有有写权限的调用都直接执行，不再有审批队列或 prepared 状态。',
        'operation get 仍可用于幂等重放和 outcome_unknown 的结果确认。',
      ],
      commands: [
        { syntax: 'apple-connector open --section audit', description: '打开审计页面。' },
        { syntax: 'apple-connector operation get --id <operation-id> --auth-key <key> --json', description: '查看操作当前状态。' },
      ],
    },
    {
      id: 'json',
      title: 'JSON、退出码与幂等',
      summary: '机器调用统一使用 --json；写操作必须使用稳定的幂等 key。',
      body: [
        '--json 在 stdout 输出一条 envelope：{ ok, data, meta: { schemaVersion: 2 } }，不会混入 ANSI 或提示文本。',
        '成功退出码为 0；一般错误为 1；invalid_request 为 2；outcome_unknown 为 4。',
        '所有写操作必须提供 --idempotency-key；相同 key 重试同一操作是安全的。',
        '收到 outcome_unknown 时不要换新 key 重试。先检查本机状态或使用 operation get 确认结果。',
        '私有标题、正文、备注放在所有者可读的 --input JSON 文件中，不要放在命令行参数里。',
      ],
      table: {
        columns: ['退出码', '含义'],
        rows: [
          ['0', '成功'],
          ['1', '一般错误，例如服务不可用或权限拒绝'],
          ['2', '请求无效，通常需要修正参数'],
          ['4', '结果未知；不要用新幂等 key 盲目重试'],
        ],
      },
      notes: ['人类可读输出会随版本调整；脚本、Skill 和自动化应只解析 --json。'],
    },
    {
      id: 'troubleshooting',
      title: '故障排查',
      summary: '按“服务 → 权限 → 授权 → 参数 → 幂等状态”的顺序排查，避免重复写入。',
      body: [
        '先运行 apple-connector status 和 apple-connector doctor；服务未运行就运行 start。doctor 的 helper 权限来自 Apple Connector App，JXA probe 只反映启动 CLI 的宿主进程。',
        '容器列表为空时，先在管理页获得 macOS 系统权限，再重新检查。系统设置 → 隐私与安全性 → 日历/提醒事项中应出现 Apple Connector。',
        'permission_denied 有两种常见来源：系统权限不是 full_access，或授权未覆盖该容器/动作/时间。先看接入页第 1 步的系统权限，再看授权范围和过期时间。',
        '从 v0.16.x 或更早版本升级后，权限归属变为 Apple Connector，需要重新授权一次；旧 Terminal/OpenCode 条目不再使用。',
        '页面显示“已使用授权，尚未验证”时，Agent 已能调用服务但还没运行 auth verify；让它补一次验证即可完成绑定。',
        'unsupported_operation 常见于重复提醒，或对只读授权执行写入。',
        '管理链接过期时重新运行 apple-connector init，不要复用旧链接。',
        '本地 token 文件只能由本机所有者读取；路径错误时重新创建授权，不要猜测或手工编辑 token。',
      ],
      table: {
        columns: ['错误码', '建议动作'],
        rows: [
          ['service_unavailable', '运行 status；必要时 start 并查看本机日志。'],
          ['permission_denied', '先确认系统权限为 full_access，再检查授权的容器/动作范围和过期时间。'],
          ['unsupported_operation', '确认提醒是否重复，或写入是否超出字段/动作范围。'],
          ['conflict', '检查服务是否已停止、授权是否已删除或资源是否冲突。'],
          ['outcome_unknown', '不要换新 key 重试；先用 operation get 或本机状态确认结果。'],
          ['invalid_request', '运行 apple-connector help <topic> 修正参数。'],
        ],
      },
    },
    {
      id: 'security',
      title: '安全边界',
      summary: 'Apple Connector 的信任边界是“同一台 Mac 上的当前用户”。',
      body: [
        '服务与管理页只监听本机 loopback；不要通过端口转发、反向代理或局域网地址暴露管理页。',
        '管理会话一小时后过期；管理 URL 是临时凭据，不要长期保存或转发。授权 ID 是 bearer credential，只应保存在所有者可读文件或 Agent secret store 中。',
        '授权 ID 只在创建时显示一次，同时保存在所有者可读的本地文件；页面关闭后无法再次查看。',
        'Agent 只能在授权的容器、动作和字段范围内工作；超出范围会返回 permission_denied。',
        'Agent 绑定只保存 Agent 自报名称和验证时间，用于页面展示，不构成强身份认证。',
        '审计只保存元数据，因此不要依赖审计恢复标题、正文或备注。',
      ],
      notes: ['遇到可疑链接或授权 ID 泄露时，删除相关授权并重新创建；不要尝试编辑或轮换已创建的授权。'],
    },
    {
      id: 'reference',
      title: '参考文档',
      summary: '随包文档提供更细的命令参考、Skill 说明和安装步骤。',
      body: [
        'docs/README_zh.md：文档索引、常见路径与完整版本历史。',
        'docs/cli_zh.md：完整 CLI 参考、参数、环境变量与 due 格式。',
        'docs/skill_zh.md：Skill 的结构、加载方式和 Agent 行为约定。',
        'docs/getting-started_zh.md：首次接入的最短路径。',
        'docs/install-for-agent_zh.md：把安装和接入交给 Agent 时使用的指令。',
        'docs/system-permissions_zh.md：macOS TCC 权限归属、状态值与排障。',
        'docs/signing_zh.md：自签名证书、签名构建与轮换。',
        'docs/v0.8-to-v0.9-migration.md：跨版本升级时的差异与中文摘要。',
      ],
      commands: [
        { syntax: 'apple-connector skill path', description: '查看随包 Skill 的实际位置。' },
        { syntax: 'apple-connector help <topic>', description: '查看当前版本支持的参数和示例。' },
      ],
    },
  ],
};

const en: UsageGuide = {
  intro: 'This page is the complete guide to Apple Connector. Everything runs locally; the management page listens on loopback only and expires after one hour.',
  quickCommands: ['apple-connector init', 'apple-connector open', 'apple-connector auth verify --agent <name> --auth-key <key>', 'apple-connector skill path', 'apple-connector help calendar create'],
  sections: [
    {
      id: 'overview',
      title: 'Overview and prerequisites',
      summary: 'Apple Connector connects Apple Calendar and Reminders on this Mac and gives an Agent only scoped access.',
      body: [
        'Runtime: Apple Silicon Mac, macOS 14 or later, and a supported Node version (>=24.20 <25 or >=26.8.1 <27).',
        'The service talks to the CLI over a local Unix socket. The management page listens on 127.0.0.1 only; there is no LAN, cloud or remote endpoint.',
        'State lives in ~/.apple-connector by default; upgrading from ~/apple-connector requires apple-connector migrate-state.',
        'Business commands must use the authorization ID (token) created by an authorization. Local management commands use the owner-only admin token.',
        'Every write passes through authorization and audit boundaries. Audit keeps metadata only.',
      ],
      notes: [
        'Never send the management link, admin token or authorization ID to another device or chat.',
        'Use --json for machine output. Human-readable output is not a stable interface.',
      ],
    },
    {
      id: 'install',
      title: 'Install and first run',
      summary: 'After installing the CLI, run init; it initialises state, starts the service and opens the local management page. Re-running behaves like open.',
      body: [
        'Use npm link from the source tree, or run npm install -g @jachy/apple-connector. Confirm with apple-connector version.',
        'init creates the state directory, admin token and database, starts or reuses the local service, and opens the local management page. No separate initialisation step is needed; re-running behaves like open.',
        'status reports the service, database, authorization count and health check. Run start if the service is stopped.',
        'open is for later management. The URL is local only and expires after one hour.',
      ],
      commands: [
        { syntax: 'apple-connector init', description: 'First run: initialise state, start the service and open the local management page.' },
        { syntax: 'apple-connector status', description: 'Show service, database and authorization summary.' },
        { syntax: 'apple-connector open [--section <name>]', description: 'Open the local management page later.' },
        { syntax: 'apple-connector start --foreground', description: 'Run the service attached to this terminal for logs.' },
        { syntax: 'apple-connector stop', description: 'Stop the background service.' },
      ],
      notes: ['When the page expires, run apple-connector init again instead of reusing the old link.'],
    },
    {
      id: 'commands',
      title: 'Command reference',
      summary: 'Every command accepts --json. Use help for detailed options and examples.',
      commands: [
        { syntax: 'apple-connector help [topic...]', description: 'Show the overview or one command, for example help reminder patch.' },
        { syntax: 'apple-connector version', description: 'Print the version; --json returns { version }.' },
        { syntax: 'apple-connector init | start | stop | status', description: 'First-run onboarding and local service lifecycle.' },
        { syntax: 'apple-connector open [--section setup|audit|docs]', description: 'Open a specific management page; permissions and authorizations are merged into setup.' },
        { syntax: 'apple-connector skill path', description: 'Print the absolute packaged Skill directory.' },
        { syntax: 'apple-connector auth show --auth-key <key>', description: 'Show the scope and expiry behind an authorization.' },
        { syntax: 'apple-connector auth verify --agent <name> --auth-key <key>', description: 'Complete Agent verification and bind its identity to the authorization.' },
        { syntax: 'apple-connector calendar <subcommand>', description: 'Read calendars and manage events.' },
        { syntax: 'apple-connector reminder <subcommand>', description: 'Read reminder lists and manage reminders.' },
        { syntax: 'apple-connector operation get --id <operation-id>', description: 'Inspect a submitted operation.' },
        { syntax: 'apple-connector doctor [--probe]', description: 'Inspect the runtime and read-only native bridge.' },
      ],
      notes: [
        'Global options are --json and --no-color. Colors also turn off for non-TTY output, NO_COLOR and TERM=dumb.',
        'Business commands need --auth-key <key>; --auth-file <path> and --credential-file <absolute-path> remain compatible.',
      ],
    },
    {
      id: 'agent',
      title: 'Agent prompt and verification',
      summary: 'After the user creates an authorization on the setup page, copy the generated prompt to the Agent. Once the Agent runs auth verify, the page shows the binding.',
      body: [
        'Run init to open the local management page. The setup page orders system access, one-Agent authorization, prompt copying and Agent verification.',
        'The page generates two prompts: the default contains only the authorization key and lets the local CLI resolve the credential; the fallback contains the authorization ID.',
        'Copy the default prompt to the Agent. The Agent uses --auth-key so the local CLI resolves the credential, and loads the Skill through skill path. Do not read or scan the profile directory.',
        'Use the token version only when the authorization key cannot be used. The Agent must store it in a secret store or mode 0600 file and never echo it.',
        'The Agent must run auth verify --agent <name> to record the binding, then make one bounded read-only query. The setup page refreshes the binding automatically.',
      ],
      commands: [
        { syntax: 'apple-connector skill path --json', description: 'Get the Skill directory and version.' },
        { syntax: 'apple-connector auth show --auth-key <key> --json', description: 'Verify the authorization scope and expiry.' },
        { syntax: 'apple-connector auth verify --agent <name> --auth-key <key> --json', description: 'Complete Agent verification and bind the authorization.' },
        { syntax: 'apple-connector open --section docs --json', description: 'Give the user a link to the full usage guide.' },
      ],
      notes: ['An empty container list still means onboarding succeeded; there is simply nothing to grant. The management page polls binding state, so the Agent does not need to poll.'],
    },
    {
      id: 'permissions',
      title: 'System permissions and authorizations',
      summary: 'macOS system permission comes first; an authorization can only narrow access inside the visible containers for one Agent.',
      body: [
        'System permission determines which calendars and reminder lists Apple Connector can see. An authorization narrows that set further.',
        'The setup page keeps system access, one-Agent authorization, prompt copying and Agent verification in one ordered flow. Step 2 stays unavailable without full access.',
        'One authorization should map to one Agent. It can contain both Calendar and Reminders containers; choose actions per container. Containers with identical permissions are merged into one grant.',
        'Expiry defaults to one year and can be changed. An authorization cannot be edited after creation; delete and recreate it to change scope.',
        'The authorization ID is shown once at creation and also written to an owner-only local file. Deleting the authorization invalidates it immediately. After the Agent runs auth verify, the page shows the bound Agent name and verification time.',
      ],
      table: {
        columns: ['Provider', 'Available actions'],
        rows: [
          ['Calendar', 'read, create, update, delete'],
          ['Reminders', 'read, create, update, complete, delete'],
        ],
      },
      notes: ['Without system permission the container list is empty and no authorization can be created. Request access in step 1 of the setup page first; the macOS prompt names Apple Connector.'],
    },
    {
      id: 'calendar',
      title: 'Calendar commands',
      summary: 'Read calendars and events, then create, update or delete events within the grant.',
      body: [
        'list-calendars returns calendars visible to the authorization. list requires a calendar ID and a bounded from/to range.',
        'Times use RFC 3339 with an offset, for example 2026-11-20T09:00:00+08:00.',
        'create, update and delete are writes and require --idempotency-key. Retrying the same key is safe.',
        'The title is required and can come from --title or an owner-only --input JSON file. Locations and notes should also come from --input so they never appear in shell history.',
        'calendarItemIdentifier is stable for normal edits. A full sync, account reset or data-store rebuild requires listing again to resolve IDs.',
      ],
      commands: [
        { syntax: 'apple-connector calendar list-calendars --auth-key <key>', description: 'List visible calendars.' },
        { syntax: 'apple-connector calendar list --calendar-id <id> --from <RFC3339> --to <RFC3339> --auth-key <key>', description: 'List events with optional --offset and --limit.' },
        { syntax: 'apple-connector calendar create --calendar-id <id> --title <text> --start <RFC3339> --end <RFC3339> --idempotency-key <key> --auth-key <key>', description: 'Create an event; use --all-day and --input for location and notes.' },
        { syntax: 'apple-connector calendar update --calendar-id <id> --id <event-id> --title <text> --start <RFC3339> --end <RFC3339> --idempotency-key <key> --auth-key <key>', description: 'Replace event fields.' },
        { syntax: 'apple-connector calendar delete --calendar-id <id> --id <event-id> --idempotency-key <key> --auth-key <key>', description: 'Delete an event.' },
      ],
    },
    {
      id: 'reminders',
      title: 'Reminder commands',
      summary: 'Read reminder lists and reminders, including due dates, completion and partial updates.',
      body: [
        'Each reminder returned by list includes due and recurring. due is null, date, floating or instant.',
        'create accepts --due <RFC3339> for a zoned time or --due-date <YYYY-MM-DD> for an all-day date. --time-zone overrides the IANA zone.',
        'patch changes only fields present in --input plus due/completed flags. Title and body must go through --input.',
        'update is a full replacement of title, body and completed; patch is better for partial changes.',
        'Reminders with recurring true reject patch, update, complete and delete with unsupported_operation.',
      ],
      commands: [
        { syntax: 'apple-connector reminder list-lists --auth-key <key>', description: 'List visible reminder lists.' },
        { syntax: 'apple-connector reminder list --list-id <id> --auth-key <key>', description: 'List reminders with optional --offset and --limit.' },
        { syntax: 'apple-connector reminder create --list-id <id> --title <text> --due 2026-11-20T17:00:00+08:00 --idempotency-key <key> --auth-key <key>', description: 'Create a timed reminder.' },
        { syntax: 'apple-connector reminder create --list-id <id> --title <text> --due-date 2026-11-20 --idempotency-key <key> --auth-key <key>', description: 'Create an all-day reminder.' },
        { syntax: 'apple-connector reminder update --list-id <id> --id <reminder-id> --title <text> --completed --idempotency-key <key> --auth-key <key>', description: 'Replace fields and complete a reminder.' },
        { syntax: 'apple-connector reminder patch --list-id <id> --id <reminder-id> --clear-due --input <file> --idempotency-key <key> --auth-key <key>', description: 'Patch fields or clear the due date.' },
        { syntax: 'apple-connector reminder complete --list-id <id> --id <reminder-id> --idempotency-key <key> --auth-key <key>', description: 'Mark complete.' },
        { syntax: 'apple-connector reminder delete --list-id <id> --id <reminder-id> --idempotency-key <key> --auth-key <key>', description: 'Delete a reminder.' },
      ],
      table: {
        columns: ['due.kind', 'Meaning', 'Example'],
        rows: [
          ['date', 'All-day due, no time zone', '{"kind":"date","date":"2026-11-20"}'],
          ['floating', 'Wall-clock due, no time zone', '{"kind":"floating","date":"2026-11-20","time":"17:00:00"}'],
          ['instant', 'Zoned instant', '{"kind":"instant","at":"2026-11-20T17:00:00+08:00","timeZone":"Asia/Shanghai"}'],
        ],
      },
      notes: ['due null means no due date; patch with due: null or --clear-due clears it.'],
    },
    {
      id: 'audit',
      title: 'Audit',
      summary: 'Audit records metadata only; content is never retained.',
      body: [
        'Audit contains time, provider, action, outcome and count metadata. It never stores titles, bodies, notes or authorization IDs.',
        'Every call with write permission executes directly; there is no approval queue or prepared state.',
        'operation get remains available for idempotent replays and outcome_unknown reconciliation.',
      ],
      commands: [
        { syntax: 'apple-connector open --section audit', description: 'Open the audit page.' },
        { syntax: 'apple-connector operation get --id <operation-id> --auth-key <key> --json', description: 'Read the current operation state.' },
      ],
    },
    {
      id: 'json',
      title: 'JSON, exit codes and idempotency',
      summary: 'Machine calls use --json. Writes must use a stable idempotency key.',
      body: [
        '--json writes one envelope to stdout: { ok, data, meta: { schemaVersion: 2 } }, with no ANSI or human hints mixed in.',
        'Exit 0 means success, 1 a general error, 2 invalid_request, and 4 outcome_unknown.',
        'Every write requires --idempotency-key. Retrying the same key for the same operation is safe.',
        'On outcome_unknown, do not retry with a new key. Inspect local state or use operation get to confirm the result.',
        'Put private titles, bodies and notes in an owner-only --input JSON file instead of command-line arguments.',
      ],
      table: {
        columns: ['Exit code', 'Meaning'],
        rows: [
          ['0', 'Success'],
          ['1', 'General error, such as service unavailable or permission denied'],
          ['2', 'Invalid request; fix the arguments'],
          ['4', 'Unknown outcome; do not retry blindly with a new idempotency key'],
        ],
      },
      notes: ['Human-readable output may change between versions. Scripts, Skills and automation should parse --json only.'],
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      summary: 'Check service, permission, authorization, arguments and idempotency state in that order to avoid duplicate writes.',
      body: [
        'Start with apple-connector status and apple-connector doctor. If the service is stopped, run start. The helper permissions in doctor come from the Apple Connector App; the JXA probe only reflects the process that launched the CLI.',
        'If the container list is empty, grant macOS system permission on the management page and check again. System Settings → Privacy & Security → Calendars/Reminders should list Apple Connector.',
        'permission_denied has two common causes: the system permission is not full_access, or the authorization does not cover that container/action/time. Check step 1 first, then scope and expiry.',
        'After upgrading from v0.16.x or earlier, permission belongs to Apple Connector, so grant it once more. The old Terminal/OpenCode entries are no longer used.',
        'When the page shows "Authorization used, not verified", the Agent can call the service but has not run auth verify yet; ask it to verify once to complete the binding.',
        'unsupported_operation often means a recurring reminder, or a write against a read-only authorization.',
        'When the management link expires, run apple-connector init again. Do not reuse the old link.',
        'The local token file must be owner-readable. If the path is wrong, create a new authorization; do not guess or edit the token.',
      ],
      table: {
        columns: ['Error code', 'Suggested action'],
        rows: [
          ['service_unavailable', 'Run status, then start if needed and inspect local logs.'],
          ['permission_denied', 'Confirm system permission is full_access, then check authorization container/action scope and expiry.'],
          ['unsupported_operation', 'Check for a recurring reminder or a field/action outside the authorization.'],
          ['conflict', 'Check whether the service is stopped, the authorization was deleted, or a resource conflicts.'],
          ['outcome_unknown', 'Do not use a new key; confirm with operation get or local state first.'],
          ['invalid_request', 'Run apple-connector help <topic> and fix the arguments.'],
        ],
      },
    },
    {
      id: 'security',
      title: 'Security boundary',
      summary: 'The trust boundary is the current user on this Mac.',
      body: [
        'The service and management page listen on loopback only. Do not expose them through port forwarding, a reverse proxy or a LAN address.',
        'The management session expires after one hour. Management URLs are temporary credentials; do not store or forward them. An authorization ID is a bearer credential and belongs only in an owner-readable file or the Agent secret store.',
        'The authorization ID is shown only once at creation and is also stored in an owner-readable local file; it cannot be shown again after the page closes.',
        'An Agent can act only inside the authorized containers and actions. Anything beyond returns permission_denied.',
        'Agent binding stores only the self-reported Agent name and verification time for display; it is not strong identity authentication.',
        'Audit keeps metadata only, so never rely on it to recover titles, bodies or notes.',
      ],
      notes: ['If a link or authorization ID may have leaked, delete the authorization and create a new one; do not try to edit or rotate an existing authorization.'],
    },
    {
      id: 'reference',
      title: 'Reference documents',
      summary: 'The packaged documents cover command details, the Skill and installation.',
      body: [
        'docs/README.md: documentation index, common paths and the full version history.',
        'docs/cli.md: complete CLI reference, options, environment variables and due formats.',
        'docs/skill.md: Skill layout, loading and Agent behaviour.',
        'docs/getting-started.md: the shortest first-run path.',
        'docs/install-for-agent.md: instructions for delegating installation and Agent onboarding to an Agent.',
        'docs/system-permissions.md: macOS TCC ownership, status values and troubleshooting.',
        'docs/signing.md: self-signed certificate, signed build and rotation.',
        'docs/v0.8-to-v0.9-migration.md: changes across versions, with a Chinese summary.',
      ],
      commands: [
        { syntax: 'apple-connector skill path', description: 'Show the packaged Skill location.' },
        { syntax: 'apple-connector help <topic>', description: 'Show the options supported by this version.' },
      ],
    },
  ],
};

export const usageGuide: Record<Language, UsageGuide> = { 'zh-CN': zh, 'en-US': en };
