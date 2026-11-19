import pc from 'picocolors';
import { appVersion } from '../application/version.js';
import type { StateMigration } from '../transports/local/paths.js';

type Colors = ReturnType<typeof pc.createColors>;

export interface ColorSupport { json: boolean; noColor: boolean; colorSupported: boolean }

/** `--json` must never carry ANSI, even when the caller forces color. */
export function resolveColorEnabled({ json, noColor, colorSupported }: ColorSupport): boolean {
  return colorSupported && !json && !noColor;
}

export interface StartHuman { pid: number; started: boolean }
export interface StatusHuman {
  running: boolean; pid: number | null; version: string; paths: { dir: string };
  dbBytes: number | null; clients: number; operations: number; adminTokenFileExists: boolean;
  managementAddress: string | null; helper: { running: boolean; pid: number | null; socket: string }; health: { healthy: boolean; reason?: string | undefined };
}
export interface OpenHuman {
  url: string; expiresAt: number; remainingSeconds: number; section: string;
}
export interface AuthShowHuman {
  name: string;
  grants: Array<{ provider: string; containerIds: string[]; actions: string[]; expiresAt: number }>;
  expiresAt: number;
  lastUsedAt: number | null;
  agentName?: string | null;
  verifiedAt?: number | null;
}
export interface AuthVerifyHuman { name: string; agentName: string | null; verifiedAt: number; expiresAt: number }
export interface SkillHuman { path: string; version: string }
export interface DoctorHuman { version: string; platform: string; arch: string; node: string; native: unknown; helper: { running: boolean; permissions: unknown } }
export interface ErrorHuman { code: string; message: string }

interface HelpEntry {
  title: string;
  summary: string;
  usage: string[];
  options?: Array<[string, string]>;
  examples?: string[];
  related?: string[];
}

