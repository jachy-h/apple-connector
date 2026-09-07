import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpServiceClient } from '../local/client.js';
import { statePaths } from '../local/paths.js';
import { readClientToken } from '../local/paths.js';
import { createMcpServer } from './server.js';
import { ConnectorError } from '../../application/errors.js';
import { startService } from '../local/lifecycle.js';

/** `apple-connector mcp` — lightweight stdio entry that proxies to the background service. */
export async function runMcpEntry(): Promise<void> {
  const tokenFile = process.env.APPLE_CONNECTOR_TOKEN_FILE;
  const token = tokenFile ? readClientToken(tokenFile) : process.env.APPLE_CONNECTOR_TOKEN;
  if (!token) throw new ConnectorError('invalid_request', 'Set APPLE_CONNECTOR_TOKEN_FILE to an owner-private client credential file (see `apple-connector client create --credential-file`).');
  // MCP hosts commonly restart stdio children after transport failures. Reusing or starting the
  // same-version local service makes that recovery safe without exposing an HTTP MCP endpoint.
  await startService();
  const client = new HttpServiceClient(statePaths().socket, 60_000);
  const server = createMcpServer(client, token);
  await server.connect(new StdioServerTransport());
}
