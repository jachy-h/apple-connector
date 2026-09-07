import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../src/storage/database.js';
import { ReminderOperations } from '../src/operations/reminders.js';
import { ServiceFacade } from '../src/transports/local/handlers.js';
import { ConnectorError } from '../src/application/errors.js';
import { createMcpServer } from '../src/transports/mcp/server.js';
import type { ServiceClient } from '../src/transports/local/client.js';
import type { RpcMethod } from '../src/transports/local/rpc.js';
import type { ReminderWriter } from '../src/providers/reminders/types.js';

/** Mirrors HttpServiceClient semantics against an in-process facade, for transport-free MCP tests. */
class FacadeClient implements ServiceClient {
  constructor(private readonly facade: ServiceFacade) {}
  async request(method: RpcMethod, params: Record<string, unknown> | undefined, token: string): Promise<unknown> {
    const response = await this.facade.dispatch(method, params, token);
    if (!response.ok) throw new ConnectorError(response.error.code, response.error.message);
    return response.result;
  }
}

async function harness() {
  const store = new Store(':memory:');
  let writes = 0;
  const writer: ReminderWriter = {
    preflight: async () => {},
    create: async (change) => { writes++; return { id: `n-${writes}`, containerId: change.containerId }; },
    verify: async () => true,
  };
  const operations = new ReminderOperations(store, writer);
  const facade = new ServiceFacade(store, operations, 'admin-secret', 'test-version');
  const created = await facade.admin('clients.create', {
    name: 'MCP agent', grants: [{ provider: 'reminders', containerIds: ['test-list'], actions: ['create'], fields: 'full', approval: 'automatic', expiresAt: Date.now() + 3600_000 }],
  }, 'admin-secret') as { ok: true; result: { token: string } };
  const token = created.result.token;
  const mcp = createMcpServer(new FacadeClient(facade), token);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: 'test-runner', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { store, mcp, client, writes: () => writes, token };
}

test('MCP omits temporarily disabled Notes tools', async (t) => {
  const h = await harness();
  t.after(async () => { await h.client.close(); h.store.close(); });
  const tools = await h.client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['calendar.list_calendars', 'calendar.list_events', 'changes.commit', 'changes.prepare', 'connector.capabilities', 'operations.get', 'reminders.list', 'reminders.list_lists']);
});

test('capabilities tool reports provider statuses without reading personal data', async (t) => {
  const h = await harness();
  t.after(async () => { await h.client.close(); h.store.close(); });
  const result = await h.client.callTool({ name: 'connector.capabilities', arguments: {} });
  assert.equal(result.isError, undefined);
  const text = ((result.content as Array<{ type: string; text: string }>)[0] as { type: string; text: string }).text;
  const parsed = JSON.parse(text) as { version: string; capabilities: Array<{ provider: string }> };
  assert.equal(parsed.version, 'test-version');
  assert.deepEqual(parsed.capabilities.map((c) => c.provider), ['calendar', 'reminders', 'notes']);
  assert.deepEqual(parsed.capabilities.at(-1), { provider: 'notes', backend: 'apple-events', status: 'unavailable', operations: [], limitations: ['Apple Notes is temporarily disabled in v0.7.0.', 'Existing grants, audit events, and operation metadata remain readable but do not authorize native access.'] });
});

test('prepare → commit → get works end to end through MCP with one write', async (t) => {
  const h = await harness();
  t.after(async () => { await h.client.close(); h.store.close(); });
  const change = { kind: 'reminders.create', containerId: 'test-list', title: '提matter' };
  const prepared = await h.client.callTool({ name: 'changes.prepare', arguments: { idempotencyKey: 'mcp-key', change } });
  const plan = JSON.parse(((prepared.content as Array<{ type: string; text: string }>)[0] as { type: string; text: string }).text) as { id: string; state: string };
  assert.equal(plan.state, 'approved'); // automatic approval grant
  const committed = await h.client.callTool({ name: 'changes.commit', arguments: { id: plan.id } });
  const committedResult = JSON.parse(((committed.content as Array<{ type: string; text: string }>)[0] as { type: string; text: string }).text) as { state: string };
  assert.equal(committedResult.state, 'succeeded');
  assert.equal(h.writes(), 1);
  const got = await h.client.callTool({ name: 'operations.get', arguments: { id: plan.id } });
  assert.equal((JSON.parse(((got.content as Array<{ type: string; text: string }>)[0] as { type: string; text: string }).text) as { state: string }).state, 'succeeded');
});

test('permission and validation failures surface as MCP tool errors, not raw exceptions', async (t) => {
  const h = await harness();
  t.after(async () => { await h.client.close(); h.store.close(); });
  const badId = await h.client.callTool({ name: 'operations.get', arguments: { id: 'no-such-plan' } });
  assert.equal(badId.isError, true);
  assert.ok(JSON.stringify(badId).includes('permission_denied'));
  const badArgs = await h.client.callTool({ name: 'changes.commit', arguments: { id: 12345 } });
  assert.equal(badArgs.isError, true);
});