const HELP_ENTRIES: Record<string, HelpEntry> = {
  init: {
    title: 'apple-connector init',
    summary: 'First-time setup: initialise state, start or reuse the local service and management page, and open it on the setup flow. Re-running behaves like `open`.',
    usage: ['apple-connector init [--section setup|audit|docs] [--json]'],
    options: [['--section <name>', 'Open a specific page. Defaults to setup; permissions and agents are legacy aliases for setup.']],
    examples: ['apple-connector init', 'apple-connector init --section docs --json'],
    related: ['open', 'start'],
  },
  start: {
    title: 'apple-connector start',
    summary: 'Start the background service, or reuse a running service built from the same version.',
    usage: ['apple-connector start [--foreground] [--json]'],
    options: [['--foreground', 'Stay attached to this terminal instead of detaching the service.']],
    examples: ['apple-connector start', 'apple-connector start --foreground'],
    related: ['stop', 'status'],
  },
  stop: {
    title: 'apple-connector stop',
    summary: 'Stop the background service and wait for its socket to be removed.',
    usage: ['apple-connector stop [--json]'],
    examples: ['apple-connector stop'],
    related: ['start', 'status'],
  },
  'migrate-state': {
    title: 'apple-connector migrate-state',
    summary: 'Move the legacy ~/apple-connector state directory to ~/.apple-connector, stopping the legacy service and web process first.',
    usage: ['apple-connector migrate-state [--json]'],
    examples: ['apple-connector migrate-state', 'apple-connector migrate-state --json'],
    related: ['status', 'start'],
  },
  status: {
    title: 'apple-connector status',
    summary: 'Show service state, health, state directory, database size, authorization count and management address.',
    usage: ['apple-connector status [--json]'],
    examples: ['apple-connector status', 'apple-connector status --json'],
    related: ['start', 'doctor'],
  },
  open: {
    title: 'apple-connector open',
    summary: 'Open the local management page. The URL is loopback-only and expires with the one-hour management session.',
    usage: ['apple-connector open [--section setup|audit|docs] [--json]'],
    options: [['--section <name>', 'Open a specific page. Defaults to setup; permissions and agents are legacy aliases for setup.']],
    examples: ['apple-connector open', 'apple-connector open --section docs'],
    related: ['init', 'status'],
  },
  skill: {
    title: 'apple-connector skill',
    summary: 'Inspect the packaged Skill. `skill path` returns the absolute directory to import in an Agent host.',
    usage: ['apple-connector skill path [--json]'],
    examples: ['apple-connector skill path --json'],
    related: ['open', 'auth show'],
  },
  'skill path': {
    title: 'apple-connector skill path',
    summary: 'Print the absolute packaged Skill directory and the package version. This command does not start the service.',
    usage: ['apple-connector skill path [--json]'],
    examples: ['apple-connector skill path --json'],
    related: ['open', 'auth show'],
  },
  calendar: {
    title: 'apple-connector calendar',
    summary: 'List calendars and events, or create, update and delete events. Writes require a profile with the matching action and an idempotency key.',
    usage: ['apple-connector calendar <list-calendars|list|create|update|delete> [options]'],
    options: [['--auth-key <key>', 'Resolve the authorization ID from the local profile for this key.'], ['--auth-file <path>', 'Read the authorization ID from an explicit owner-only file.'], ['--credential-file <path>', 'Legacy alias for --auth-file.']],
    examples: ['apple-connector calendar list-calendars --auth-key <key>'],
    related: ['calendar list', 'calendar create'],
  },
  'calendar list-calendars': {
    title: 'apple-connector calendar list-calendars',
    summary: 'List the calendars visible to the selected profile. Calendar IDs are stable EventKit identifiers.',
    usage: ['apple-connector calendar list-calendars --auth-key <key> [--json]'],
    examples: ['apple-connector calendar list-calendars --auth-key <key> --json'],
  },
  'calendar list': {
    title: 'apple-connector calendar list',
    summary: 'List events in one calendar for a bounded RFC 3339 time range.',
    usage: ['apple-connector calendar list --calendar-id <id> --from <RFC3339> --to <RFC3339> [--offset <n>] [--limit <n>] [--json]'],
    options: [['--from, --to', 'RFC 3339 timestamps with an offset, for example 2026-11-20T09:00:00+08:00.'], ['--offset, --limit', 'Pagination; offset defaults to 0 and limit to 50.']],
    examples: ['apple-connector calendar list --calendar-id <id> --from 2026-11-20T00:00:00+08:00 --to 2026-11-21T00:00:00+08:00 --auth-key <key>'],
  },
  'calendar create': {
    title: 'apple-connector calendar create',
    summary: 'Create an event. The title is required and may come from an owner-only --input JSON file together with location and notes.',
    usage: ['apple-connector calendar create --calendar-id <id> --title <text> --start <RFC3339> --end <RFC3339> [--all-day] [--input <file>] --idempotency-key <key> --auth-key <key>'],
    options: [['--all-day', 'Create an all-day event.'], ['--input <file>', 'Owner-only JSON object; may provide title, location and notes.']],
    examples: ['apple-connector calendar create --calendar-id <id> --title "Focus" --start 2026-11-20T09:00:00+08:00 --end 2026-11-20T10:00:00+08:00 --idempotency-key demo-1 --auth-key <key>'],
  },
  'calendar update': {
    title: 'apple-connector calendar update',
    summary: 'Replace event fields. The event ID, owning calendar and title are required.',
    usage: ['apple-connector calendar update --calendar-id <id> --id <event-id> --title <text> --start <RFC3339> --end <RFC3339> [--all-day] --idempotency-key <key> --auth-key <key>'],
    examples: ['apple-connector calendar update --calendar-id <id> --id <event-id> --title "Moved" --start 2026-11-20T11:00:00+08:00 --end 2026-11-20T12:00:00+08:00 --idempotency-key demo-2 --auth-key <key>'],
  },
  'calendar delete': {
    title: 'apple-connector calendar delete',
    summary: 'Delete an event by stable ID from one calendar.',
    usage: ['apple-connector calendar delete --calendar-id <id> --id <event-id> --idempotency-key <key> --auth-key <key>'],
    examples: ['apple-connector calendar delete --calendar-id <id> --id <event-id> --idempotency-key demo-3 --auth-key <key>'],
  },
  reminder: {
    title: 'apple-connector reminder',
    summary: 'List reminder lists and reminders, or create, update, patch, complete and delete reminders.',
    usage: ['apple-connector reminder <list-lists|list|create|update|patch|complete|delete> [options]'],
    options: [['--auth-key <key>', 'Resolve the authorization ID from the local profile for this key.'], ['--auth-file <path>', 'Read the authorization ID from an explicit owner-only file.'], ['--credential-file <path>', 'Legacy alias for --auth-file.']],
    examples: ['apple-connector reminder list-lists --auth-key <key>'],
    related: ['reminder list', 'reminder patch'],
  },
  'reminder list-lists': {
    title: 'apple-connector reminder list-lists',
    summary: 'List the reminder lists visible to the selected profile.',
    usage: ['apple-connector reminder list-lists --auth-key <key> [--json]'],
    examples: ['apple-connector reminder list-lists --auth-key <key> --json'],
  },
  'reminder list': {
    title: 'apple-connector reminder list',
    summary: 'List reminders in one list. Each item includes `due` (null or date/floating/instant) and `recurring`.',
    usage: ['apple-connector reminder list --list-id <id> [--offset <n>] [--limit <n>] [--json]'],
    examples: ['apple-connector reminder list --list-id <id> --limit 20 --auth-key <key> --json'],
  },
  'reminder create': {
    title: 'apple-connector reminder create',
    summary: 'Create a reminder, optionally with an all-day, floating or zoned due date. Private title and body may come from --input.',
    usage: ['apple-connector reminder create --list-id <id> --title <text> [--body <text>] [--due <RFC3339> | --due-date <YYYY-MM-DD>] [--time-zone <IANA>] --idempotency-key <key> --auth-key <key>'],
    options: [['--due <RFC3339>', 'Zoned due instant; its offset determines the time zone unless --time-zone overrides it.'], ['--due-date <YYYY-MM-DD>', 'All-day due date with no time zone.'], ['--time-zone <IANA>', 'IANA zone for --due, for example Asia/Shanghai.'], ['--input <file>', 'Owner-only JSON object; may provide title and body.']],
    examples: ['apple-connector reminder create --list-id <id> --title "Review" --due 2026-11-20T17:00:00+08:00 --idempotency-key demo-4 --auth-key <key>'],
  },
  'reminder update': {
    title: 'apple-connector reminder update',
    summary: 'Replace title, body and completion state for a reminder.',
    usage: ['apple-connector reminder update --list-id <id> --id <reminder-id> --title <text> [--body <text>] [--completed] --idempotency-key <key> --auth-key <key>'],
    examples: ['apple-connector reminder update --list-id <id> --id <reminder-id> --title "Review notes" --completed --idempotency-key demo-5 --auth-key <key>'],
  },
  'reminder patch': {
    title: 'apple-connector reminder patch',
    summary: 'Change only the fields present in --input and the due/completion flags. Title and body must go through --input, never command-line flags.',
    usage: ['apple-connector reminder patch --list-id <id> --id <reminder-id> [--due <RFC3339> | --due-date <YYYY-MM-DD> | --clear-due] [--time-zone <IANA>] [--completed | --not-completed] --input <file> --idempotency-key <key> --auth-key <key>'],
    options: [['--clear-due', 'Clear the due date with due: null.'], ['--not-completed', 'Reopen a completed reminder.'], ['--input <file>', 'Owner-only JSON object; title and body are accepted here only.']],
    examples: ['apple-connector reminder patch --list-id <id> --id <reminder-id> --due-date 2026-11-21 --input ./patch.json --idempotency-key demo-6 --auth-key <key>'],
  },
  'reminder complete': {
    title: 'apple-connector reminder complete',
    summary: 'Mark one reminder complete.',
    usage: ['apple-connector reminder complete --list-id <id> --id <reminder-id> --idempotency-key <key> --auth-key <key>'],
    examples: ['apple-connector reminder complete --list-id <id> --id <reminder-id> --idempotency-key demo-7 --auth-key <key>'],
  },
  'reminder delete': {
    title: 'apple-connector reminder delete',
    summary: 'Delete one reminder by stable ID.',
    usage: ['apple-connector reminder delete --list-id <id> --id <reminder-id> --idempotency-key <key> --auth-key <key>'],
    examples: ['apple-connector reminder delete --list-id <id> --id <reminder-id> --idempotency-key demo-8 --auth-key <key>'],
  },
  operation: {
    title: 'apple-connector operation',
    summary: 'Inspect a submitted operation by its operation ID.',
    usage: ['apple-connector operation get --id <operation-id> --auth-key <key> [--json]'],
    examples: ['apple-connector operation get --id <operation-id> --auth-key <key> --json'],
    related: ['open'],
  },
  'operation get': {
    title: 'apple-connector operation get',
    summary: 'Read the state of an operation, including idempotent replays and uncertain outcomes.',
    usage: ['apple-connector operation get --id <operation-id> --auth-key <key> [--json]'],
    examples: ['apple-connector operation get --id <operation-id> --auth-key <key> --json'],
  },
  auth: {
    title: 'apple-connector auth',
    summary: 'Inspect or verify the authorization behind an authorization key or token.',
    usage: ['apple-connector auth show --auth-key <key> [--json]', 'apple-connector auth verify --agent <name> --auth-key <key> [--json]'],
    examples: ['apple-connector auth show --auth-key <key> --json', 'apple-connector auth verify --agent "Claude Code" --auth-key <key> --json'],
    related: ['calendar', 'reminder'],
  },
  'auth show': {
    title: 'apple-connector auth show',
    summary: 'Show the name, containers, actions, expiry, last-used time and Agent binding for the presented authorization key or token. The token itself is never printed.',
    usage: ['apple-connector auth show --auth-key <key> [--json]', 'apple-connector auth show --auth <token> [--json]'],
    options: [['--auth-key <key>', 'Resolve the authorization ID from the local profile for this key.'], ['--auth-file <path>', 'Read the authorization ID from an explicit owner-only file.'], ['--auth <token>', 'Pass the authorization ID directly (avoid shell history).'], ['APPLE_CONNECTOR_AUTH', 'Environment variable containing the authorization ID.']],
    examples: ['apple-connector auth show --auth-key <key>', 'APPLE_CONNECTOR_AUTH=<token> apple-connector auth show --json'],
  },
  'auth verify': {
    title: 'apple-connector auth verify',
    summary: 'Complete Agent verification: authenticate with the authorization key or token and record the Agent name and verification time. The local management page shows the binding immediately.',
    usage: ['apple-connector auth verify --agent <name> --auth-key <key> [--json]', 'apple-connector auth verify --agent <name> --auth <token> [--json]'],
    options: [['--agent <name>', 'Required Agent or product name shown on the management page.'], ['--auth-key <key>', 'Resolve the authorization ID from the local profile for this key.'], ['--auth-file <path>', 'Read the authorization ID from an explicit owner-only file.'], ['--auth <token>', 'Pass the authorization ID directly (avoid shell history).'], ['APPLE_CONNECTOR_AUTH', 'Environment variable containing the authorization ID.']],
    examples: ['apple-connector auth verify --agent "Claude Code" --auth-key <key> --json'],
  },
  doctor: {
    title: 'apple-connector doctor',
    summary: 'Inspect the runtime. `--probe` runs a read-only JXA/EventKit bridge check without reading personal data or requesting permission.',
    usage: ['apple-connector doctor [--probe] [--json]'],
    options: [['--probe', 'Run the read-only native bridge probe.']],
    examples: ['apple-connector doctor', 'apple-connector doctor --probe --json'],
    related: ['status'],
  },
  version: {
    title: 'apple-connector version',
    summary: 'Print the package version. Use `--json` for `{ version }` in the standard envelope.',
    usage: ['apple-connector version [--json]', 'apple-connector --version'],
    examples: ['apple-connector version', 'apple-connector version --json'],
  },
  help: {
    title: 'apple-connector help',
    summary: 'Show the command overview or detailed help for one command.',
    usage: ['apple-connector help [topic...]', 'apple-connector --help'],
    examples: ['apple-connector help', 'apple-connector help calendar create', 'apple-connector help reminder patch'],
  },
};

