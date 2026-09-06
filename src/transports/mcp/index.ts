import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpServiceClient } from '../local/client.js';
import { statePaths } from '../local/paths.js';
import { createMcpServer } from './server.js';
import { ConnectorError } from '../../application/errors.js';

/** `apple-connector mcp` — lightweight stdio entry that proxies to the background service. */
export async function runMcpEntry(): Promise<void> {
  const token = process.env.APPLE_CONNECTOR_TOKEN;
  if (!token) throw new ConnectorError('invalid_request', 'Set APPLE_CONNECTOR_TOKEN to a client token (see `apple-connector client create`).');
  const client = new HttpServiceClient(statePaths().socket);
  const server = createMcpServer(client, token);
  await server.connect(new StdioServerTransport());
}