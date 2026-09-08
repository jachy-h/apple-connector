import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ConnectorError } from '../application/errors.js';
import { clientInputSchema, type ClientInput } from '../policy/schema.js';

export interface ClientUpdateConfig extends ClientInput { id: string }

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Least-surprise policy for a local agent: global reads, writes only in `Agents`. */
export function defaultAgentClientConfig(now = Date.now()): ClientInput {
  const expiresAt = now + ONE_YEAR_MS;
  return clientInputSchema.parse({
    name: 'agent',
    grants: [
      { provider: 'calendar', containerIds: ['*'], actions: ['read'], fields: 'full', approval: 'automatic', expiresAt },
      { provider: 'calendar', containerIds: ['Agents'], actions: ['create', 'update', 'delete'], fields: 'full', approval: 'automatic', expiresAt },
      { provider: 'reminders', containerIds: ['*'], actions: ['read'], fields: 'full', approval: 'automatic', expiresAt },
      { provider: 'reminders', containerIds: ['Agents'], actions: ['create', 'update', 'complete', 'delete'], fields: 'full', approval: 'automatic', expiresAt },
    ],
  });
}

/** Create, but never replace, the reviewable policy used before a credential is minted. */
export function writeDefaultAgentClientConfig(file: string, now = Date.now()): ClientInput {
  if (file !== resolve(file)) throw new ConnectorError('invalid_request', 'Client config path must be absolute.');
  const config = defaultAgentClientConfig(now);
  try { writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConnectorError('conflict', 'Default agent config already exists; review or remove it explicitly.');
    throw error;
  }
  return config;
}

function readConfiguration(file: string): unknown {
  if (file !== resolve(file)) throw new ConnectorError('invalid_request', 'Client config path must be absolute.');
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(file); } catch { throw new ConnectorError('invalid_request', 'Client config file does not exist.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ConnectorError('invalid_request', 'Client config file must be a regular file.');
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new ConnectorError('invalid_request', 'Client config file must contain valid JSON.'); }
}

/** Load a pairing policy from a file so grants never need to be embedded in shell arguments. */
export function readClientCreateConfig(file: string): ClientInput {
  const parsed = clientInputSchema.safeParse(readConfiguration(file));
  if (!parsed.success) throw new ConnectorError('invalid_request', 'Client config must be a valid { name, grants } object.');
  return parsed.data;
}

/** Load a complete client replacement policy, including the client identifier, from a file. */
export function readClientUpdateConfig(file: string): ClientUpdateConfig {
  const raw = readConfiguration(file);
  const envelope = z.object({ id: z.string().min(1).max(128) }).passthrough().safeParse(raw);
  if (!envelope.success || !raw || typeof raw !== 'object') {
    throw new ConnectorError('invalid_request', 'Client config must be a valid { id, name, grants } object.');
  }
  const { id, ...input } = raw as Record<string, unknown>;
  const parsed = clientInputSchema.safeParse(input);
  if (!parsed.success) throw new ConnectorError('invalid_request', 'Client config must be a valid { id, name, grants } object.');
  return { id: envelope.data.id, ...parsed.data };
}