/** Terminal presentation. Keep this module free of business decisions. */
export class CliUi {
  private readonly c: Colors;
  constructor(private readonly enabled: boolean) {
    this.c = pc.createColors(enabled);
  }

  private icon(symbol: string, paint: (value: string) => string): string {
    return this.enabled ? `${paint(symbol)} ` : '';
  }

  private heading(text: string): string {
    return this.c.bold(text);
  }

  private commandRow(command: string, description: string): string {
    return `  ${this.c.cyan(command.padEnd(44))}${this.c.dim(description)}`;
  }

  private optionRow(option: string, description: string): string {
    return `  ${this.c.cyan(option.padEnd(30))}${this.c.dim(description)}`;
  }

  private kv(label: string, value: string, paint: (value: string) => string = (item) => item): string {
    return `  ${this.c.dim(label.padEnd(20))}${paint(value)}`;
  }

  version(): string {
    return `${this.c.bold('apple-connector')} ${this.c.green(appVersion)}`;
  }

  authShow(value: AuthShowHuman): string {
    const lines = [
      this.heading(value.name || 'Authorization'),
      this.kv('Expires', new Date(value.expiresAt).toISOString()),
      this.kv('Last used', value.lastUsedAt === null ? 'never' : new Date(value.lastUsedAt).toISOString()),
      this.kv('Agent', value.agentName ?? 'never'),
      this.kv('Verified', value.verifiedAt === null || value.verifiedAt === undefined ? 'never' : new Date(value.verifiedAt).toISOString()),
    ];
    for (const grant of value.grants) {
      lines.push('', this.heading(grant.provider), this.kv('Containers', grant.containerIds.join(', ')), this.kv('Actions', grant.actions.join(', ')));
    }
    return lines.join('\n');
  }

  authVerify(value: AuthVerifyHuman): string {
    return [
      this.c.green('Authorization verified'),
      this.kv('Name', value.name || 'Authorization'),
      this.kv('Agent', value.agentName ?? 'unknown'),
      this.kv('Verified', new Date(value.verifiedAt).toISOString()),
      this.kv('Expires', new Date(value.expiresAt).toISOString()),
      this.c.dim('The local management page now shows this Agent as bound to the authorization.'),
    ].join('\n');
  }

  migrateState(value: StateMigration): string {
    if (!value.migrated) return this.c.dim(`No legacy state directory to migrate (${value.from}).`);
    return [
      this.c.green('State directory migrated'),
      this.kv('From', value.from),
      this.kv('To', value.to),
      this.kv('Stopped service', value.stoppedService ? 'yes' : 'no'),
      this.kv('Stopped web', value.stoppedWeb ? 'yes' : 'no'),
    ].join('\n');
  }

  /** Return undefined for an unknown topic so the CLI can choose its exit behaviour. */
  help(topic: readonly string[]): string | undefined {
    const key = topic.join(' ').trim();
    if (!key) return this.overview();
    const entry = HELP_ENTRIES[key];
    return entry ? this.entry(entry) : undefined;
  }

  private overview(): string {
    const lines = [
      `${this.c.bold('Apple Connector')} ${this.c.green(appVersion)} ${this.c.dim('— local Calendar and Reminders CLI')}`,
      '',
      this.heading('Usage'),
      this.commandRow('apple-connector <command> [options]', ''),
      this.commandRow('apple-connector help [topic]', 'Show this overview or one command'),
      '',
      this.heading('Global options'),
      this.commandRow('--json', 'Write one versioned JSON envelope to stdout'),
      this.commandRow('--no-color', 'Disable ANSI colors (also NO_COLOR or a non-TTY stream)'),
      this.commandRow('--help, -h', 'Show this help'),
      this.commandRow('--version, -v', 'Print the version'),
      '',
      this.heading('Service'),
      this.commandRow('init', 'First-time setup: start the service and open the management page'),
      this.commandRow('start [--foreground]', 'Start or reuse the background service'),
      this.commandRow('stop', 'Stop the background service'),
      this.commandRow('migrate-state', 'Move ~/apple-connector to ~/.apple-connector'),
      this.commandRow('status', 'Show service, database and authorization summary'),
      this.commandRow('open [--section <name>]', 'Open the local management page'),
      '',
      this.heading('Agent'),
      this.commandRow('skill path', 'Print the absolute packaged Skill directory'),
      this.commandRow('auth show', 'Show the authorization behind an authorization key or ID'),
      this.commandRow('auth verify --agent <name>', 'Bind an Agent to the authorization and show it on the management page'),
      '',
      this.heading('Calendar'),
      this.commandRow('calendar list-calendars', 'List visible calendars'),
      this.commandRow('calendar list', 'List events in one calendar'),
      this.commandRow('calendar create', 'Create an event'),
      this.commandRow('calendar update', 'Replace event fields'),
      this.commandRow('calendar delete', 'Delete an event'),
      '',
      this.heading('Reminders'),
      this.commandRow('reminder list-lists', 'List visible reminder lists'),
      this.commandRow('reminder list', 'List reminders in one list'),
      this.commandRow('reminder create', 'Create a reminder'),
      this.commandRow('reminder update', 'Replace title, body and completion'),
      this.commandRow('reminder patch', 'Patch selected fields, due date or completion'),
      this.commandRow('reminder complete', 'Mark a reminder complete'),
      this.commandRow('reminder delete', 'Delete a reminder'),
      '',
      this.heading('Diagnostics'),
      this.commandRow('operation get --id <id>', 'Inspect a submitted operation'),
      this.commandRow('doctor [--probe]', 'Inspect runtime and the native bridge'),
      this.commandRow('version', 'Print the package version'),
      '',
      this.c.dim('Business commands require an authorization key. Prefer --auth-key <key> or APPLE_CONNECTOR_AUTH.'),
      this.c.dim('Legacy --auth-file <path>, --profile <id> and --credential-file <path> remain available.'),
      this.c.dim('Writes require --idempotency-key. Put private title/body/notes fields in an owner-only --input file.'),
      this.c.dim('Run `apple-connector help <topic>` for parameters and examples.'),
    ];
    return lines.join('\n');
  }

  private entry(entry: HelpEntry): string {
    const lines = [this.c.bold(entry.title), entry.summary, '', this.heading('Usage')];
    for (const usage of entry.usage) lines.push(`  ${this.c.cyan(usage)}`);
    if (entry.options?.length) {
      lines.push('', this.heading('Options'));
      for (const [option, description] of entry.options) lines.push(this.optionRow(option, description));
    }
    if (entry.examples?.length) {
      lines.push('', this.heading('Examples'));
      for (const example of entry.examples) lines.push(`  ${this.c.dim('$')} ${example}`);
    }
    if (entry.related?.length) {
      lines.push('', this.heading('Related'), `  ${entry.related.map((item) => `apple-connector help ${item}`).join('\n  ')}`);
    }
    lines.push('', this.c.dim('Global options: --json, --no-color. Run `apple-connector help` for all commands.'));
    return lines.join('\n');
  }

  start(value: StartHuman): string {
    return `${this.icon('●', this.c.green)}${this.c.bold(value.started ? 'Service started' : 'Service already running')} ${this.c.dim(`(pid ${value.pid})`)}`;
  }

  stop(): string {
    return `${this.icon('●', this.c.dim)}${this.c.bold('Service stopped.')}`;
  }

  status(value: StatusHuman): string {
    return [
      `${this.icon(value.running ? '●' : '○', value.running ? this.c.green : this.c.dim)}${this.c.bold(`Apple Connector ${value.version}`)}`,
      this.kv('Service', value.running ? `running${value.pid === null ? '' : ` (pid ${value.pid})`}` : 'stopped', (text) => value.running ? this.c.green(text) : this.c.dim(text)),
      this.kv('Helper', value.helper.running ? `running${value.helper.pid === null ? '' : ` (pid ${value.helper.pid})`}` : 'stopped', (text) => value.helper.running ? this.c.green(text) : this.c.dim(text)),
      this.kv('Health', value.health.healthy ? 'healthy' : value.health.reason ?? 'unavailable', (text) => value.health.healthy ? this.c.green(text) : this.c.yellow(text)),
      this.kv('State directory', value.paths.dir),
      this.kv('Database', value.dbBytes === null ? 'unavailable' : formatBytes(value.dbBytes)),
      this.kv('Profiles', String(value.clients)),
      this.kv('Operations', String(value.operations)),
      this.kv('Admin token', value.adminTokenFileExists ? 'present' : 'missing', (text) => value.adminTokenFileExists ? text : this.c.yellow(text)),
      this.kv('Management', value.managementAddress ?? 'not issued', (text) => value.managementAddress ? text : this.c.dim(text)),
    ].join('\n');
  }

  init(value: OpenHuman): string {
    return [
      `${this.icon('✔', this.c.green)}${this.c.bold('Apple Connector page ready.')}`,
      this.kv('URL', value.url, this.c.blue),
      this.kv('Expires', `${formatTime(value.expiresAt)} (${formatRemaining(value.remainingSeconds)})`),
      '',
      this.c.dim('Complete system permissions and create an authorization, then copy the Agent prompt to your Agent.'),
      this.c.dim('Loopback only. The link expires with the one-hour management session.'),
    ].join('\n');
  }

  open(value: OpenHuman): string {
    return [
      `${this.icon('✔', this.c.green)}${this.c.bold('Management page ready.')}`,
      this.kv('Section', value.section),
      this.kv('URL', value.url, this.c.blue),
      this.kv('Expires', `${formatTime(value.expiresAt)} (${formatRemaining(value.remainingSeconds)})`),
      '',
      this.c.dim('Loopback only. The link expires with the one-hour management session.'),
    ].join('\n');
  }

  skill(value: SkillHuman): string {
    return [
      `${this.icon('✔', this.c.green)}${this.c.bold('Skill directory')}`,
      this.kv('Path', value.path),
      this.kv('Version', value.version, this.c.green),
    ].join('\n');
  }

  doctor(value: DoctorHuman): string {
    const lines = [
      `${this.icon('●', this.c.cyan)}${this.c.bold(`Apple Connector ${value.version}`)}`,
      this.kv('Platform', `${value.platform} ${value.arch}`),
      this.kv('Node', value.node),
      this.kv('Helper', value.helper.running ? 'running' : 'stopped', (text) => value.helper.running ? this.c.green(text) : this.c.dim(text)),
      this.kv('Helper permissions', value.helper.permissions === null ? 'unavailable' : 'read from helper', (text) => value.helper.permissions === null ? this.c.dim(text) : this.c.green(text)),
      this.kv('JXA probe', value.native === null ? 'not requested (use --probe)' : 'completed', (text) => value.native === null ? this.c.dim(text) : this.c.green(text)),
    ];
    if (value.helper.permissions !== null) {
      lines.push('', ...this.json(value.helper.permissions).split('\n').map((line) => `  ${line}`));
    }
    if (value.native !== null) {
      lines.push('', this.c.dim('JXA probe reflects the process that launched the CLI, not the Apple Connector App.'), ...this.json(value.native).split('\n').map((line) => `  ${line}`));
    }
    return lines.join('\n');
  }

  json(value: unknown): string {
    const text = JSON.stringify(value, null, 2) ?? String(value);
    if (!this.enabled) return text;
    return highlightJson(text, this.c);
  }

  error(value: ErrorHuman): string {
    const label = this.c.red(this.c.bold('error'));
    const code = this.c.dim(`[${value.code}]`);
    const hint = value.code === 'invalid_request' ? `\n${this.c.dim('Run `apple-connector help` for usage.')}` : '';
    return `${label} ${code} ${value.message}${hint}`;
  }
}

export function createUi(enabled: boolean): CliUi {
  return new CliUi(enabled);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(1)} ${unit}`;
}

function formatTime(milliseconds: number): string {
  return new Date(milliseconds).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium', hour12: false });
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'expired';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/** Colorize JSON tokens without changing the text content. */
function highlightJson(text: string, c: Colors): string {
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let output = '';
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    output += text.slice(lastIndex, index);
    if (match[1]) {
      const isKey = Boolean(match[2]);
      output += isKey ? c.cyan(match[1]) : c.green(match[1]);
      if (match[2]) output += c.dim(match[2]);
    } else if (match[3]) {
      output += c.magenta(match[3]);
    } else if (match[4]) {
      output += c.yellow(match[4]);
    }
    lastIndex = index + match[0].length;
  }
  return output + text.slice(lastIndex);
}
